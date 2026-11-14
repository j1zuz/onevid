/**
 * Resolución server-side de redirects opacos de los servicios debrid.
 *
 * Los links que devuelven TorBox (`requestdl`) y Real-Debrid (`/d/...`) hacen
 * un 3xx a un CDN que el browser NO puede seguir con `fetch()`: el hop
 * intermedio responde sin `Access-Control-Allow-Origin`, así que el fetch
 * aborta antes de llegar al CDN (que sí refleja ACAO y soporta Range). Acá se
 * sigue la cadena en el servidor y se devuelve la URL final.
 */

import { isDebridRedirectUrl } from "@/utils/stream-codec";
import { isSafeFetchUrl, safeFetch } from "@/utils/ssrf-guard";

const MAX_REDIRECT_HOPS = 6;

// Solo las APIs de los proveedores pueden ser el primer hop (o cualquier hop
// intermedio) de un redirect que nosotros mismos fetcheamos. Cualquier otro
// host con `/resolve/<proveedor>/` solo se acepta si pertenece a un addon del
// usuario; sin este limite, `POST /api/stream/resolve` seria un SSRF ciego
// generico.
const DEBRID_API_HOSTS = new Set(["api.torbox.app", "real-debrid.com"]);

function isPermittedResolveHost(
  url: string,
  allowedHosts?: ReadonlySet<string>
): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return DEBRID_API_HOSTS.has(host) || Boolean(allowedHosts?.has(host));
  } catch {
    return false;
  }
}

/**
 * Devuelve `null` si la URL no es un redirect de debrid conocido, o si la
 * cadena no termina en una URL jugable (timeout, demasiados hops, o destino no
 * permitido). El SSRF guard se aplica a cada hop: nunca fetchamos un host
 * privado/loopback.
 */
export async function resolveDebridRedirect(
  rawUrl: string,
  options: { allowedHosts?: ReadonlySet<string> } = {}
): Promise<string | null> {
  if (!isDebridRedirectUrl(rawUrl)) {
    return null;
  }

  const { allowedHosts } = options;
  let current = rawUrl;
  for (let i = 0; i < MAX_REDIRECT_HOPS; i++) {
    // Validamos cada hop contra el SSRF guard; no limitamos el host de destino
    // del CDN (rotan: *.tb-cdn.io, *.real-debrid.com, etc.), pero sí rechazamos
    // IPs privadas/loopback y hosts que no sean de confianza para resolver.
    const check = isSafeFetchUrl(current);
    if (!check.ok) {
      return null;
    }

    // Si la URL actual ya no es un endpoint que sabemos que redirige, entonces
    // es el CDN final: lo devolvemos SIN fetchearlo (pesa GB y no hace falta —
    // solo queremos la URL). Cortar acá evita descargar el archivo entero por
    // el server.
    if (!isDebridRedirectUrl(current)) {
      return current;
    }

    if (!isPermittedResolveHost(current, allowedHosts)) {
      return null;
    }

    // Forzamos `redirect: "manual"` para leer el `Location` nosotros: así no
    // dejamos que fetch siga el 307 del endpoint de descarga (que rompe CORS en
    // el browser) y nos quedamos con la URL del CDN a la que apunta. Usamos
    // HEAD para no descargar body — solo queremos el status/Location.
    const res = await safeFetch(current, {
      method: "HEAD",
      redirect: "manual",
      headers: { accept: "application/json, */*" },
    });

    // Algunos CDNs no implementan HEAD: se reintenta con GET de un solo byte y
    // `redirect: "manual"` para leer el Location sin bajar el archivo.
    const response =
      res.status === 405 || res.status === 501
        ? await safeFetch(current, {
            method: "GET",
            redirect: "manual",
            headers: { accept: "*/*", range: "bytes=0-0" },
          })
        : res;

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return null;
      }
      try {
        current = new URL(location, current).toString();
      } catch {
        return null;
      }
      continue;
    }

    // 2xx desde un endpoint que redirige no es un CDN jugable (no debería
    // pasar — estos endpoints siempre redirigen); 4xx/5xx = cadena rota.
    return null;
  }

  return null;
}
