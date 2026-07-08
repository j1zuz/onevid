export type StreamType = "movie" | "series";

export interface StreamSource {
  behaviors?: string[];
  description?: string;
  extra?: Record<string, unknown>;
  name?: string;
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
