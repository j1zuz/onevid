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

import type { DebridStreamResult } from "@/lib/debrid";
import { magnetInfoHash, normalizeInfoHash } from "@/lib/magnet";
import { safeFetch } from "@/utils/ssrf-guard";

const MAIN_BASE = "https://api.torbox.app/v1/api";

const VIDEO_EXT_RE = /\.(mp4|mkv|webm|avi|mov|m4v|ts|flv|m3u8)$/i;

export type TorboxKeyStatus = "valid" | "invalid" | "unreachable";

export interface TorboxKeyInfo {
  /** Mensaje que dio TorBox, si lo hubo. No incluye credenciales. */
  detail: string | null;
  /** Plan de la cuenta (0 Free, 1 Essential, …), si TorBox lo devolvió. */
  plan: number | null;
  status: TorboxKeyStatus;
}

/**
 * La API key existe pero TorBox la rechaza (401/403). Se distingue del resto de
 * fallos para no decirle al usuario "fuente rota" cuando lo que falla es la
 * cuenta: el reproductor necesita ese motivo para mandarlo a Configuración.
 */
class TorboxAuthError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "TorboxAuthError";
  }
}

interface TorboxErrorEnvelope {
  data?: unknown;
  detail?: unknown;
  error?: unknown;
  success?: unknown;
}

async function throwIfTorboxAuthFailure(res: Response): Promise<void> {
  if (res.status !== 401 && res.status !== 403) {
    return;
  }
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as TorboxErrorEnvelope | null;
  const code = typeof body?.error === "string" ? body.error : "";
  // TorBox responde 401 para tokens con formato inválido y 403 AUTH_ERROR
  // cuando la verificación del token falla (token revocado/vencido).
  if (res.status === 401 || code === "BAD_TOKEN" || code === "AUTH_ERROR") {
    const detail =
      typeof body?.detail === "string" && body.detail.trim()
        ? body.detail.trim()
        : "TorBox rechazó la API key";
    throw new TorboxAuthError(detail);
  }
}

/**
 * Comprueba la API key contra `GET /user/me` antes de guardarla. Antes de esto
 * cualquier token se aceptaba: una key vencida quedaba "conectada" y el fallo
 * aparecía recién al reproducir, como un 502 sin explicación.
 *
 * `unreachable` (red caída, 5xx de TorBox) NO significa key inválida: el
 * llamador puede decidir guardarla igual y reintentar más tarde.
 */
export async function validateTorboxKey(
  apiKey: string
): Promise<TorboxKeyInfo> {
  try {
    const res = await safeFetch(
      `${MAIN_BASE}/user/me`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
        },
      },
      // Es una comprobación de UI: no debe colgar la página 10 s si TorBox no
      // responde (en ese caso se trata como "unreachable" y no se bloquea).
      { timeoutMs: 4_000 }
    );
    const body = (await res
      .json()
      .catch(() => null)) as TorboxErrorEnvelope | null;
    const detail =
      typeof body?.detail === "string" && body.detail.trim()
        ? body.detail.trim()
        : null;

    if (res.ok && body?.success !== false) {
      const data =
        body?.data && typeof body.data === "object"
          ? (body.data as { plan?: unknown })
          : null;
      return {
        status: "valid",
        detail: null,
        plan: typeof data?.plan === "number" ? data.plan : null,
      };
    }

    const code = typeof body?.error === "string" ? body.error : "";
    if (
      res.status === 401 ||
      res.status === 403 ||
      code === "BAD_TOKEN" ||
      code === "AUTH_ERROR"
    ) {
      return { status: "invalid", detail, plan: null };
    }
    return { status: "unreachable", detail, plan: null };
  } catch {
    return { status: "unreachable", detail: null, plan: null };
  }
}

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
export type TorboxStreamResult = DebridStreamResult;

// Estados en los que TorBox ya sirve el archivo por HTTP. `downloading` NO está
// aquí a propósito: en ese estado el CDN puede devolver 403 en el rango pedido.
const TORRENT_READY_STATES = new Set([
  "cached",
  "completed",
  "finished",
  "seeding",
  "uploading",
]);

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
 * Normaliza un info-hash a hex minúscula. Vive en `lib/magnet.ts` porque lo
 * comparten todos los proveedores debrid; se re-exporta acá por compatibilidad
 * con los consumidores históricos de `lib/torbox`.
 */
