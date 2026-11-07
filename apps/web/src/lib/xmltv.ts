// biome-ignore-all lint/suspicious/noControlCharactersInRegex: XMLTV sanitization deliberately matches control characters.
import { createHash } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import {
  LiveTvError,
  LIVE_TV_MAX_PROGRAMMES,
  LIVE_TV_MAX_XMLTV_BYTES,
  LIVE_TV_MAX_GUIDE_CHANNELS,
  type LiveTvGuideWindow,
  type LiveTvProgramme,
} from "./live-tv";

export function cleanGuideText(value: string, max = 4096): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
    .trim()
    .slice(0, max);
}

/** XMLTV uses UTC when the optional numeric zone is absent. Never use local server time. */
export function parseXmltvTimestamp(value: string): number | undefined {
  const match =
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*(Z|[+-]\d{4}))?$/.exec(
      value.trim(),
    );
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map(Number);
  if (
    year < 1970 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return undefined;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(utc);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return undefined;
  let offset = 0;
  const zone = match[7];
  if (zone && zone !== "Z") {
    const hours = Number(zone.slice(1, 3));
    const minutes = Number(zone.slice(3, 5));
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0))
      return undefined;
    offset = (hours * 60 + minutes) * 60_000 * (zone[0] === "+" ? 1 : -1);
  }
  return utc - offset;
}

export function programmeId(channel: string, start: number): string {
  return `guide-${createHash("sha256").update(`${channel}\0${start}`).digest("hex").slice(0, 24)}`;
}

export function selectProgrammes(
  programmes: LiveTvProgramme[],
  now = Date.now(),
  window?: LiveTvGuideWindow,
): LiveTvProgramme[] {
  const seen = new Set<string>();
  return programmes
    .filter((programme) => {
      const start = Date.parse(programme.start);
      const end = Date.parse(programme.end);
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= start ||
        (window ? end <= window.start || start >= window.end : end <= now) ||
        seen.has(programme.id)
      )
        return false;
      seen.add(programme.id);
      return true;
    })
    .sort(
      (a, b) =>
        Date.parse(a.start) - Date.parse(b.start) ||
        Date.parse(a.end) - Date.parse(b.end),
    )
    .slice(0, LIVE_TV_MAX_PROGRAMMES);
}

/** DOM parsing, never regex extraction. DTD/entity declarations are forbidden before parsing. */
export function parseXmltv(
  text: string,
  channelId: string,
  now = Date.now(),
): LiveTvProgramme[] {
  return parseXmltvChannels(text, [channelId], now).get(channelId) ?? [];
}

/** Parse a single bounded DOM and route entries to all requested channel IDs in one pass. */
export function parseXmltvChannels(
  text: string,
  channelIds: string[],
  now = Date.now(),
  window?: LiveTvGuideWindow,
): Map<string, LiveTvProgramme[]> {
  if (channelIds.length > LIVE_TV_MAX_GUIDE_CHANNELS)
    throw new LiveTvError("La guía de Live TV admite como máximo 12 canales.");
  const all = parseXmltvDocument(text);
  const channels = new Map<string, LiveTvProgramme[]>(
    channelIds.map((id) => [id, []]),
  );
  for (const [id] of channels) {
    channels.set(
      id,
      selectProgrammes(all.get(id) ?? [], now, window),
    );
  }
  return channels;
}

/**
 * Parse the full XMLTV document into programmes per channel. The guide caches
 * this result so changing page/window does not download and parse the whole
 * 8 MiB file again.
 */
export function parseXmltvAll(
  text: string,
): Map<string, LiveTvProgramme[]> {
  return parseXmltvDocument(text);
}

// Bound the total programme entries even before per-channel filtering: an
// 8 MiB XMLTV can otherwise allocate an arbitrarily large map.
const MAX_XMLTV_PROGRAMMES = 250_000;

function parseXmltvDocument(
  text: string,
): Map<string, LiveTvProgramme[]> {
  const invalid = () =>
    new LiveTvError("La guía XMLTV de Live TV no es válida.");
  if (new TextEncoder().encode(text).byteLength > LIVE_TV_MAX_XMLTV_BYTES)
    throw new LiveTvError("La guía de Live TV supera el límite de 8 MiB.");
  if (
    /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)
  )
    throw invalid();
  // Bound DOM allocation before parsing; '<' inside comments/CDATA counts conservatively.
  let tokens = 0;
  for (let at = text.indexOf("<"); at !== -1; at = text.indexOf("<", at + 1)) {
    if (++tokens > 200_000) throw invalid();
  }
  try {
    const document = new DOMParser({
      locator: false,
      onError: () => {
        throw invalid();
      },
    }).parseFromString(text, "application/xml");
    const root = document.documentElement;
    if (root?.tagName !== "tv" || document.doctype) throw invalid();
    // Bound depth before reading textContent, which can recurse into nested provider markup.
    const stack = [{ node: root as import("@xmldom/xmldom").Node, depth: 0 }];
    let nodes = 0;
    while (stack.length) {
      const current = stack.pop();
      if (!current) break;
      const { node, depth } = current;
      if (
        ++nodes > 300_000 ||
        depth > 32 ||
        (node.nodeValue &&
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(node.nodeValue))
      )
        throw invalid();
      for (let child = node.firstChild; child; child = child.nextSibling)
        stack.push({ node: child, depth: depth + 1 });
    }
    const channels = new Map<string, LiveTvProgramme[]>();
    let total = 0;
    for (let node = root.firstChild; node; node = node.nextSibling) {
      if (node.nodeType !== 1) continue;
      const entry = node as import("@xmldom/xmldom").Element;
      if (entry.tagName !== "programme") continue;
      const channelId = entry.getAttribute("channel") ?? "";
      if (!channelId) continue;
      const start = parseXmltvTimestamp(entry.getAttribute("start") ?? "");
      const end = parseXmltvTimestamp(entry.getAttribute("stop") ?? "");
      if (start === undefined || end === undefined || end <= start) continue;
      if (++total > MAX_XMLTV_PROGRAMMES) throw invalid();
      let title = "";
      let description = "";
      for (let child = entry.firstChild; child; child = child.nextSibling) {
        if (child.nodeType !== 1) continue;
        if (child.nodeName === "title" && !title)
          title = cleanGuideText(child.textContent ?? "", 512);
        if (child.nodeName === "desc" && !description)
          description = cleanGuideText(child.textContent ?? "");
      }
      const programme = {
        id: programmeId(channelId, start),
        title: title || "Live TV",
        ...(description ? { description } : {}),
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      };
      const programmes = channels.get(channelId);
      if (programmes) programmes.push(programme);
      else channels.set(channelId, [programme]);
    }
    return channels;
  } catch {
    // Parser exceptions can quote untrusted XML, including secret URLs. Never log them.
    throw invalid();
  }
}
