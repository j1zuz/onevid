import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { resolveTorboxRedirect } from "@/lib/torbox";

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

  let body: { url?: unknown } = {};
  try {
    body = (await request.json()) as { url?: unknown };
  } catch {
    return Response.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    return Response.json({ error: "url requerido" }, { status: 400 });
  }

  const resolved = await resolveTorboxRedirect(url).catch(() => null);
  if (!resolved) {
    return Response.json({ error: "No se pudo resolver el stream" }, {
      status: 502,
    });
  }

  return Response.json({ url: resolved });
}