export { normalizeInfoHash } from "@/lib/magnet";

// `mylist` devuelve el objeto completo de cada torrent (incluidos `files` y
// `magnet`): una biblioteca de 1000 torrents pesa ~7 MB y `safeFetch` corta el
// cuerpo a 1 MiB (SafeFetchError "too-large"). Antes se pedía la lista entera,
// así que cualquier cuenta con biblioteca grande fallaba con 502 al resolver un
// magnet. Se pagina con `limit`/`offset` (soportados por TorBox) para que cada
// respuesta quepa en el límite.
const MYLIST_PAGE_SIZE = 100;
// TorBox devolvía como máximo 1000 torrents en `mylist`; se mantiene ese mismo
// alcance (10 páginas) para no alargar el request buscando en bibliotecas
// enormes. Si el hash no aparece, el flujo sigue con `createtorrent`.
const MYLIST_MAX_PAGES = 10;

function mylistItems(data: MylistEnvelope["data"]): TorrentItem[] {
  if (Array.isArray(data)) {
    return data;
  }
  return data && typeof data === "object" ? [data] : [];
}

async function mylist(
  apiKey: string,
  options: { id?: number; limit?: number; offset?: number } = {}
): Promise<TorrentItem[]> {
  const { id, limit, offset } = options;
  const url = new URL(`${MAIN_BASE}/torrents/mylist`);
  url.searchParams.set("bypass_cache", "true");
  if (id !== undefined) {
    url.searchParams.set("id", String(id));
  }
  if (limit !== undefined) {
    url.searchParams.set("limit", String(limit));
  }
  if (offset !== undefined) {
    url.searchParams.set("offset", String(offset));
  }

  const res = await safeFetch(
    url.toString(),
    {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
    },
    // Margen sobre el ~0.5 MB que pesa una página de 100; el tope por defecto
    // (1 MiB) queda demasiado justo si varios torrents traen muchos ficheros.
    { maxBodyBytes: 2 * 1024 * 1024 }
  );
  if (!res.ok) {
    await throwIfTorboxAuthFailure(res);
    return [];
  }
  const data = (await res.json().catch(() => ({}))) as MylistEnvelope;
  return mylistItems(data.data);
}

async function findTorrentByHash(
  apiKey: string,
  infoHashHex: string
): Promise<TorrentItem | null> {
  for (let page = 0; page < MYLIST_MAX_PAGES; page++) {
    const torrents = await mylist(apiKey, {
      limit: MYLIST_PAGE_SIZE,
      offset: page * MYLIST_PAGE_SIZE,
    });
    for (const torrent of torrents) {
      if (typeof torrent.hash !== "string") {
        continue;
      }
      if (torrent.hash.trim().toLowerCase() === infoHashHex) {
        return torrent;
      }
    }
    // Última página: no hay más que recorrer.
    if (torrents.length < MYLIST_PAGE_SIZE) {
      return null;
    }
  }
  return null;
}

async function getTorrent(
  apiKey: string,
  torrentId: number
): Promise<TorrentItem | null> {
  const [torrent] = await mylist(apiKey, { id: torrentId });
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
    await throwIfTorboxAuthFailure(res);
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
    await throwIfTorboxAuthFailure(res);
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
  try {
    return await resolveTorboxStreamUnchecked(params);
  } catch (error) {
    if (error instanceof TorboxAuthError) {
      // El motivo viaja al endpoint y de ahí a la UI: "conecta tu cuenta" no
      // se puede deducir de un 502.
      return {
        status: "unavailable",
        reason: "La API key de debrid fue rechazada (token vencido o revocado)",
      };
    }
    throw error;
  }
}

async function resolveTorboxStreamUnchecked(params: {
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
        return {
          status: "unavailable",
          reason:
            "TorBox no pudo agregar el magnet (puede no tener fuentes o exceder el límite de descargas activas)",
        };
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
    ? {
        status: "unavailable",
        reason: "TorBox terminó el torrent pero no entregó un link reproducible",
      }
    : {
        status: "preparing",
        progress: readiness.progress,
        state: readiness.state,
      };
}
