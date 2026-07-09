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

import { safeFetch } from "@/utils/ssrf-guard";

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
