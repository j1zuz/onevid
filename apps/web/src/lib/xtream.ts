// biome-ignore-all lint/suspicious/noControlCharactersInRegex: credential validation deliberately rejects control characters.
import { Buffer } from "node:buffer";
import {
  LiveTvError,
  LIVE_TV_MAX_CHANNELS,
  normalizeLiveTvUrl,
  type LiveTvChannel,
  type LiveTvProgramme,
  type LiveTvGuideWindow,
} from "./live-tv";
import {
  cleanGuideText,
  parseXmltvTimestamp,
  programmeId,
  selectProgrammes,
} from "./xmltv";

export const XTREAM_MAX_JSON_BYTES = 8 * 1024 * 1024;
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function credential(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    value === "." ||
    value === ".."
  ) {
    throw new LiveTvError("Las credenciales de Live TV no son válidas.");
  }
  try {
    encodeURIComponent(value);
  } catch {
    throw new LiveTvError("Las credenciales de Live TV no son válidas.");
  }
  return value;
}

export function buildXtreamEndpoint(
  serverUrl: string,
  username: unknown,
  password: unknown,
): string {
  const url = new URL(normalizeLiveTvUrl(serverUrl));
  if (url.search)
    throw new LiveTvError(
      "La URL del servidor de Live TV no debe incluir parámetros.",
    );
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname.endsWith("/player_api.php"))
    url.pathname += "/player_api.php";
  url.searchParams.set("username", credential(username));
  url.searchParams.set("password", credential(password));
  return normalizeLiveTvUrl(url.href);
}

function endpointParts(endpoint: string): {
  url: URL;
  username: string;
  password: string;
} {
  const url = new URL(normalizeLiveTvUrl(endpoint));
  if (!url.pathname.endsWith("/player_api.php"))
    throw new LiveTvError("La fuente de Live TV no es válida.");
  return {
    url,
    username: credential(url.searchParams.get("username")),
    password: credential(url.searchParams.get("password")),
  };
}

export function xtreamActionUrl(
  endpoint: string,
  action: "get_live_streams" | "get_live_categories" | "get_short_epg",
  streamId?: string,
): string {
  const { url } = endpointParts(endpoint);
  url.searchParams.set("action", action);
  if (action === "get_short_epg") {
    if (!validStreamId(streamId))
      throw new LiveTvError("El canal de Live TV no es válido.");
    url.searchParams.set("stream_id", streamId);
    url.searchParams.set("limit", "20");
  }
  return url.href;
}

export function validateXtreamAuth(payload: unknown, now = Date.now()): void {
  const info = record(record(payload)?.user_info);
  if (
    !info ||
    ![1, "1", true].includes(info.auth as number | string | boolean) ||
    typeof info.status !== "string" ||
    info.status.trim().toLowerCase() !== "active"
  ) {
    throw new LiveTvError(
      "La cuenta de Live TV no está activa o las credenciales no son válidas.",
    );
  }
  if (
    info.exp_date !== null &&
    info.exp_date !== undefined &&
    info.exp_date !== ""
  ) {
    const expiration =
      typeof info.exp_date === "number" || typeof info.exp_date === "string"
        ? Number(info.exp_date)
        : NaN;
    if (!Number.isFinite(expiration) || expiration <= now / 1000)
      throw new LiveTvError(
        "La cuenta de Live TV ha caducado o su fecha de caducidad no es válida.",
      );
  }
}

function validStreamId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:0|[1-9]\d{0,15})$/.test(value) &&
    Number.isSafeInteger(Number(value))
  );
}

