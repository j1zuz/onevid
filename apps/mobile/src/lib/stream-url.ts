import {
  API_URL,
  appClientHeaders,
  getAccessToken,
} from '@/lib/auth';
import { LruTtlCache } from '@/lib/lru-ttl-cache';

// Resolución de la URL de un medio antes de dársela a libVLC: saneado,
// resolución del proxy del backend y seguimiento de la redirección al CDN.
// Vive fuera de player.tsx para que la pantalla de detalle pueda precalentarla
// sin importar la ruta del reproductor.

// Timeout de resolveRedirect(). Antes 4000ms: telemetría de PostHog
// (player_source_probe) mostró que ~17% de las fuentes que VLC descartaba como
// "no se pudo abrir" en realidad respondían 206 con vídeo válido cuando la
// sonda de diagnóstico las probaba con su timeout de 6000ms — es decir, la
// redirección (302) de hosts debrid/torbox lentos no llegaba a resolverse a
// tiempo y VLC recibía la URL sin resolver. Igualamos/superamos el margen de
// la sonda para que la ruta real tenga, como mínimo, la misma oportunidad.
//
// 15s (antes 8s): el backend espera hasta 8s a que TorBox/Real-Debrid termine
// de preparar un torrent y luego responde 202. Con 8s el cliente abortaba justo
// cuando el servidor iba a contestar (10% de timeouts medidos en PostHog). El
// margen extra cubre esa espera + red + auth. Si sigue preparando, el player
// reintenta con `Retry-After` (ver StreamPreparingError).
export const STREAM_REDIRECT_TIMEOUT_MS = 15_000;

/** El debrid todavía está preparando el torrent (HTTP 202 + Retry-After). */
export class StreamPreparingError extends Error {
  readonly retryAfterMs: number;
  readonly progress: number | null;

  constructor(
    message: string,
    retryAfterMs: number,
    progress: number | null = null,
  ) {
    super(message);
    this.name = 'StreamPreparingError';
    this.retryAfterMs = retryAfterMs;
    this.progress = progress;
  }
}

// User-Agent de navegador: evita 403 de hosts que rechazan el UA por defecto de
// VLC. Se usa tanto en las opciones de libVLC como en la sonda de diagnóstico,
// para que ambos vean exactamente la misma respuesta del host.
export const STREAM_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export type ResolvedStream = {
  url: string;
  fileName?: string;
  redirect: RedirectResolution;
};

export type RedirectResolution = {
  url: string | null;
  timedOut: boolean;
  tookMs: number;
};

// Algunos hosts entregan la URL final por redirección (302) y libVLC no siempre
// la sigue, aunque `fetch` sí lo hace. Seguimos la redirección con el mismo UA y,
// si el host responde OK con una URL distinta, devolvemos esa URL final para
// dársela directamente a VLC. Best-effort: ante cualquier fallo devolvemos null.
// También reporta cuánto tardó y si expiró el timeout, para telemetría.
async function resolveRedirect(url: string): Promise<RedirectResolution> {
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(
      url,
      { method: 'GET', headers: { Range: 'bytes=0-1', 'User-Agent': STREAM_UA } },
      STREAM_REDIRECT_TIMEOUT_MS,
      true,
    );
    const tookMs = Date.now() - started;
    if (res.ok && res.url && res.url !== url) {
      return { url: res.url, timedOut: false, tookMs };
    }
    return { url: null, timedOut: false, tookMs };
  } catch (e) {
    const tookMs = Date.now() - started;
    // El nombre del error no basta: en React Native el abort no siempre llega
    // como `AbortError`, y por eso la telemetría reportaba 0 timeouts sobre 436
    // resoluciones aunque el p90 estuviera clavado en el límite. Si el fetch
    // falló habiendo agotado el presupuesto, fue un timeout.
    const timedOut =
      (e instanceof Error && e.name === 'AbortError') ||
      tookMs >= STREAM_REDIRECT_TIMEOUT_MS;
    return { url: null, timedOut, tookMs };
  }
}

