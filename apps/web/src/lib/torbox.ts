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

interface MylistEnvelope {
  data?: {
    files?: FileItem[];
    download_finished?: boolean;
    download_state?: unknown;
  };
}

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

async function listTorrentFiles(
  apiKey: string,
  torrentId: number
): Promise<FileItem[]> {
  const url = new URL(`${MAIN_BASE}/torrents/mylist`);
  url.searchParams.set("id", String(torrentId));
  url.searchParams.set("bypass_cache", "true");

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
  return Array.isArray(data.data?.files) ? data.data.files : [];
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

export async function resolveTorboxStream(params: {
  apiKey: string;
  magnet: string;
}): Promise<ResolvedStream | null> {
  const torrentId = await createTorrentFromMagnet(params.apiKey, params.magnet);
  if (torrentId === null) {
    return null;
  }
  const files = await listTorrentFiles(params.apiKey, torrentId);
  const best = pickBiggestVideoFile(files);
  if (!best) {
    return null;
  }
  const fileId = typeof best.id === "number" ? best.id : null;
  if (fileId === null) {
    return null;
  }
  const url = await requestDownloadUrl(params.apiKey, torrentId, fileId);
  if (!url) {
    return null;
  }
  return {
    url,
    fileName: typeof best.name === "string" ? best.name : undefined,
    fileSize: typeof best.size === "number" ? best.size : undefined,
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

export async function resolveTorboxRedirect(
  rawUrl: string
): Promise<string | null> {
  if (!isTorboxRedirectUrl(rawUrl)) {
    return null;
  }

  let current = rawUrl;
  for (let i = 0; i < MAX_REDIRECT_HOPS; i++) {
    // Validamos cada hop contra el SSRF guard; no limitamos el host de destino
    // porque los CDN de TorBox rotan (*.tb-cdn.io, etc.), pero sí rechazamos
    // IPs privadas/loopback.
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
