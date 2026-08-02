"use client";

import { useEffect, useRef, useState } from "react";
import { needsMediaBunny } from "@/utils/stream-codec";

export type MediaBunnyState =
  | { status: "idle" }
  | { status: "processing"; progress: number }
  | { status: "done"; src: string }
  | { status: "error"; message: string };

/**
 * Bridges MediaBunny's `StreamTarget` chunks to an OPFS writable. The MP4 muxer
 * emits chunks at arbitrary positions, so each write seeks first.
 */
function createOpfsWriteStream(opfsWritable: FileSystemWritableFileStream) {
  return new WritableStream({
    async write(chunk: { data: Uint8Array; position: number }) {
      await opfsWritable.seek(chunk.position);
      await opfsWritable.write(
        chunk.data.slice() as unknown as FileSystemWriteChunkType
      );
    },
    close() {
      return opfsWritable.close();
    },
    abort() {
      return opfsWritable.abort();
    },
  });
}

/** Minimal shape used to cancel an in-flight conversion from the caller. */
interface CancellableConversion {
  cancel: () => Promise<void>;
}

// Codecs the browser's <video> element can already decode natively once
// remuxed into an MP4 container — matches this project's own compatibility
// list in stream-codec.ts (SUPPORTED_VIDEO_PATTERNS/SUPPORTED_AUDIO_PATTERNS),
// but checked against the file's *real* codec (via mediabunny's track probing)
// instead of guessed from the filename.
const PASSTHROUGH_VIDEO_CODECS = new Set(["avc", "vp9", "av1"]);
const PASSTHROUGH_AUDIO_CODECS = new Set(["aac", "mp3", "opus"]);

/**
 * Runs the full MediaBunny pipeline for one source and returns the finished
 * MP4 as a File. Video is passed through (H.264/AVC) and only audio is
 * re-encoded (→ Opus); the output is streamed into the given OPFS file.
 *
 * Known gap: mediabunny's Matroska demuxer (as of 1.49.0) never surfaces
 * subtitle tracks as `InputTrack`s — they're silently dropped during
 * demuxing, before `Conversion` ever sees them — so a transcoded MKV loses
 * every embedded subtitle. Multiple audio tracks *do* survive the transcode,
 * but Chromium has no reliable `audioTracks` switching support for local
 * blob MP4 playback, so the audio picker (`useMediaTracks`) may still come up
 * empty. Both pickers work as intended against HLS sources, which never go
 * through this pipeline.
 *

 * `conversionRef` is populated with the live `Conversion` instance as soon as
 * it exists, so the caller can `cancel()` it (releasing its WebCodecs
 * decoder/encoder sessions) if the component unmounts mid-transcode. Without
 * this, an abandoned `execute()` keeps decoding in the background against an
 * OPFS file the caller has already deleted, which pins GPU decoder sessions
 * and can leave the page's compositor stuck painting black.
 */