export function parseXtreamChannels(
  endpoint: string,
  streams: unknown,
  categories: unknown,
): LiveTvChannel[] {
  if (!Array.isArray(streams) || !Array.isArray(categories))
    throw new LiveTvError("El catálogo de Live TV no es válido.");
  const { url, username, password } = endpointParts(endpoint);
  const base = new URL(".", url);
  const groups = new Map<string, string>();
  for (const raw of categories.slice(0, 5000)) {
    const category = record(raw);
    if (
      !category ||
      !["string", "number"].includes(typeof category.category_id)
    )
      continue;
    if (typeof category.category_name === "string")
      groups.set(
        String(category.category_id).slice(0, 128),
        cleanGuideText(category.category_name, 256),
      );
  }
  const channels: LiveTvChannel[] = [];
  const seen = new Set<string>();
  for (const raw of streams.slice(0, 50_000)) {
    if (channels.length >= LIVE_TV_MAX_CHANNELS) break;
    const stream = record(raw);
    if (!stream || !["string", "number"].includes(typeof stream.stream_id))
      continue;
    const id = String(stream.stream_id);
    if (!validStreamId(id) || seen.has(id)) continue;
    seen.add(id);
    const pathSegment = (value: string) =>
      encodeURIComponent(value).replace(
        /[!'()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      );
    const playbackUrl = normalizeLiveTvUrl(
      `live/${pathSegment(username)}/${pathSegment(password)}/${id}.m3u8`,
      base.href,
    );
    let logo: string | undefined;
    if (typeof stream.stream_icon === "string" && stream.stream_icon) {
      try {
        logo = normalizeLiveTvUrl(stream.stream_icon, base.href);
      } catch {
        /* Invalid/insecure artwork is omitted. */
      }
    }
    const tvgId =
      typeof stream.epg_channel_id === "string"
        ? cleanGuideText(stream.epg_channel_id, 256)
        : "";
    channels.push({
      id: `xtream-${id}`,
      name:
        typeof stream.name === "string"
          ? cleanGuideText(stream.name, 256) || "Live TV"
          : "Live TV",
      url: playbackUrl,
      ...(logo ? { logo } : {}),
      group: groups.get(String(stream.category_id)) || "Sin grupo",
      ...(tvgId ? { tvgId } : {}),
    });
  }
  if (!channels.length)
    throw new LiveTvError(
      "La fuente de Live TV no contiene canales compatibles.",
    );
  return channels;
}

export function decodeXtreamText(value: unknown, max = 4096): string {
  if (typeof value !== "string" || value.length > 32_768) return "";
  const encoded = value.trim();
  if (
    !encoded ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) ||
    encoded.length % 4 === 1
  )
    return "";
  try {
    const bytes = Buffer.from(encoded, "base64");
    if (
      bytes.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")
    )
      return "";
    return cleanGuideText(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      max,
    );
  } catch {
    return "";
  }
}

function epgTime(timestamp: unknown, text: unknown): number | undefined {
  if (
    (typeof timestamp === "number" ||
      (typeof timestamp === "string" && /^\d+(?:\.\d+)?$/.test(timestamp))) &&
    Number(timestamp) > 0
  ) {
    const ms = Number(timestamp) * 1000;
    if (Number.isFinite(ms) && Number.isFinite(new Date(ms).getTime()))
      return ms;
  }
  if (typeof text !== "string") return undefined;
  const xmltv = parseXmltvTimestamp(text);
  if (xmltv !== undefined) return xmltv;
  // Never guess a provider's local timezone; accept only explicitly offset ISO timestamps.
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      text,
    );
  if (!match) return undefined;
  const date = parseXmltvTimestamp(
    `${match.slice(1, 7).join("")} ${match[8].replace(":", "")}`,
  );
  return date === undefined
    ? undefined
    : date + Math.round(Number(`0${match[7] ?? ""}`) * 1000);
}

export function parseXtreamEpg(
  payload: unknown,
  streamId: string,
  now = Date.now(),
  window?: LiveTvGuideWindow,
): LiveTvProgramme[] {
  if (!validStreamId(streamId))
    throw new LiveTvError("El canal de Live TV no es válido.");
  const listings = record(payload)?.epg_listings;
  if (!Array.isArray(listings))
    throw new LiveTvError("La guía de Live TV no es válida.");
  const programmes: LiveTvProgramme[] = [];
  for (const raw of listings.slice(0, 1000)) {
    const entry = record(raw);
    if (!entry) continue;
    const start = epgTime(entry.start_timestamp, entry.start);
    const end = epgTime(entry.stop_timestamp ?? entry.end_timestamp, entry.end);
    if (
      start === undefined ||
      end === undefined ||
      end <= start ||
      (window ? end <= window.start || start >= window.end : end <= now)
    )
      continue;
    const description = decodeXtreamText(entry.description);
    programmes.push({
      id: programmeId(`xtream-${streamId}`, start),
      title: decodeXtreamText(entry.title, 512) || "Live TV",
      ...(description ? { description } : {}),
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
    });
  }
  return selectProgrammes(programmes, now, window);
}
