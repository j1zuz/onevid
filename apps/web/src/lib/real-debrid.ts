/**
 * Real-Debrid debrid integration.
 *
 * Expone el resolver de magnets que usa la API privada del usuario:
 * `torrents/addMagnet` → `torrents/selectFiles` → `torrents/info` (poll) →
 * `unrestrict/link` para obtener la URL HTTP directa playable.
 *
 * Main API: https://api.real-debrid.com/rest/1.0
 * Auth:     Authorization: Bearer <private token>
 * Docs:     https://api.real-debrid.com/
 */

import type { DebridStreamResult } from "@/lib/debrid";
import { magnetInfoHash, normalizeInfoHash } from "@/lib/magnet";
import { safeFetch } from "@/utils/ssrf-guard";

const API_BASE = "https://api.real-debrid.com/rest/1.0";

const VIDEO_EXT_RE = /\.(mp4|mkv|webm|avi|mov|m4v|ts|flv|m3u8)$/i;

// La lista de torrents puede traer miles de entradas; el guard SSRF corta en
// 1 MiB por defecto y acá ese límite es demasiado chico.
const TORRENT_LIST_MAX_BYTES = 8 * 1024 * 1024;
const TORRENT_LIST_LIMIT = 5000;
// Un torrent sin cachear puede tardar minutos. No vale la pena abrir más de
// unos pocos links por request: el archivo grande casi siempre es el primero.
const MAX_UNRESTRICT_ATTEMPTS = 6;

// Estados en los que RD todavía está trabajando en el archivo. Todos se
// traducen a `preparing` para que el cliente reintente en vez de ver un 502.
const WORKING_STATES = new Set([
  "magnet_conversion",
  "queued",
  "downloading",
  "compressing",
  "uploading",
]);

const ERROR_STATES = new Set(["magnet_error", "error", "virus", "dead"]);

interface TorrentFile {
  bytes?: unknown;
  id?: unknown;
  path?: unknown;
  selected?: unknown;
}

interface TorrentInfo {
  files?: TorrentFile[];
  hash?: unknown;
  id?: unknown;
  links?: unknown;
  progress?: unknown;
  status?: unknown;
}

interface TorrentSummary {
  hash?: unknown;
  id?: unknown;
  status?: unknown;
}

interface UnrestrictedLink {
  download?: unknown;
  filename?: unknown;
  filesize?: unknown;
  mimeType?: unknown;
}

interface AddMagnetResponse {
  id?: unknown;
  uri?: unknown;
}

export interface RealDebridKeyInfo {
  premium: boolean;
  username: string | null;
  valid: boolean;
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    accept: "application/json",
    authorization: `Bearer ${apiKey}`,
  };
}

function formBody(values: Record<string, string>): URLSearchParams {
  return new URLSearchParams(values);
}

async function rdFetch(
  apiKey: string,
  path: string,
  init: {
    body?: URLSearchParams;
    maxBodyBytes?: number;
    method?: "GET" | "POST";
  } = {}
): Promise<Response | null> {
  try {
    return await safeFetch(
      `${API_BASE}${path}`,
      {
        method: init.method ?? "GET",
        // La API vive en un host fijo: si respondiera un redirect, seguir no
        // debe reenviar el token privado a otro origen.
        redirect: "manual",
        headers: {
          ...authHeaders(apiKey),
          ...(init.body
            ? { "content-type": "application/x-www-form-urlencoded" }
            : {}),
        },
        ...(init.body ? { body: init.body } : {}),
      },
      init.maxBodyBytes ? { maxBodyBytes: init.maxBodyBytes } : undefined
    );
  } catch {
    return null;
  }
}

async function rdJson<T>(
  apiKey: string,
  path: string,
  init: Parameters<typeof rdFetch>[2] = {}
): Promise<T | null> {
  const res = await rdFetch(apiKey, path, init);
  if (!res?.ok) {
    return null;
  }
  return (await res.json().catch(() => null)) as T | null;
}

/**
 * Valida la token privada con /user. Se usa al guardarla para que un token
 * vencido no parezca "conectado" hasta que el usuario intenta reproducir.
 */
