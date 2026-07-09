import type {
  MimeType,
  SourceCompatibility,
  StreamSource,
} from "@/types/stream";

/**
 * Patterns for unsupported video codecs
 */
const UNSUPPORTED_VIDEO_PATTERNS = [/h\.?265/i, /hevc/i, /x265/i];

/**
 * Patterns for unsupported audio codecs/formats
 */
const UNSUPPORTED_AUDIO_PATTERNS = [
  /dts/i,
  /truehd/i,
  /atmos/i,
  /ac-?3/i,
  /ac3/i,
  /e-?ac-?3/i,
  /eac3/i,
  /ddp/i,
  /dd\+/i,
];

/**
 * Patterns for supported video codecs
 */
const SUPPORTED_VIDEO_PATTERNS = [
  /h\.?264/i,
  /avc/i,
  /vp9/i,
  /av1/i,
  /hls/i,
  /dash/i,
];

/**
 * Patterns for supported audio codecs
 */
const SUPPORTED_AUDIO_PATTERNS = [/aac/i, /mp3/i, /opus/i];

/**
 * Detect video codec compatibility from title
 */
export function detectVideoCodec(
  title: string
): SourceCompatibility["videoCodec"] {
  const titleLower = title.toLowerCase();

  // Check unsupported first
  for (const pattern of UNSUPPORTED_VIDEO_PATTERNS) {
    if (pattern.test(titleLower)) {
      return "incompatible";
    }
  }

  // Check supported
  for (const pattern of SUPPORTED_VIDEO_PATTERNS) {
    if (pattern.test(titleLower)) {
      return "compatible";
    }
  }

  return "unknown";
}

/**
 * Detect audio codec compatibility from title
 */
export function detectAudioCodec(
  title: string
): SourceCompatibility["audioCodec"] {
  const titleLower = title.toLowerCase();

  // Check unsupported first
  for (const pattern of UNSUPPORTED_AUDIO_PATTERNS) {
    if (pattern.test(titleLower)) {
      return "incompatible";
    }
  }

  // Check supported
  for (const pattern of SUPPORTED_AUDIO_PATTERNS) {
    if (pattern.test(titleLower)) {
      return "compatible";
    }
  }

  return "unknown";
}

/**
 * Extract unsupported video issues from title
 */
const H265_REGEX = /h\.?265|hevc|x265/i;
const DTS_REGEX = /dts/i;
const TRUEHD_REGEX = /truehd/i;
const ATMOS_REGEX = /atmos/i;
const AC3_REGEX = /ac-?3|ac3/i;
const DDP_REGEX = /e-?ac-?3|eac3|ddp|dd\+/i;

function extractVideoIssues(title: string): string[] {
  const issues: string[] = [];
  const titleLower = title.toLowerCase();

  if (H265_REGEX.test(titleLower)) {
    issues.push("h265");
  }

  return issues;
}

/**
 * Extract unsupported audio issues from title
 */
function extractAudioIssues(title: string): string[] {
  const issues: string[] = [];
  const titleLower = title.toLowerCase();

  if (DTS_REGEX.test(titleLower)) {
    issues.push("dts");
  }
  if (TRUEHD_REGEX.test(titleLower)) {
    issues.push("truehd");
  }
  if (ATMOS_REGEX.test(titleLower)) {
    issues.push("atmos");
  }
  if (AC3_REGEX.test(titleLower)) {
    issues.push("ac3");
  }
  if (DDP_REGEX.test(titleLower)) {
    issues.push("ddp");
  }

  return issues;
}

/**
 * Get full compatibility info for a stream source
 */
export function getSourceCompatibility(
  source: StreamSource
): SourceCompatibility {
  const title = typeof source.title === "string" ? source.title : "";

  return {
    videoCodec: detectVideoCodec(title),
    audioCodec: detectAudioCodec(title),
    videoIssues: extractVideoIssues(title),
    audioIssues: extractAudioIssues(title),
  };
}

/**
 * Check if source is compatible (no unsupported codecs)
 */
export function isSourceCompatible(source: StreamSource): boolean {
  const compat = getSourceCompatibility(source);
  return (
    compat.videoCodec !== "incompatible" && compat.audioCodec !== "incompatible"
  );
}

// Extensions natively playable in all modern browsers — no processing needed.
const NATIVE_EXTENSIONS = /\.(mp4|m3u8|mpd|mp3|wav|flac)$/;

const UNSUPPORTED_CONTAINERS = /\.(mkv|mov|ts|avi|flv|wmv|ogv)$/;
const UNSUPPORTED_AUDIO_CODECS = /ac-?3|eac-?3|ddp|dd\+|dts|truehd/;
const WEBM_EXTENSION = /\.webm$/;

/**
 * Detects if a file/URL needs MediaBunny transcoding to be playable in the browser.
 * Triggered by:
 *  - Unsupported containers (MKV, MOV, TS, AVI…)
 *  - Unsupported audio codecs in the filename (AC-3, DDP, DTS, TrueHD)
 *  - No recognizable extension (e.g. TorBox UUID paths) — format unknown, probe needed
 */
export function needsMediaBunny(filename: string): boolean {
  const lower = filename.toLowerCase();
  // Unsupported containers
  if (UNSUPPORTED_CONTAINERS.test(lower)) {
    return true;
  }
  // Unsupported audio codecs in the filename/title
  if (UNSUPPORTED_AUDIO_CODECS.test(lower)) {
    return true;
  }
  // No recognized native extension (e.g. UUID paths from TorBox) → probe with MediaBunny
  if (!(NATIVE_EXTENSIONS.test(lower) || WEBM_EXTENSION.test(lower))) {
    return true;
  }
  return false;
}

/**
 * Determine MIME type from URL
 */
export function getMimeType(url: string): MimeType {
  const urlLower = url.toLowerCase();

  if (urlLower.includes(".m3u8")) {
    return "application/x-mpegURL";
  }

  if (urlLower.includes(".mpd")) {
    return "application/dash+xml";
  }

  if (urlLower.includes(".webm")) {
    return "video/webm";
  }

  return "video/mp4";
}

/**
 * Format codec issues for display
 */
export function formatCodecIssue(issue: string): string {
  const issueMap: Record<string, string> = {
    h265: "H.265/HEVC",
    dts: "DTS",
    truehd: "TrueHD",
    atmos: "Atmos",
    ac3: "AC3",
    ddp: "DDP/Atmos",
  };

  return issueMap[issue] || issue.toUpperCase();
}

/**
 * Get badge text for incompatibilities
 */
export function getBadgeText(compat: SourceCompatibility): string | null {
  const allIssues = [...compat.videoIssues, ...compat.audioIssues];

  if (allIssues.length === 0) {
    return null;
  }

  if (allIssues.some((issue) => compat.videoIssues.includes(issue))) {
    return "Video no soportado";
  }

  if (allIssues.some((issue) => compat.audioIssues.includes(issue))) {
    return "Audio no soportado";
  }

  return null;
}