async function transcodeToMp4(
  source: File | string,
  opfsName: string,
  onProgress: (progress: number) => void,
  conversionRef: { current: CancellableConversion | null },
  abortedRef: { current: boolean }
): Promise<File> {
  const [
    {
      Input,
      Output,
      Conversion,
      BlobSource,
      UrlSource,
      ALL_FORMATS,
      Mp4OutputFormat,
      StreamTarget,
    },
    { registerAc3Decoder },
  ] = await Promise.all([import("mediabunny"), import("@mediabunny/ac3")]);

  registerAc3Decoder();

  // Random-access source: `BlobSource` for a local `File` (already fully
  // available) and `UrlSource` for a remote URL (fetches byte ranges via HTTP
  // Range, so it can seek backward without buffering everything). This is what
  // avoids the "Read is before the cached region" error.
  const inputSource =
    typeof source === "string" ? new UrlSource(source) : new BlobSource(source);

  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(opfsName, { create: true });
  const opfsWritable = await fileHandle.createWritable();

  const conversion = await Conversion.init({
    input: new Input({ source: inputSource, formats: ALL_FORMATS }),
    output: new Output({
      format: new Mp4OutputFormat(),
      target: new StreamTarget(createOpfsWriteStream(opfsWritable)),
    }),
    // Returning `{}` leaves mediabunny's own codec/channel/rate untouched, so
    // it takes its fast passthrough path (raw packet copy, no decode+encode)
    // whenever the source track is already browser-playable. Only a track
    // whose real codec isn't in our compatibility set pays for a transcode —
    // e.g. an MKV with H.264 video + AC-3 audio only re-encodes the audio.
    video: async (track) => {
      const codec = await track.getCodec();
      return codec && PASSTHROUGH_VIDEO_CODECS.has(codec) ? {} : { codec: "avc" };
    },
    audio: async (track) => {
      const codec = await track.getCodec();
      return codec && PASSTHROUGH_AUDIO_CODECS.has(codec)
        ? {}
        : { codec: "opus", numberOfChannels: 2, sampleRate: 48_000 };
    },
  });

  if (!conversion.isValid) {
    const reason = conversion.discardedTracks[0]?.reason ?? "unknown";
    throw new Error(`No se pudo procesar el audio (${reason}).`);
  }

  conversionRef.current = conversion;
  // The component may have unmounted while we were awaiting the dynamic
  // imports/OPFS setup above, before there was a `conversion` to cancel.
  // Catch that race here instead of letting an orphaned execute() run.
  if (abortedRef.current) {
    await conversion.cancel();
  }
  conversion.onProgress = onProgress;
  await conversion.execute();
  return await fileHandle.getFile();
}

/**
 * Transcodes unsupported media (MKV, EAC-3, AC-3…) for browser playback.
 *
 * Reads the input with a random-access MediaBunny source — `BlobSource` for a
 * local `File`, `UrlSource` (HTTP Range) for a remote URL — so backward seeks
 * (MP4 `moov` at the end of the file, MKV cues…) work without the "Read is
 * before the cached region" error that `ReadableStreamSource` throws on
 * forward-only streams. Writes the output to OPFS (handles non-monotonic MP4
 * seeks via seek()), then creates a blob URL from the finished file. Only audio
 * is re-encoded (EAC-3 → Opus); H.264 video is passed through without
 * re-encoding.
 */
export function useMediaBunny(
  source: File | string | null,
  filename: string
): MediaBunnyState {
  const [state, setState] = useState<MediaBunnyState>({ status: "idle" });
  const blobUrlRef = useRef<string | null>(null);
  const opfsNameRef = useRef<string | null>(null);
  const conversionRef = useRef<CancellableConversion | null>(null);

  useEffect(() => {
    if (!(source && needsMediaBunny(filename))) {
      setState({ status: "idle" });
      return;
    }

    const abortedRef = { current: false };
    setState({ status: "processing", progress: 0 });

    const cleanup = async () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      if (opfsNameRef.current) {
        try {
          const root = await navigator.storage.getDirectory();
          await root.removeEntry(opfsNameRef.current);
        } catch {
          /* already removed */
        }
        opfsNameRef.current = null;
      }
    };

    const opfsName = `mb-${Date.now()}.mp4`;
    opfsNameRef.current = opfsName;

    (async () => {
      try {
        const file = await transcodeToMp4(
          source,
          opfsName,
          (progress) => {
            if (!abortedRef.current) {
              setState({ status: "processing", progress });
            }
          },
          conversionRef,
          abortedRef
        );
        if (abortedRef.current) {
          return;
        }
        const blobUrl = URL.createObjectURL(file);
        blobUrlRef.current = blobUrl;
        setState({ status: "done", src: blobUrl });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await cleanup();
        if (!abortedRef.current) {
          setState({ status: "error", message: msg });
        }
      }
    })();

    return () => {
      abortedRef.current = true;
      // Cancel the in-flight conversion first (if it already exists) so its
      // WebCodecs decoder/encoder sessions are released before we pull the
      // OPFS file out from under it. If `conversion` hasn't been created yet,
      // the abortedRef check inside transcodeToMp4 cancels it as soon as it is.
      if (conversionRef.current) {
        conversionRef.current.cancel().finally(cleanup);
      } else {
        cleanup();
      }
    };
  }, [source, filename]);

  return state;
}
