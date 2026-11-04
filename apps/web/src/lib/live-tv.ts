// biome-ignore-all lint/suspicious/noControlCharactersInRegex: URL validation deliberately rejects control characters.
export interface LiveTvSourceSummary {
  id: string;
  name: string;
  channelCount: number;
  type: "m3u" | "xtream";
  hasEpg: boolean;
}

export interface LiveTvChannel {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group: string;
  tvgId?: string;
}

export interface LiveTvProgramme {
  id: string;
  title: string;
  description?: string;
  start: string;
  end: string;
}

export interface LiveTvGuideRequest {
  sourceId: string;
  channelIds: string[];
  start: string;
  end: string;
}

export interface LiveTvGuideWindow {
  start: number;
  end: number;
}

export interface LiveTvGuideRow {
  channelId: string;
  programmes: LiveTvProgramme[];
  error?: boolean;
}

export interface LiveTvGuideResponse {
  channels: LiveTvGuideRow[];
}

export const LIVE_TV_MAX_GUIDE_CHANNELS = 12;
export const LIVE_TV_MAX_GUIDE_WINDOW_MS = 6 * 60 * 60 * 1000;
export const LIVE_TV_MAX_PROGRAMMES = 20;
export const LIVE_TV_MAX_XMLTV_BYTES = 8 * 1024 * 1024;
export const LIVE_TV_MAX_CHANNELS = 5_000;
export const LIVE_TV_MAX_PLAYLIST_BYTES = 1024 * 1024;
export const LIVE_TV_MAX_SOURCES = 10;

export class LiveTvError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "LiveTvError";
  }
}

function guideInstant(value: unknown): number {
  if (typeof value !== "string")
    throw new LiveTvError(
      "La ventana de la guía de Live TV debe usar fechas ISO con zona horaria.",
    );
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  const time = Date.parse(value);
  if (!match || !Number.isFinite(time))
    throw new LiveTvError(
      "La ventana de la guía de Live TV debe usar fechas ISO válidas con zona horaria.",
    );
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  const zone = match[7];
  const zoneHours = zone === "Z" ? 0 : Number(zone.slice(1, 3));
  const zoneMinutes = zone === "Z" ? 0 : Number(zone.slice(4, 6));
  if (
    year < 1970 ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    zoneHours > 14 ||
    zoneMinutes > 59 ||
    (zoneHours === 14 && zoneMinutes !== 0)
  )
    throw new LiveTvError("Las fechas de la guía de Live TV no son válidas.");
  return time;
}

export function parseLiveTvGuideRequest(input: unknown): LiveTvGuideRequest {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new LiveTvError(
      "Se esperaba un objeto JSON para la guía de Live TV.",
    );
  const payload = input as Record<string, unknown>;
  if (
    typeof payload.sourceId !== "string" ||
    !payload.sourceId.trim() ||
    payload.sourceId.length > 200
  )
    throw new LiveTvError(
      "Se requiere el identificador de la fuente de Live TV.",
    );
  if (
    !Array.isArray(payload.channelIds) ||
    payload.channelIds.length < 1 ||
    payload.channelIds.length > LIVE_TV_MAX_GUIDE_CHANNELS ||
    payload.channelIds.some(
      (id) => typeof id !== "string" || !id.trim() || id.length > 200,
    )
  )
    throw new LiveTvError(
      "La guía de Live TV admite entre 1 y 12 identificadores de canal válidos.",
    );
  const channelIds = (payload.channelIds as string[]).map((id) => id.trim());
  if (new Set(channelIds).size !== channelIds.length)
    throw new LiveTvError(
      "Los canales de la guía de Live TV no deben repetirse.",
    );
  const start = guideInstant(payload.start);
  const end = guideInstant(payload.end);
  if (end <= start || end - start > LIVE_TV_MAX_GUIDE_WINDOW_MS)
    throw new LiveTvError(
      "La ventana de la guía de Live TV debe ser positiva y no superar 6 horas.",
    );
  return {
    sourceId: payload.sourceId.trim(),
    channelIds,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
  };
}

