import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { oneVid } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { resolveTorboxRedirect, resolveTorboxStream } from "@/lib/torbox";

const FINAL_URL_TTL_MS = 5 * 60 * 1000;
const FINAL_URL_CACHE_LIMIT = 100;
// El player pide muchos rangos sobre la misma URL. Sin esta caché, cada rango
// volvería a crear/listar el torrent en el servicio. Es por instancia y por
// usuario; la respuesta además se cachea en el browser.
const finalUrlCache = new Map<string, { expiresAt: number; url: string }>();

function readCachedFinalUrl(key: string): string | null {
  const entry = finalUrlCache.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    finalUrlCache.delete(key);
    return null;
  }
  return entry.url;
}

function writeCachedFinalUrl(key: string, url: string): void {
  if (finalUrlCache.size >= FINAL_URL_CACHE_LIMIT) {
    const oldest = finalUrlCache.keys().next().value;
    if (oldest !== undefined) {
      finalUrlCache.delete(oldest);
    }
  }
  finalUrlCache.set(key, { expiresAt: Date.now() + FINAL_URL_TTL_MS, url });
}

function finalRedirectResponse(target: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": "private, max-age=300",
      Location: target,
    },
  });
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const hash = url.searchParams.get("hash")?.trim() ?? "";
  const magnetParam = url.searchParams.get("magnet")?.trim() ?? "";
  const redirectMode = url.searchParams.get("redirect") ?? "1";
  const wantRedirect = redirectMode !== "0";
  const wantFinalRedirect = redirectMode === "final";

  if (!(hash || magnetParam)) {
    return Response.json({ error: "hash o magnet requerido" }, { status: 400 });
  }

  const magnet =
    magnetParam ||
    `magnet:?xt=urn:btih:${encodeURIComponent(hash)}&dn=${encodeURIComponent(hash)}`;

  const cacheKey = `${session.user.id}:${magnet}`;
  if (wantFinalRedirect) {
    const cached = readCachedFinalUrl(cacheKey);
    if (cached) {
      return finalRedirectResponse(cached);
    }
  }

  const [row] = await db
    .select({ torboxApiKey: oneVid.torboxApiKey })
    .from(oneVid)
    .where(eq(oneVid.userId, session.user.id))
    .limit(1);

  const apiKey = row?.torboxApiKey ?? null;
  if (!apiKey) {
    return Response.json({ error: "Falta API key de TorBox" }, { status: 400 });
  }

  const resolved = await resolveTorboxStream({ apiKey, magnet }).catch(
    () => null
  );

  if (!resolved) {
    return Response.json(
      { error: "No se pudo resolver el stream" },
      { status: 502 }
    );
  }

  if (wantRedirect) {
    // `final` sigue la cadena de redirects en el servidor y manda al
    // CDN directo. Así el browser (o mediabunny con Range) no choca con el hop
    // de `requestdl`, que no refleja ACAO.
    if (wantFinalRedirect) {
      const target =
        (await resolveTorboxRedirect(resolved.url).catch(() => null)) ??
        resolved.url;
      writeCachedFinalUrl(cacheKey, target);
      return finalRedirectResponse(target);
    }
    return Response.redirect(resolved.url, 302);
  }
  return Response.json({ url: resolved.url, fileName: resolved.fileName });
}
