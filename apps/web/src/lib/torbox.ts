/**
 * TorBox debrid integration.
 *
 * Solo expone el resolver (createtorrent + mylist + requestdl) que toma un
 * magnet y devuelve la URL HTTP directa playable. La búsqueda (Scraper API)
 * está deshabilitada porque el plan Essential no la incluye.
 *
 * Main API: https://api.torbox.app/v1/api
 * Auth:     Authorization: Bearer <apiKey>  (token= en /requestdl)
 */

import { magnetInfoHash } from "@/lib/magnet";
import { isSafeFetchUrl, safeFetch } from "@/utils/ssrf-guard";
import { isTorboxRedirectUrl } from "@/utils/stream-codec";

const MAIN_BASE = "https://api.torbox.app/v1/api";

const VIDEO_EXT_RE = /\.(mp4|mkv|webm|avi|mov|m4v|ts|flv|m3u8)$/i;

export interface ResolvedStream {
  fileName?: string;
  fileSize?: number;
  url: string;
}

interface CreateTorrentEnvelope {
  data?: { torrent_id?: unknown; hash?: unknown };
  success?: boolean;
}

interface FileItem {
  id?: unknown;
  mimetype?: unknown;
  name?: unknown;
  s3_path?: unknown;
  size?: unknown;
}

interface TorrentItem {
  download_finished?: unknown;
  download_present?: unknown;
  download_state?: unknown;
  files?: FileItem[];
  hash?: unknown;
  id?: unknown;
  progress?: unknown;
}

interface MylistEnvelope {
  data?: TorrentItem | TorrentItem[] | null;
  success?: boolean;
}

/**
 * Resultado de resolver un magnet. `preparing` significa que el torrent ya está
 * en la cuenta pero TorBox todavía no terminó de bajarlo: no es un error, hay
 * que esperar en vez de devolver un 502 que el usuario lee como "fuente rota".
 */
export type TorboxStreamResult =
  | { progress: number | null; state: string | null; status: "preparing" }
  | { status: "ready"; stream: ResolvedStream }
  | { status: "unavailable" };

// Estados en los que TorBox ya sirve el archivo por HTTP. `downloading` NO está
// aquí a propósito: en ese estado el CDN puede devolver 403 en el rango pedido.
const TORRENT_READY_STATES = new Set([
  "cached",
  "completed",
  "finished",
  "seeding",
  "uploading",
]);

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

interface RequestDlEnvelope {
  data?: unknown;
  success?: boolean;
}

function isVideoFile(file: FileItem): boolean {
  const name = typeof file.name === "string" ? file.name : "";
  const mime = typeof file.mimetype === "string" ? file.mimetype : "";
  return VIDEO_EXT_RE.test(name) || mime.startsWith("video/");
}

function pickBiggestVideoFile(files: FileItem[]): FileItem | null {
  let best: FileItem | null = null;
  let bestSize = -1;
  for (const f of files) {
    if (!isVideoFile(f)) {
      continue;
    }
    const sz = typeof f.size === "number" ? f.size : 0;
    if (sz > bestSize) {
      best = f;
      bestSize = sz;
    }
  }
  return best;
}

/**
 * Normaliza un info-hash a hex minúscula. El magnet acepta base32 además de
 * hex, pero TorBox publica siempre hex: sin normalizar, un magnet en base32 no
 * se reconoce como "ya existe en la cuenta" y se vuelve a crear (duplicado).
 */
export function normalizeInfoHash(raw: string): string | null {
  const value = raw.trim();
  if (/^[0-9a-f]{40}$/i.test(value)) {
    return value.toLowerCase();
  }
  // El base32 de un magnet se escribe en mayúsculas por convención, pero hay
  // enlaces en minúsculas: se normaliza antes de validar.
  const base32 = value.toUpperCase();
  if (!/^[A-Z2-7]{32}$/.test(base32)) {
    return null;
  }
  let bits = "";
  for (const char of base32) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) {
      return null;
    }
    bits += index.toString(2).padStart(5, "0");
  }
  let hex = "";
  for (let i = 0; i < 160; i += 8) {
    hex += Number.parseInt(bits.slice(i, i + 8), 2)
      .toString(16)
      .padStart(2, "0");
  }
  return hex;
}

function mylistItems(data: MylistEnvelope["data"]): TorrentItem[] {
  if (Array.isArray(data)) {
    return data;
  }
  return data && typeof data === "object" ? [data] : [];
}

