import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { oneVidAddon } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { resolveTorboxRedirect } from "@/lib/torbox";

export const runtime = "nodejs";

// Resuelve server-side la cadena de redirects de TorBox y devuelve la URL
// final del CDN, que el browser puede leer con `fetch()` (refleja ACAO + soporta
// Range). El hop intermedio `api.torbox.app/requestdl?...&redirect=true` responde
// el 307 con `Access-Control-Allow-Credentials: true` pero SIN `Access-Control-
// Allow-Origin`, así que un `fetch()` cross-origin aborta ahí ("Failed to fetch")
// antes de llegar al CDN. Lo saltamos del lado del server. Ver
// `resolveTorboxRedirect` en src/lib/torbox.ts.
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const limited = checkRateLimit(
    `stream-resolve:${session.user.id}`,
    60,
    60_000
  );
  if (!limited.ok) return rateLimitResponse(limited.retryAfter);

  let body: { url?: unknown } = {};
  try {
    body = (await request.json()) as { url?: unknown };
  } catch {
    return Response.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url || url.length > 4096) {
    return Response.json({ error: "url requerido" }, { status: 400 });
  }

  // Solo se aceptan redirects de la API de TorBox o de los addons que el
  // usuario tiene registrados. Sin esto, cualquier host con `/resolve/torbox/`
  // en el path convertiría esta ruta en un SSRF ciego genérico.
  const addons = await db
    .select({ baseUrl: oneVidAddon.baseUrl })
    .from(oneVidAddon)
    .where(eq(oneVidAddon.userId, session.user.id));

  const allowedHosts = new Set<string>();
  for (const addon of addons) {
    try {
      allowedHosts.add(new URL(addon.baseUrl).hostname.toLowerCase());
    } catch {
      /* baseUrl corrupta: se ignora. */
    }
  }

  const resolved = await resolveTorboxRedirect(url, { allowedHosts }).catch(
    () => null
  );
  if (!resolved) {
    return Response.json({ error: "No se pudo resolver el stream" }, {
      status: 502,
    });
  }

  return Response.json({ url: resolved });
}