/** Canonical HTTPS-only URL, without userinfo, fragments or player header syntax. */
export function normalizeLiveTvUrl(input: string, base?: string): string {
  if (
    !input.trim() ||
    input.length > 8192 ||
    /[\u0000-\u0020\u007f|]/.test(input.trim())
  ) {
    throw new LiveTvError("URL HTTPS inválida.");
  }
  try {
    const url = new URL(input.trim(), base);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error();
    }
    url.hash = "";
    return url.href;
  } catch {
    throw new LiveTvError(
      "URL HTTPS inválida; no se admiten credenciales en la URL.",
    );
  }
}

// Non-security identifier: stable across refreshes and independent of ordering.
function channelId(url: string): string {
  let hash = BigInt("0xcbf29ce484222325");
  for (const byte of new TextEncoder().encode(url)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * BigInt("0x100000001b3"));
  }
  return `live-tv-${hash.toString(16).padStart(16, "0")}`;
}

function splitInfo(info: string): [string, string] | undefined {
  let quote = "";
  for (let i = 0; i < info.length; i++) {
    const char = info[i];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ",") {
      return [info.slice(0, i), info.slice(i + 1).trim()];
    }
  }
}

/** Parse an extended M3U channel list, never an HLS master/media manifest. */
export function parseLiveTvPlaylist(
  text: string,
  playlistUrl: string,
): LiveTvChannel[] {
  if (new TextEncoder().encode(text).byteLength > LIVE_TV_MAX_PLAYLIST_BYTES) {
    throw new LiveTvError(
      "La lista de reproducción supera el límite de 1 MiB.",
    );
  }
  const base = normalizeLiveTvUrl(playlistUrl);
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim());
  if (!/^#EXTM3U(?:\s|$)/i.test(lines.find(Boolean) ?? "")) {
    throw new LiveTvError(
      "Se esperaba una lista de canales en formato M3U extendido.",
    );
  }
  if (lines.some((line) => /^#EXT-X-/i.test(line))) {
    throw new LiveTvError(
      "Los manifiestos HLS son URLs de reproducción, no listas de canales.",
    );
  }
  if (
    lines.some((line) =>
      /^#(?:EXTVLCOPT|EXTHTTP|KODIPROP|EXTDRM|DRM)(?::|\s|$)/i.test(line),
    )
  ) {
    throw new LiveTvError(
      "No se admiten DRM ni cabeceras de reproducción personalizadas.",
    );
  }

  const channels: LiveTvChannel[] = [];
  const seen = new Set<string>();
  let pending:
    | { name: string; attributes: Record<string, string>; group: string }
    | undefined;
  for (const line of lines) {
    if (/^#EXTINF:/i.test(line)) {
      pending = undefined;
      const parts = splitInfo(line.slice(8));
      if (!parts || !/^-?\d+(?:\.\d+)?(?:\s|$)/.test(parts[0])) continue;
      const attributes: Record<string, string> = {};
      for (const match of parts[0].matchAll(
        /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g,
      )) {
        attributes[match[1].toLowerCase()] = (
          match[2] ??
          match[3] ??
          match[4]
        ).trim();
      }
      pending = {
        name: parts[1] || attributes["tvg-name"] || "Live TV",
        attributes,
        group: "",
      };
    } else if (/^#EXTGRP:/i.test(line) && pending) {
      pending.group = line.slice(8).trim();
    } else if (line && !line.startsWith("#") && pending) {
      const entry = pending;
      pending = undefined;
      let url: string;
      try {
        url = normalizeLiveTvUrl(line, base);
      } catch {
        continue;
      }
      if (seen.has(url) || channels.length >= LIVE_TV_MAX_CHANNELS) continue;
      seen.add(url);
      let logo: string | undefined;
      if (entry.attributes["tvg-logo"]) {
        try {
          logo = normalizeLiveTvUrl(entry.attributes["tvg-logo"], base);
        } catch {
          /* Omit invalid artwork. */
        }
      }
      channels.push({
        id: channelId(url),
        name: entry.name,
        url,
        ...(logo ? { logo } : {}),
        group: entry.attributes["group-title"] || entry.group || "Sin grupo",
        ...(entry.attributes["tvg-id"]
          ? { tvgId: entry.attributes["tvg-id"] }
          : {}),
      });
    }
  }
  if (!channels.length)
    throw new LiveTvError(
      "La lista de reproducción no contiene canales HTTPS compatibles.",
    );
  return channels;
}