export async function validateRealDebridKey(
  apiKey: string
): Promise<RealDebridKeyInfo> {
  const user = await rdJson<{
    premium?: unknown;
    type?: unknown;
    username?: unknown;
  }>(apiKey, "/user");
  if (!user) {
    return { valid: false, premium: false, username: null };
  }
  const premiumSeconds =
    typeof user.premium === "number" ? user.premium : Number(user.premium);
  return {
    valid: true,
    premium: user.type === "premium" || premiumSeconds > 0,
    username: typeof user.username === "string" ? user.username : null,
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isVideoPath(path: string): boolean {
  return VIDEO_EXT_RE.test(path);
}

async function listTorrents(apiKey: string): Promise<TorrentSummary[]> {
  const data = await rdJson<unknown>(
    apiKey,
    `/torrents?limit=${TORRENT_LIST_LIMIT}`,
    { maxBodyBytes: TORRENT_LIST_MAX_BYTES }
  );
  return Array.isArray(data) ? (data as TorrentSummary[]) : [];
}

async function findTorrentByHash(
  apiKey: string,
  infoHashHex: string
): Promise<TorrentSummary | null> {
  const torrents = await listTorrents(apiKey);
  for (const torrent of torrents) {
    if (stringValue(torrent.hash).toLowerCase() === infoHashHex) {
      return torrent;
    }
  }
  return null;
}

async function addMagnetFromMagnet(
  apiKey: string,
  magnet: string
): Promise<string | null> {
  const data = await rdJson<AddMagnetResponse>(apiKey, "/torrents/addMagnet", {
    method: "POST",
    body: formBody({ magnet }),
  });
  const id = data?.id;
  return typeof id === "string" && id ? id : null;
}

async function selectAllFiles(
  apiKey: string,
  torrentId: string
): Promise<void> {
  // 204 = seleccionado, 202 = ya estaba hecho. Cualquier otro código se ignora:
  // el siguiente `torrents/info` dice si el torrent puede avanzar.
  await rdFetch(
    apiKey,
    `/torrents/selectFiles/${encodeURIComponent(torrentId)}`,
    { method: "POST", body: formBody({ files: "all" }) }
  );
}

async function getTorrentInfo(
  apiKey: string,
  torrentId: string
): Promise<TorrentInfo | null> {
  return rdJson<TorrentInfo>(
    apiKey,
    `/torrents/info/${encodeURIComponent(torrentId)}`
  );
}

async function unrestrictLink(
  apiKey: string,
  link: string
): Promise<UnrestrictedLink | null> {
  return rdJson<UnrestrictedLink>(apiKey, "/unrestrict/link", {
    method: "POST",
    body: formBody({ link }),
  });
}

interface LinkCandidate {
  bytes: number;
  link: string;
  path: string;
}

/**
 * Links del torrent ordenados por probabilidad de ser el video principal.
 *
 * `torrents/info.links` sigue el orden de los archivos seleccionados, así que
 * cuando los conteos coinciden se puede ordenar por tamaño real. Si no
 * coinciden (RD cambió de criterio o el torrent sigue preparándose), se
 * devuelven en el orden de la lista y el nombre del `unrestrict` decide.
 */
function linkCandidates(info: TorrentInfo): LinkCandidate[] {
  const links = Array.isArray(info.links)
    ? info.links.filter((link): link is string => typeof link === "string")
    : [];
  if (links.length === 0) {
    return [];
  }

  const files = Array.isArray(info.files) ? info.files : [];
  const selected = files.filter((file) => Number(file.selected) === 1);
  const aligned = selected.length === links.length;

  const rows: LinkCandidate[] = aligned
    ? selected.map((file, index) => ({
        bytes: numberValue(file.bytes),
        link: links[index],
        path: stringValue(file.path),
      }))
    : links.map((link) => ({ bytes: 0, link, path: "" }));

  const videos = rows.filter((row) => isVideoPath(row.path));
  const pool = videos.length > 0 ? videos : rows;
  return pool.sort((a, b) => b.bytes - a.bytes);
}

function readiness(info: TorrentInfo): {
  progress: number | null;
  state: string | null;
  status: string;
} {
  const status = stringValue(info.status).toLowerCase();
  const rawProgress = numberValue(info.progress);
  const progress =
    rawProgress > 0 ? Math.min(1, Math.max(0, rawProgress / 100)) : null;
  return { progress, status, state: status || null };
}

/**
 * Resuelve un magnet a una URL HTTP del CDN de Real-Debrid, sin duplicar
 * torrents en la cuenta.
 *
 * Orden:
 *  1. Si el info-hash ya está en la cuenta se reutiliza (addMagnet de un
 *     duplicado falla con error 33 y no devuelve el id existente).
 *  2. Si no está, se agrega y se seleccionan todos los archivos.
 *  3. Mientras RD lo prepara se devuelve `preparing` con estado y progreso.
 *  4. Cuando está `downloaded`, se desrestrictiona el link del archivo más
 *     grande que parezca video.
 */
export async function resolveRealDebridStream(params: {
  apiKey: string;
  magnet: string;
}): Promise<DebridStreamResult> {
  const { apiKey, magnet } = params;
  const rawHash = magnetInfoHash(magnet);
  const infoHash = rawHash ? normalizeInfoHash(rawHash) : null;

  let torrentId: string | null = null;
  if (infoHash) {
    const existing = await findTorrentByHash(apiKey, infoHash);
    torrentId = existing && stringValue(existing.id)
      ? stringValue(existing.id)
      : null;
  }

  let addedNow = false;
  if (!torrentId) {
    torrentId = await addMagnetFromMagnet(apiKey, magnet);
    addedNow = Boolean(torrentId);
  }

  if (!torrentId) {
    // El add pudo fallar justo por duplicado (carrera con otra pestaña o un
    // torrent que no estaba en la primera página de la lista).
    const existing = infoHash
      ? await findTorrentByHash(apiKey, infoHash)
      : null;
    torrentId = existing && stringValue(existing.id)
      ? stringValue(existing.id)
      : null;
    if (!torrentId) {
      return { status: "unavailable" };
    }
  }

  let info = await getTorrentInfo(apiKey, torrentId);
  if (!info) {
    // Recién agregado: RD tarda un instante en exponerlo en /torrents/info.
    // Devolver 202 hace que el cliente reintente en vez de leer un 502 como
    // "la fuente está rota".
    return addedNow
      ? { status: "preparing", progress: null, state: null }
      : { status: "unavailable" };
  }

  const { status } = readiness(info);

  if (status === "waiting_files_selection") {
    await selectAllFiles(apiKey, torrentId);
    info = (await getTorrentInfo(apiKey, torrentId)) ?? info;
  }

  const next = readiness(info);

  if (next.status === "downloaded") {
    let candidates = linkCandidates(info).slice(0, MAX_UNRESTRICT_ATTEMPTS);
    // Un torrent terminado sin links puede tener los archivos sin seleccionar
    // (p. ej. agregado desde otro cliente): seleccionarlos genera los links.
    if (candidates.length === 0) {
      await selectAllFiles(apiKey, torrentId);
      info = (await getTorrentInfo(apiKey, torrentId)) ?? info;
      candidates = linkCandidates(info).slice(0, MAX_UNRESTRICT_ATTEMPTS);
    }
    let fallback: { fileName?: string; fileSize?: number; url: string } | null =
      null;
    for (const candidate of candidates) {
      const unrestricted = await unrestrictLink(apiKey, candidate.link);
      const url = stringValue(unrestricted?.download);
      if (!url) {
        continue;
      }
      const fileName =
        stringValue(unrestricted?.filename) || candidate.path || undefined;
      const stream = {
        url,
        ...(fileName ? { fileName } : {}),
        ...(numberValue(unrestricted?.filesize) > 0
          ? { fileSize: numberValue(unrestricted?.filesize) }
          : {}),
      };
      if (isVideoPath(fileName ?? "")) {
        return { status: "ready", stream };
      }
      fallback ??= stream;
    }
    if (fallback) {
      return { status: "ready", stream: fallback };
    }
    return { status: "unavailable" };
  }

  if (ERROR_STATES.has(next.status)) {
    return { status: "unavailable" };
  }

  if (WORKING_STATES.has(next.status) || next.status === "waiting_files_selection") {
    return {
      status: "preparing",
      progress: next.progress,
      state: next.state,
    };
  }

  // Estado desconocido: si ya había progreso, se trata como "preparando"; si
  // no, es una respuesta que no podemos interpretar.
  return next.progress !== null || status === ""
    ? { status: "preparing", progress: next.progress, state: next.state }
    : { status: "unavailable" };
}
