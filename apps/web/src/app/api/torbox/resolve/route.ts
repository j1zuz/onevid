import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { oneVid } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { resolveTorboxStream } from "@/lib/torbox";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const hash = url.searchParams.get("hash")?.trim() ?? "";
  const magnetParam = url.searchParams.get("magnet")?.trim() ?? "";
  const wantRedirect = url.searchParams.get("redirect") !== "0";

  if (!(hash || magnetParam)) {
    return Response.json({ error: "hash o magnet requerido" }, { status: 400 });
  }

  const magnet =
    magnetParam ||
    `magnet:?xt=urn:btih:${encodeURIComponent(hash)}&dn=${encodeURIComponent(hash)}`;

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
    return Response.redirect(resolved.url, 302);
  }
  return Response.json({ url: resolved.url, fileName: resolved.fileName });
}