async function mylist(
  apiKey: string,
  torrentId?: number
): Promise<TorrentItem[]> {
  const url = new URL(`${MAIN_BASE}/torrents/mylist`);
  url.searchParams.set("bypass_cache", "true");
  if (torrentId !== undefined) {
    url.searchParams.set("id", String(torrentId));
  }

  const res = await safeFetch(url.toString(), {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
    },
  });
  if (!res.ok) {
    return [];
  }
  const data = (await res.json().catch(() => ({}))) as MylistEnvelope;
  return mylistItems(data.data);
}

async function findTorrentByHash(
  apiKey: string,
  infoHashHex: string
): Promise<TorrentItem | null> {
  const torrents = await mylist(apiKey);
  for (const torrent of torrents) {
    if (typeof torrent.hash !== "string") {
      continue;
    }
    if (torrent.hash.trim().toLowerCase() === infoHashHex) {
      return torrent;
    }
  }
  return null;
}

async function getTorrent(
  apiKey: string,
  torrentId: number
): Promise<TorrentItem | null> {
  const [torrent] = await mylist(apiKey, torrentId);
  return torrent ?? null;
}

function torrentReadiness(torrent: TorrentItem): {
  progress: number | null;
  ready: boolean;
  state: string | null;
} {
  const state =
    typeof torrent.download_state === "string"
      ? torrent.download_state.trim().toLowerCase()
      : null;
  const ready =
    torrent.download_present === true ||
    torrent.download_finished === true ||
    (state !== null && TORRENT_READY_STATES.has(state));

  let progress: number | null = null;
  if (typeof torrent.progress === "number" && Number.isFinite(torrent.progress)) {
    const normalized = torrent.progress > 1 ? torrent.progress / 100 : torrent.progress;
    progress = Math.min(1, Math.max(0, normalized));
  }

  return { progress, ready, state };
}

async function createTorrentFromMagnet(
  apiKey: string,
  magnet: string
): Promise<number | null> {
  const body = new FormData();
  body.append("magnet", magnet);
  body.append("allow_zip", "false");
  body.append("as_queued", "false");

  const res = await safeFetch(`${MAIN_BASE}/torrents/createtorrent`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body,
  });
  if (!res.ok) {
    return null;
  }
  const data = (await res.json().catch(() => ({}))) as CreateTorrentEnvelope;
  const id = data.data?.torrent_id;
  return typeof id === "number" ? id : null;
}