// expo-libvlc-player valida la URL con `java.net.URI(source)` (parser estricto
// RFC-2396) ANTES de pasarla a libVLC, y lanza "Invalid source, media could not
// be set" si hay caracteres ilegales sin codificar — aunque el enlace sea válido
// y `fetch`/`android.net.Uri` lo acepten. Percent-encodeamos solo esos
// caracteres (sin tocar `%` para no romper secuencias %XX ya válidas).
export function sanitizeUrlForVlc(url: string): string {
  return url
    .replace(/[ "<>\\^`{|}\[\]]/g, (c) => encodeURIComponent(c))
    .replace(/[^\x00-\x7F]/g, (c) => encodeURIComponent(c));
}

// `fetch` con tope de tiempo (AbortController). Imprescindible para que una
// sonda/redirección/resolución contra un host muerto o colgado no deje el flujo
// esperando: al vencer aborta y el caller hace fallback a otra fuente.
//
// `discardBody`: los callers que solo leen cabeceras/estado/URL (resolveRedirect
// y las sondas de rango) nunca consumen el cuerpo. En Expo SDK 56 el `fetch`
// global lo sirve `expo.modules.fetch`, y un cuerpo sin consumir mantiene vivo
// un `NativeResponse` nativo hasta el GC; Expo entonces cancela un objeto
// compartido que ya liberó (crash `NativeResponse.cancelStreaming`). Cancelamos
// el cuerpo aquí para soltar la conexión nativa en el acto. El caller de JSON
// (/api/) deja `discardBody` en false porque él sí lee `res.json()`.
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  discardBody = false,
): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    // Best-effort: si el cuerpo ya se cerró, ignoramos el fallo.
    if (discardBody) void res.body?.cancel().catch(() => {});
    return res;
  } finally {
    clearTimeout(t);
  }
}

// Resoluciones ya hechas, por URL cruda. Seguir la redirección cuesta 2,9 s de
// mediana en teléfono y 4,9 s en TV (medido en PostHog), y es un coste que se
// pagaba ENTERO otra vez en cada reintento, en cada salto de fuente y al volver
// a entrar al mismo título. La ventana es la misma que la de `sourcesQueryOptions`
// (60 s): margen de sobra para el pre-warm del detalle sin llegar a reutilizar un
// enlace firmado ya caducado.
const RESOLVED_URL_TTL_MS = 60_000;
// Tope de entradas: el usuario puede recorrer muchas fuentes/títulos y este
// `Map` vivía toda la sesión. 100 URLs resueltas cubren de sobra el pre-warm y
// el historial reciente sin crecer sin límite.
const RESOLVED_URL_CACHE_MAX_ENTRIES = 100;
const resolvedUrlCache = new LruTtlCache<string, ResolvedStream>(
  RESOLVED_URL_CACHE_MAX_ENTRIES,
);

/**
 * Listas HLS/DASH. Estos orígenes NO se pre-resuelven: varios paneles (XC_VM,
 * el del proveedor actual) responden el `.m3u8` con un 302 a
 * `/auth/<token>` y ese token caduca a los pocos minutos ("AES token has
 * expired"). Un directo refresca la lista cada ~6 s, así que si se le entrega a
 * libVLC la URL final del token, el canal muere al caducar. Con la URL estable,
 * VLC sigue el 302 y recibe un token nuevo en cada refresco (lo mismo que hace
 * hls.js en la web, y por eso ahí sí funciona).
 */
