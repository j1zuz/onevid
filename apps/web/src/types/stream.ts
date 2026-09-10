export type StreamType = "movie" | "series";

/**
 * Escalón de resolución deducido del texto del addon. Ver `parseQualityTier`
 * en `lib/stream-quality.ts`: los addons no publican la calidad en un campo
 * propio, así que se normaliza a estos valores para ordenar y filtrar.
 */
export type QualityTier =
  | "2160"
  | "1440"
  | "1080"
  | "720"
  | "480"
  | "unknown";

export interface StreamSource {
  behaviors?: string[];
  description?: string;
  extra?: Record<string, unknown>;
  name?: string;
  /** Calidad deducida del texto del addon; la resuelve el servidor. */
  quality?: QualityTier;
  title: string;
  url: string;
  [key: string]: unknown;
}

export interface AddonStreamResponse {
  streams?: StreamSource[];
}

export interface StreamWithAddon extends StreamSource {
  addonId: string;
  addonName: string;
  sourceIndex: number;
}

export interface AggregatedStreamResponse {
  addonErrors: Array<{
    addonId: string;
    addonName: string;
    error: string;
  }>;
  sources: StreamWithAddon[];
  totalAddonsTried: number;
}

export interface SourceCompatibility {
  audioCodec: "compatible" | "incompatible" | "unknown";
  audioIssues: string[];
  videoCodec: "compatible" | "incompatible" | "unknown";
  videoIssues: string[];
}

export type MimeType =
  | "application/x-mpegURL"
  | "application/dash+xml"
  | "video/webm"
  | "video/mp4";