async function requestDownloadUrl(
  apiKey: string,
  torrentId: number,
  fileId: number
): Promise<string | null> {
  const url = new URL(`${MAIN_BASE}/torrents/requestdl`);
  url.searchParams.set("token", apiKey);
  url.searchParams.set("torrent_id", String(torrentId));
  url.searchParams.set("file_id", String(fileId));
  url.searchParams.set("zip", "false");
  url.searchParams.set("redirect", "false");

  const res = await safeFetch(url.toString(), {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    return null;
  }
  const data = (await res.json().catch(() => ({}))) as RequestDlEnvelope;
  return typeof data.data === "string" ? data.data : null;
}

/**
 * Resuelve un magnet a una URL HTTP del CDN de TorBox, sin crear torrents
 * duplicados.
 *
 * Orden:
 *  1. Si el torrent ya está en la cuenta (mismo info-hash) se reutiliza. Antes
 *     se llamaba siempre a `createtorrent`, que falla con un duplicado → 502
 *     aunque el archivo estuviera listo para descargar.
 *  2. Si no está, se crea y se espera a que TorBox tenga el archivo. Mientras
 *     tanto se devuelve `preparing` (con estado y progreso) en vez de un error:
 *     el cliente puede mostrar "preparando en debrid…" y reintentar.
 *  3. `requestdl` se intenta igual aunque el torrent figure en descarga: TorBox
 *     sirve por streaming lo que ya tiene, y así no se pierde ese caso.
 */
export async function resolveTorboxStream(params: {
  apiKey: string;
  magnet: string;
}): Promise<TorboxStreamResult> {
  const { apiKey, magnet } = params;
  const rawHash = magnetInfoHash(magnet);
  const infoHash = rawHash ? normalizeInfoHash(rawHash) : null;

  let torrent = infoHash ? await findTorrentByHash(apiKey, infoHash) : null;

  if (!torrent) {
    const createdId = await createTorrentFromMagnet(apiKey, magnet);
    if (createdId === null) {
      // Puede haber fallado justo por duplicado (carrera con otra pestaña).
      torrent = infoHash ? await findTorrentByHash(apiKey, infoHash) : null;
      if (!torrent) {
        return { status: "unavailable" };
      }
    } else {
      torrent = await getTorrent(apiKey, createdId);
    }
  }

  if (!torrent) {
    return { status: "preparing", progress: null, state: null };
  }

  const torrentId = typeof torrent.id === "number" ? torrent.id : null;
  if (torrentId === null) {
    return { status: "unavailable" };
  }
  // `mylist` sin `id` (la búsqueda por hash) no garantiza traer los archivos:
  // se pide el detalle para no declarar "preparing" un torrent que ya está
  // listo solo porque no vimos la lista de ficheros.
  const detail = (await getTorrent(apiKey, torrentId)) ?? torrent;
  const readiness = torrentReadiness(detail);
  const files = Array.isArray(detail.files) ? detail.files : [];
  const best = pickBiggestVideoFile(files);

  if (best) {
    const fileId = typeof best.id === "number" ? best.id : null;
    if (fileId !== null) {
      const url = await requestDownloadUrl(apiKey, torrentId, fileId);
      if (url) {
        return {
          status: "ready",
          stream: {
            url,
            fileName: typeof best.name === "string" ? best.name : undefined,
            fileSize: typeof best.size === "number" ? best.size : undefined,
          },
        };
      }
    }
  }

  // Sin archivo servible: si TorBox todavía está bajándolo es `preparing`; si
  // ya terminó y aun así no hay link, es un fallo real.
  return readiness.ready
    ? { status: "unavailable" }
    : {
        status: "preparing",
        progress: readiness.progress,
        state: readiness.state,
      };
}

/**
 * Sigue la cadena de redirects de TorBox desde el server (sin CORS) hasta la
 * URL final del CDN, que el browser sí puede leer con `fetch()` (refleja
 * ACAO + soporta Range). `api.torbox.app/requestdl` con `redirect=true` ya
 * devuelve la URL del CDN en su cabecera `Location`, así que basta con no
 * seguirlo automáticamente y leer el `Location` del 3xx.
 *
 * Devuelve `null` si la URL no es un redirect TorBox, o si la cadena no termina
 * en una URL jugable (timeout, demasiados hops, o destino no permitido). El
 * SSRF guard se aplica a cada hop: nunca fetchamos un host privado/loopback.
 */
export { isTorboxRedirectUrl } from "@/utils/stream-codec";

const MAX_REDIRECT_HOPS = 6;
// Solo la API de TorBox puede ser el primer hop (o cualquier hop intermedio)
// de un redirect que nosotros mismos fetchamos. El resto de hosts con
// `/resolve/torbox/` solo se acepta si pertenece a un addon del usuario; sin
// este limite, `POST /api/stream/resolve` seria un SSRF ciego generico.
const TORBOX_API_HOSTS = new Set(["api.torbox.app"]);

function isPermittedResolveHost(
  url: string,
  allowedHosts?: ReadonlySet<string>
): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return TORBOX_API_HOSTS.has(host) || Boolean(allowedHosts?.has(host));
  } catch {
    return false;
  }
}

export async function resolveTorboxRedirect(
  rawUrl: string,
  options: { allowedHosts?: ReadonlySet<string> } = {}
): Promise<string | null> {
  if (!isTorboxRedirectUrl(rawUrl)) {
    return null;
  }

  const { allowedHosts } = options;
  let current = rawUrl;
  for (let i = 0; i < MAX_REDIRECT_HOPS; i++) {
    // Validamos cada hop contra el SSRF guard; no limitamos el host de destino
    // del CDN (rotan: *.tb-cdn.io, etc.), pero sí rechazamos IPs
    // privadas/loopback y hosts que no sean de confianza para resolver.
    const check = isSafeFetchUrl(current);
    if (!check.ok) {
      return null;
    }

    // Si la URL actual ya no es un endpoint que sabemos que redirige (la API
    // de TorBox o un addon debrid con `/resolve/torbox/`), entonces es el CDN
    // final: lo devolvemos SIN fetchearlo (pesa GB y no hace falta — solo
    // queremos la URL). Cortar acá evita descargar el archivo entero por el
    // server.
    if (!isTorboxRedirectUrl(current)) {
      return current;
    }

    if (!isPermittedResolveHost(current, allowedHosts)) {
      return null;
    }

    // Forzamos `redirect: "manual"` para leer el `Location` nosotros: así no
    // dejamos que fetch siga el 307 del endpoint de descarga (que rompe CORS en
    // el browser) y nos quedamos con la URL del CDN a la que apunta. Usamos
    // HEAD para no descargar body — solo queremos el status/Location del
    // redirect.
    const res = await safeFetch(current, {
      method: "HEAD",
      redirect: "manual",
      headers: { accept: "application/json, */*" },
    });

    // 3xx: leer el Location y continuar la cadena al próximo hop.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
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