const MANIFEST_PATTERN = /\.(?:m3u8|mpd)(?:$|[?#])/i;

function isManifestUrl(value: string): boolean {
  try {
    return MANIFEST_PATTERN.test(new URL(value).pathname);
  } catch {
    return MANIFEST_PATTERN.test(value);
  }
}

/**
 * Adelanta la resolución de una fuente sin bloquear a nadie. La pantalla de
 * detalle la llama en cuanto tiene la lista de fuentes, así que al pulsar
 * Reproducir la URL final ya está en caché y el arranque se ahorra ese tramo
 * entero. Cualquier fallo se ignora: el camino normal la volverá a resolver.
 */
export function prewarmStreamUrl(raw: string): void {
  if (!raw || resolvedUrlCache.has(raw)) return;
  resolveStreamUrl(raw).catch(() => {
    /* best-effort */
  });
}

export async function resolveStreamUrl(raw: string): Promise<ResolvedStream> {
  const cached = resolvedUrlCache.get(raw);
  if (cached) {
    // `tookMs: 0` marca en la telemetría los arranques que salieron de caché,
    // para poder separarlos de los que sí pagaron la resolución.
    return { ...cached, redirect: { ...cached.redirect, tookMs: 0 } };
  }
  let url: string;
  let fileName: string | undefined;
  // Videos locales del dispositivo (galería / document picker): no hay proxy del
  // backend ni redirección que seguir. Los entregamos directos a VLC, solo
  // saneados. Sin esto, resolveRedirect haría un fetch GET (que falla con
  // file://) y se desperdiciaría un timeout.
  if (raw.startsWith('file://') || raw.startsWith('content://')) {
    return {
      url: sanitizeUrlForVlc(raw),
      redirect: { url: null, timedOut: false, tookMs: 0 },
    };
  }
  if (raw.startsWith('/api/')) {
    const sep = raw.includes('?') ? '&' : '?';
    const token = await getAccessToken();
    const res = await fetchWithTimeout(
      `${API_URL}${raw}${sep}redirect=0`,
      {
        headers: {
          Accept: 'application/json',
          ...appClientHeaders(),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      STREAM_REDIRECT_TIMEOUT_MS,
    );
    const data = (await res.json().catch(() => ({}))) as {
      url?: string;
      fileName?: string;
      error?: string;
      status?: string;
      progress?: number | null;
      retryAfter?: number;
    };
    // El debrid sigue preparando el torrent: no es un fallo definitivo. El
    // player reintenta tras `retryAfter` en vez de saltar a otra fuente.
    if (res.status === 202 || data.status === 'preparing') {
      const retryAfterSec =
        typeof data.retryAfter === 'number' && data.retryAfter > 0
          ? data.retryAfter
          : 6;
      throw new StreamPreparingError(
        data.error ?? 'El debrid todavía está preparando el archivo',
        retryAfterSec * 1_000,
        typeof data.progress === 'number' ? data.progress : null,
      );
    }
    if (!res.ok) {
      throw new Error(
        data.error ?? `No se pudo resolver el stream (HTTP ${res.status})`,
      );
    }
    if (!data.url) {
      throw new Error(data.error ?? 'El stream no devolvió una URL.');
    }
    url = sanitizeUrlForVlc(data.url);
    fileName = data.fileName;
  } else {
    url = sanitizeUrlForVlc(raw);
  }
  // Pre-resolver la redirección: muchos hosts devuelven una URL que a su vez
  // redirige (302), y libVLC no siempre la sigue limpio → fallaba antes del
  // primer fotograma, disparaba el fallback y REMONTABA el player (se veía la
  // carátula dos veces / "reinicio"). Seguimos la redirección aquí con `fetch` y
  // le entregamos a VLC la URL FINAL, así abre a la primera y sin doble arranque.
  // Excepción: listas HLS/DASH, cuyo redirect lleva un token temporal que
  // caduca mientras el directo se refresca (ver `isManifestUrl`). Ahí manda la
  // URL estable y el 302 lo sigue VLC.
  const redirect = isManifestUrl(url)
    ? { url: null, timedOut: false, tookMs: 0 }
    : await resolveRedirect(url);
  const resolved: ResolvedStream = {
    url: redirect.url ? sanitizeUrlForVlc(redirect.url) : url,
    fileName,
    redirect,
  };
  resolvedUrlCache.set(raw, resolved, RESOLVED_URL_TTL_MS);
  return resolved;
}


/**
 * Valida la URL que llega al reproductor. El deep link `onevid://player` es
 * exportado y cualquier app puede abrirlo; un `url=/api/...` ejecutaría una
 * petición autenticada con el Bearer del usuario (p. ej. el resolve de debrid,
 * que crea un torrent). Solo aceptamos:
 *  - URLs http(s) (fuentes de addons),
 *  - rutas internas `/api/...` y `file://`/`content://` cuando la navegación
 *    viene de la propia app (`from=app`; biblioteca local y player interno).
 * Esquemas como `javascript:`, `data:` o rutas relativas se rechazan.
 */
export function validatePlayerUrl(
  raw: string,
  from: string | undefined,
): { ok: boolean; url: string } {
  const value = raw.trim();
  if (!value) return { ok: false, url: '' };
  const internal = from === 'app';
  if (value.startsWith('/api/')) {
    return { ok: internal, url: internal ? value : '' };
  }
  if (value.startsWith('file://') || value.startsWith('content://')) {
    return { ok: internal, url: internal ? value : '' };
  }
  try {
    const parsed = new URL(value);
    const ok = parsed.protocol === 'https:' || parsed.protocol === 'http:';
    return { ok, url: ok ? value : '' };
  } catch {
    return { ok: false, url: '' };
  }
}
