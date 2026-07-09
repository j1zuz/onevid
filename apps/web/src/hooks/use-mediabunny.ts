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

/**
 * Runs the full MediaBunny pipeline for one source and returns the finished
 * MP4 as a File. Video is passed through (H.264/AVC) and only audio is
 * re-encoded (→ Opus); the output is streamed into the given OPFS file.
 */
async function transcodeToMp4(
  source: File | string,
  opfsName: string,
  onProgress: (progress: number) => void
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
    video: { codec: "avc" },
    audio: { codec: "opus", numberOfChannels: 2, sampleRate: 48_000 },
  });

  if (!conversion.isValid) {
    const reason = conversion.discardedTracks[0]?.reason ?? "unknown";
    throw new Error(`No se pudo procesar el audio (${reason}).`);
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

  useEffect(() => {
    if (!(source && needsMediaBunny(filename))) {
      setState({ status: "idle" });
      return;
    }

    let aborted = false;
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
        const file = await transcodeToMp4(source, opfsName, (progress) => {
          if (!aborted) {
            setState({ status: "processing", progress });
          }
        });
        if (aborted) {
          return;
        }
        const blobUrl = URL.createObjectURL(file);
        blobUrlRef.current = blobUrl;
        setState({ status: "done", src: blobUrl });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await cleanup();
        if (!aborted) {
          setState({ status: "error", message: msg });
        }
      }
    })();

    return () => {
      aborted = true;
      cleanup();
    };
  }, [source, filename]);

  return state;
}
