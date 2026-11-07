"use client";

import posthog from "posthog-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { isTorboxRedirectUrl, needsMediaBunny } from "@/utils/stream-codec";

/** Una pista de audio del archivo de origen, para el selector de idioma. */
export interface MediaBunnyAudioTrack {
  index: number;
  /** Código ISO tal cual lo declara el contenedor ("spa", "eng", "und"…). */
  language: string;
  name: string | null;
}

/** Lo que el hook devuelve: el estado más el control de pista de audio. */
export type UseMediaBunny = MediaBunnyState & {
  audioTracks: MediaBunnyAudioTrack[];
  activeAudioTrack: number;
  /** No hace nada si la fuente no tiene varias pistas o va por el camino OPFS. */
  selectAudioTrack: (index: number) => void;
  /**
   * Reinicia la transcodificación progresiva en `sec` (reproducción en vivo). El
   * seek hacia adelante más allá de lo ya transcodificado se cuelga si no se
   * reinicia la conversión; esto la relanza en la nueva posición. No hace nada
   * fuera del camino progresivo (OPFS/nativo).
   */
  seekTo: (sec: number) => void;
};

export type MediaBunnyState =
  | { status: "idle" }
  // `mode` distingue la fase: "preparing" = arranque, mientras se intenta la
  // reproducción progresiva (puede acabar reproduciendo en vivo, sin transcode
  // completo) — NO se muestra porcentaje, porque la mayoría de las veces el
  // video reproduce bien y el % sería engañoso. "transcoding" = el camino lento
  // real (transcodifica todo antes de reproducir) — ahí sí se muestra el %.
  | { status: "processing"; progress: number; mode: "preparing" }
  // Reproducción progresiva: el <video> ya tiene una fuente reproducible
  // (MediaSource) y va recibiendo el video mientras se transcodifica, en vez
  // de esperar a que termine todo. `src` es estable durante toda la sesión.
  | { status: "streaming"; src: string; progress: number }
  | { status: "done"; src: string }
  | { status: "error"; message: string };

// Codecs the browser's <video> element can already decode natively once
// remuxed into an MP4 container — matches this project's own compatibility
// list in stream-codec.ts (SUPPORTED_VIDEO_PATTERNS/SUPPORTED_AUDIO_PATTERNS),
// but checked against the file's *real* codec (via mediabunny's track probing)
// instead of guessed from the filename.
// Codecs de vídeo que el <video> puede decodificar ya remuxados en MP4, sin
// re-encodear. `hevc` está aquí a propósito: Chromium lo decodifica cuando la
// plataforma se lo permite, y re-encodearlo "por si acaso" costaba el camino
// OPFS completo (medido: ~0,33x del tiempo real, inservible). Si un navegador
// concreto NO puede con él, `MediaSource.isTypeSupported` rechaza el mime al
// abrir el carril y caemos al camino OPFS igual que antes — nunca peor.
const PASSTHROUGH_VIDEO_CODECS = new Set(["avc", "hevc", "vp9", "av1"]);
// Motivo por el que la ruta progresiva se descarta antes de montar nada. El
// caller lo distingue de un fallo real para no loguearlo como advertencia.
const NON_PASSTHROUGH_VIDEO_ERROR =
  "Progressive playback requires a passthrough video codec";
// AAC variants can expose different codec strings (for example mp4a.40.5)
// while MediaSource expects the codec declared by the generated MP4. Always
// normalize audio to one AAC profile so the SourceBuffer and fragments match.

// Reproducción progresiva (MediaSource). Selector del <video> real que monta
// VideoJsStreamPlayer — el mismo que ya usa stream-onevid.tsx para el resume.
// Se busca en el DOM (en vez de recibir el elemento por prop) porque el hook
// produce la `src` ANTES de que el elemento exista; para cuando hace falta
// leer `currentTime` (evicción/contrapresión) el <video> ya está montado.
const STREAM_VIDEO_SELECTOR = ".stream-video-player-root video";
// Cuánto video por DELANTE del playhead mantenemos buffereado antes de pausar
// la transcodificación (contrapresión): mediabunny hace `await` de cada
// `write()`, así que no resolverlo frena la conversión y evita acumular toda
// la película en RAM. Ver el WritableStream de `runProgressivePlayback`.
// 20 s (antes 30): un 1080p de bitrate alto (WEB-DL de Apple TV+, ~20-25 Mbps)
// llenaba la cuota del SourceBuffer de Chromium con 30 s por delante, y al
// arrancar (sin nada reproducido por detrás que liberar) la evicción no
// alcanzaba → QuotaExceeded → caía al transcode completo. 20 s deja margen.
const BUFFER_AHEAD_HIGH_SEC = 20;
// Cuánto video ya reproducido conservamos DETRÁS del playhead al evictar para
// liberar memoria del SourceBuffer (permite un pequeño seek hacia atrás).
const BUFFER_BEHIND_KEEP_SEC = 10;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const OFFLINE_FILE_PREFIX = "onevid-offline-";
const OFFLINE_EXTENSIONS = [".mp4", ".mkv", ".webm", ".mov", ".m4v", ".ts"];
const OFFLINE_METADATA_PREFIX = "onevid-offline-meta:v1:";
export const OFFLINE_RETENTION_MS = 24 * 60 * 60 * 1000;

function offlineFileName(storageKey: string, extension: string): string {
  return `${OFFLINE_FILE_PREFIX}${encodeURIComponent(storageKey)}${extension}`;
}

function offlineMetadataKey(storageKey: string): string {
  return `${OFFLINE_METADATA_PREFIX}${storageKey}`;
}

function readOfflineExpiry(storageKey: string): number | null {
  try {
    const value = Number(localStorage.getItem(offlineMetadataKey(storageKey)));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeOfflineExpiry(storageKey: string, expiresAt: number): void {
  try {
    localStorage.setItem(offlineMetadataKey(storageKey), String(expiresAt));
  } catch {
    // OPFS remains the source of truth if browser storage is unavailable.
  }
}

function removeOfflineExpiry(storageKey: string): void {
  try {
    localStorage.removeItem(offlineMetadataKey(storageKey));
  } catch {
    // Best-effort metadata cleanup.
  }
}

export function getOfflineMediaExpiry(storageKey: string): number | null {
  return readOfflineExpiry(storageKey);
}

/**
 * Returns a previously saved media file from private browser storage.
 * The video bytes never leave OPFS or become a user-visible browser download.
 */
export async function getOfflineMediaFile(
  storageKey: string
): Promise<File | null> {
  if (!("storage" in navigator) || !navigator.storage.getDirectory) {
    return null;
  }
  const expiresAt = readOfflineExpiry(storageKey);
  if (expiresAt !== null && expiresAt <= Date.now()) {
    await deleteOfflineMediaFile(storageKey);
    return null;
  }
  const root = await navigator.storage.getDirectory();
  for (const extension of OFFLINE_EXTENSIONS) {
    try {
      const handle = await root.getFileHandle(
        offlineFileName(storageKey, extension)
      );
      const file = await handle.getFile();
      // A canceled/failed write must never become the source of a blob URL.
      // Chromium reports an opaque demuxer error for an empty OPFS file.
      if (file.size === 0) {
        await root.removeEntry(offlineFileName(storageKey, extension));
        continue;
      }
      if (expiresAt === null) {
        writeOfflineExpiry(storageKey, Date.now() + OFFLINE_RETENTION_MS);
      }
      return file;
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        continue;
      }
      throw error;
    }
  }
  return null;
}

/** Removes every cached variant for a title after an invalid offline file. */
export async function deleteOfflineMediaFile(storageKey: string): Promise<void> {
  removeOfflineExpiry(storageKey);
  if (!("storage" in navigator) || !navigator.storage.getDirectory) {
    return;
  }
  const root = await navigator.storage.getDirectory();
  for (const extension of OFFLINE_EXTENSIONS) {
    try {
      await root.removeEntry(offlineFileName(storageKey, extension));
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        continue;
      }
      throw error;
    }
  }
}

export function offlineStorageKey(
  contentType: string,
  rawId: string
): string {
  return `${contentType}:${rawId}`;
}

/**
 * Builds the options for mediabunny's `UrlSource`, which reads the remote stream
 * over parallel HTTP Range requests deep inside the library. When the connection
 * drops, `fetch` rejects with a bare, stack-less error (Firefox:
 * `TypeError: NetworkError when attempting to fetch resource.`) that our
 * `try/catch` around `execute()` cannot reach, so it escapes to
 * `unhandledrejection`.
 *
 * The `fetchFn` wrapper intercepts every read so a genuine failure is re-thrown
 * as an `Error` that carries the URL. That travels the normal conversion-error
 * path (→ `setState({ status: "error" })`) with real context. A read that fails
 * only because the component unmounted mid-request keeps its original bare shape,
 * so the `before_send` filter in instrumentation-client.ts drops it as noise
 * instead of it becoming a stack-carrying issue of its own.
 */
function urlSourceOptions(url: string, abortedRef: { current: boolean }) {
  return {
    fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        return await fetch(input, init);
      } catch (error) {
        if (abortedRef.current) {
          throw error;
        }
        const cause = error instanceof Error ? error : new Error(String(error));
        throw new Error(`Range read failed for ${url}: ${cause.message}`, {
          cause,
        });
      }
    },
  };
}

/**
 * Bridges MediaBunny's `StreamTarget` chunks to an OPFS writable. The MP4 muxer
 * emits chunks at arbitrary positions, so each write seeks first.
 */
function createOpfsWriteStream(opfsWritable: FileSystemWritableFileStream) {
  let settled = false;
  return new WritableStream({
    async write(chunk: { data: Uint8Array; position: number }) {
      await opfsWritable.seek(chunk.position);
      await opfsWritable.write(
        chunk.data.slice() as unknown as FileSystemWriteChunkType
      );
    },
    close() {
      if (settled) return;
      settled = true;
      return opfsWritable.close();
    },
    abort() {
      if (settled) return;
      settled = true;
      return opfsWritable.abort();
    },
  });
}

/**
 * Motivo por el que una conversión quedó sin pistas utilizables. Se salta los
 * descartes propios (`discarded_by_user`): esos son intencionados y decir
 * "discarded_by_user" en un mensaje de error no le sirve a nadie.
 */
function describeDiscard(conversion: {
  discardedTracks: readonly { reason: string }[];
}): string {
  const real = conversion.discardedTracks.find(
    (track) => track.reason !== "discarded_by_user"
  );
  return real?.reason ?? conversion.discardedTracks[0]?.reason ?? "unknown";
}

/** Minimal shape used to cancel an in-flight conversion from the caller. */
export interface CancellableConversion {
  cancel: () => Promise<void>;
}

/** Resuelve cuando el SourceBuffer termina la operación en curso (append/remove). */
function waitForUpdateEnd(sb: SourceBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      sb.removeEventListener("updateend", onDone);
      sb.removeEventListener("error", onFail);
    };
    const onDone = () => {
      cleanup();
      resolve();
    };
    const onFail = () => {
      cleanup();
      let state = "detached";
      try {
        state = `${sb.buffered.length} buffered ranges, updating=${sb.updating}`;
      } catch {
        // The browser may detach the SourceBuffer before dispatching `error`.
      }
      reject(new Error(`SourceBuffer error (${state})`));
    };
    sb.addEventListener("updateend", onDone, { once: true });
    sb.addEventListener("error", onFail, { once: true });
  });
}

/** Segundos ya buffereados por delante de `t` (0 si `t` cae fuera de todo rango). */
function bufferedAheadOf(sb: SourceBuffer, t: number): number {
  let ranges: TimeRanges;
  try {
    ranges = sb.buffered;
  } catch {
    return 0;
  }
  for (let i = 0; i < ranges.length; i++) {
    if (t >= ranges.start(i) - 0.5 && t <= ranges.end(i) + 0.5) {
      return ranges.end(i) - t;
    }
  }
  return 0;
}

function findStreamVideoEl(): HTMLVideoElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  return document.querySelector<HTMLVideoElement>(STREAM_VIDEO_SELECTOR);
}

/**
 * Devuelve el audio object type (2 = AAC-LC, 5 = HE-AAC v1, 29 = HE-AAC v2)
 * leído de UN descriptor `esds` que empieza en `esdsIdx` (apuntando al campo
 * size que precede al fourcc "esds"). Devuelve null si no se puede localizar.
 *
 * Layout de la FullBox esds: [size:4][type:4][version+flags:4][ES_Descriptor].
 * Recorremos los descriptores anidados buscando el DecoderSpecificInfo (tag 5),
 * cuyo payload ES el AudioSpecificConfig; su primer campo de 5 bits es el
 * audio object type.
 */
function readAacObjectTypeAtEsds(moov: Uint8Array, esdsIdx: number): number | null {
  // `esdsIdx` apunta al campo size que precede al fourcc "esds" (indexOfFourcc
  // devuelve `i - 4`). Layout: [size:4][type:4][version+flags:4][ES_Descriptor],
  // así que el primer descriptor empieza 12 bytes después del campo size.
  let p = esdsIdx + 4 + 4 + 4;
  const end = Math.min(moov.length, esdsIdx + 200);
  const readTag = (): { tag: number; len: number } | null => {
    if (p >= end) {
      return null;
    }
    const tag = moov[p++];
    // Tamaño en formato "expandable" de ISO 14496-1: 1-4 bytes, bit alto = más.
    let len = 0;
    for (let i = 0; i < 4; i++) {
      if (p >= end) {
        return null;
      }
      const b = moov[p++];
      len = (len << 7) | (b & 0x7f);
      if (!(b & 0x80)) {
        break;
      }
    }
    return { tag, len };
  };
  // ES_Descriptor (0x03) → DecoderConfigDescriptor (0x04) → DecoderSpecificInfo (0x05)
  const esDesc = readTag();
  if (esDesc?.tag !== 0x03) {
    return null;
  }
  p += 2 + 1; // ES_ID(2) + flags(1)
  const decCfg = readTag();
  if (decCfg?.tag !== 0x04) {
    return null;
  }
  p += 1 + 3 + 4 + 4; // objectTypeIndication(1) + streamType(1) + bufferSizeDB(3) + maxBitrate(4) + avgBitrate(4)
  const spec = readTag();
  if (spec?.tag !== 0x05 || spec.len < 1) {
    return null;
  }
  // Primeros 5 bits del AudioSpecificConfig = audioObjectType.
  return moov[p] >> 3;
}

/**
 * Recorre el init segment y devuelve el audio object type del PRIMER esds de
 * audio válido. Un MP4 con varias pistas de audio tiene un `esds` por pista;
 * el SourceBuffer multiplexado declara UN solo codec de audio, así que lo que
 * importa es que exista al menos una pista AAC-LC coherente con el mime
 * `mp4a.40.2` que mediabunny declara. Si todas las pistas son HE-AAC (5/29),
 * devolvemos ese object type para corregir el mime.
 *
 * Por qué hace falta: `Output.getMimeType()` de mediabunny declara `mp4a.40.2`
 * (AAC-LC) para el MP4 fragmentado, pero el `esds` que el muxer escribe puede
 * llevar object type 5/29 cuando el encoder nativo decide HE-AAC. Chromium
 * valida el primer frame contra el `esds` y contra el mime declarado en el
 * SourceBuffer; al no coincidir, rechaza el append con
 * CHUNK_DEMUXER_ERROR_APPEND_FAILED ("Audio stream codec aac doesn't match").
 */
function parseAacObjectTypeFromMoov(moov: Uint8Array): number | null {
  const esdsPositions: number[] = [];
  let from = 0;
  for (;;) {
    const idx = indexOfFourcc(moov, "esds", from);
    if (idx === -1) {
      break;
    }
    esdsPositions.push(idx);
    from = idx + 8;
  }
  let sawAacLc = false;
  let heObjectType: number | null = null;
  for (const idx of esdsPositions) {
    const ot = readAacObjectTypeAtEsds(moov, idx);
    if (ot === 2) {
      sawAacLc = true;
    } else if (ot === 5 || ot === 29) {
      heObjectType = ot;
    }
  }
  // Si hay al menos una pista AAC-LC, el mime mp4a.40.2 declarado es correcto
  // para esa pista. Solo corregimos el mime cuando TODAS las pistas son HE-AAC.
  if (sawAacLc) {
    return 2;
  }
  return heObjectType;
}

function indexOfFourcc(buf: Uint8Array, fourcc: string, from: number): number {
  const c0 = fourcc.charCodeAt(0);
  const c1 = fourcc.charCodeAt(1);
  const c2 = fourcc.charCodeAt(2);
  const c3 = fourcc.charCodeAt(3);
  for (let i = from; i + 4 <= buf.length; i++) {
    if (
      buf[i] === c0 &&
      buf[i + 1] === c1 &&
      buf[i + 2] === c2 &&
      buf[i + 3] === c3
    ) {
      return i - 4; // incluir el campo size que precede al fourcc
    }
  }
  return -1;
}

/**
 * Runs the full MediaBunny pipeline for one source and returns the finished
 * MP4 as a File. Video is passed through (H.264/AVC) and only audio is
 * re-encoded (→ Opus); the output is streamed into the given OPFS file.
 *
 * Es el camino de FALLBACK: transcodifica el archivo completo antes de
 * reproducir. `runProgressivePlayback` intenta primero reproducir mientras se
 * transcodifica; si no es posible (o falla), se cae a esta función.
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
// biome-ignore lint/correctness/noUnusedVariables: kept as the non-streaming reference path for future download flows.
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
    { registerDtsDecoder },
    { registerAacEncoder },
    { registerTrueHdDecoder },
  ] = await Promise.all([
    import("mediabunny"),
    import("@mediabunny/ac3"),
    import("@mediabunny/dts"),
    import("@mediabunny/aac-encoder"),
    import("@mediabunny/truehd"),
  ]);

  registerAc3Decoder();
  registerDtsDecoder();
  registerTrueHdDecoder();
  // Forzar SIEMPRE el encoder AAC del polyfill (AAC-LC garantizado): el encoder
  // nativo de Chromium a veces produce HE-AAC y su esds no coincide con el mime
  // "mp4a.40.2" declarado, y Chromium rechaza el append (code 4).
  registerAacEncoder();

  // Random-access source: `BlobSource` for a local `File` (already fully
  // available) and `UrlSource` for a remote URL (fetches byte ranges via HTTP
  // Range, so it can seek backward without buffering everything). This is what
  // avoids the "Read is before the cached region" error.
  const inputSource =
    typeof source === "string"
      ? new UrlSource(source, urlSourceOptions(source, abortedRef))
      : new BlobSource(source);

  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(opfsName, { create: true });
  const opfsWritable = await fileHandle.createWritable();

  const conversion = await Conversion.init({
    input: new Input({ source: inputSource, formats: ALL_FORMATS }),
    output: new Output({
      format: new Mp4OutputFormat(),
      target: new StreamTarget(createOpfsWriteStream(opfsWritable)),
    }),
    // Returning `{}` keeps AAC as a raw packet copy. Every other audio codec
    // becomes AAC, which can play in an MP4 file on all target browsers.
    video: async (track) => {
      const codec = await track.getCodec();
      return codec && PASSTHROUGH_VIDEO_CODECS.has(codec) ? {} : { codec: "avc" };
    },
    audio: async () => ({
      codec: "aac",
      numberOfChannels: 2,
      sampleRate: 48_000,
      // `bitrate` es obligatorio para que el polyfill de AAC-LC se active: su
      // `supports()` exige bitrate definido; sin él, mediabunny cae al encoder
      // nativo de Chromium, que a veces produce HE-AAC (object type 5/29).
      bitrate: 128_000,
      forceTranscode: true,
    }),
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
  try {
    await conversion.execute();
  } catch (error) {
    // A SourceBuffer failure rejects a pending write. Cancel the conversion
    // without allowing StreamTarget's follow-up close to become an
    // unhandled "Cannot close a ERRORED writable stream" rejection.
    try {
      await conversion.cancel();
    } catch {
      // The stream is already errored; the original SourceBuffer error is the
      // actionable failure and is rethrown below.
    }
    throw error;
  }
  return await fileHandle.getFile();
}

/**
 * Igual que `transcodeToMp4` pero escribe a un WritableStream arbitrario en vez
 * de crear un File, y no devuelve un File. Devuelve "canceled" si se abortó;
 * lanza si falla de verdad.
 * StreamTarget cierra el writable al terminar y lo aborta al cancelar.
 */
async function transcodeToWritable(
  source: string,
  writeStream: WritableStream,
  onProgress: ((progress: number) => void) | undefined,
  conversionRef: { current: CancellableConversion | null },
  abortedRef: { current: boolean },
  /**
   * Índice 0-based de la pista de audio que se quiere CONSERVAR en el archivo
   * descargado. `undefined` mantiene todas (comportamiento antiguo). Con un
   * índice, el resto se descarta: el MP4 offline trae una sola pista, así que
   * el `<video>` reproduce el idioma elegido sin depender del `audioTracks`
   * del navegador (que Chromium no expone para blobs locales).
   */
  audioTrackIndex?: number
): Promise<DownloadOutcome> {
  const [
    {
      Input,
      Output,
      Conversion,
      UrlSource,
      ALL_FORMATS,
      Mp4OutputFormat,
      StreamTarget,
    },
    { registerAc3Decoder },
    { registerDtsDecoder },
    { registerAacEncoder },
    { registerTrueHdDecoder },
  ] = await Promise.all([
    import("mediabunny"),
    import("@mediabunny/ac3"),
    import("@mediabunny/dts"),
    import("@mediabunny/aac-encoder"),
    import("@mediabunny/truehd"),
  ]);
  registerAc3Decoder();
  registerDtsDecoder();
  registerTrueHdDecoder();
  registerAacEncoder();

  const input = new Input({
    source: new UrlSource(source, urlSourceOptions(source, abortedRef)),
    formats: ALL_FORMATS,
  });

  // Resolver la pista elegida contra las pistas REALES del archivo: el índice
  // viene del player y puede quedar fuera de rango (p. ej. si la lista aún no
  // estaba cargada). Elegir una pista inexistente descartaría todo el audio.
  let selectedAudioIndex: number | null = null;
  if (audioTrackIndex !== undefined && Number.isFinite(audioTrackIndex)) {
    const tracks = await input.getAudioTracks();
    if (tracks.length > 0) {
      selectedAudioIndex = Math.min(
        Math.max(Math.floor(audioTrackIndex), 0),
        tracks.length - 1
      );
    }
  }

  const conversion = await Conversion.init({
    input,
    output: new Output({
      format: new Mp4OutputFormat(),
      target: new StreamTarget(writeStream),
    }),
    video: async (track) => {
      const codec = await track.getCodec();
      return codec && PASSTHROUGH_VIDEO_CODECS.has(codec) ? {} : { codec: "avc" };
    },
    // `n` es 1-based por tipo. Si hay idioma elegido, solo esa pista se
    // re-encodea a AAC; las demás se descartan.
    audio: async (_track, n) =>
      selectedAudioIndex === null || n === selectedAudioIndex + 1
        ? {
            codec: "aac",
            numberOfChannels: 2,
            sampleRate: 48_000,
            bitrate: 128_000,
            forceTranscode: true,
          }
        : { discard: true },
  });
  if (!conversion.isValid) {
    throw new Error(
      `No se pudo procesar el archivo (${describeDiscard(conversion)}).`
    );
  }
  conversionRef.current = conversion;
  if (abortedRef.current) {
    await conversion.cancel();
    return "canceled";
  }
  conversion.onProgress = (progress) => onProgress?.(progress);
  try {
    await conversion.execute();
  } catch (error) {
    try {
      await conversion.cancel();
    } catch {
      /* ya errored: el error real se relanza abajo */
    }
    if (abortedRef.current) {
      return "canceled";
    }
    throw error;
  }
  return "done";
}

/**
 * Reproducción progresiva (MediaSource) en DOS carriles independientes: uno de
 * vídeo y otro de audio, cada uno con su propia `Conversion`, su `Output` y su
 * `SourceBuffer` sobre el mismo `MediaSource`.
 *
 * Por qué separados y no un único MP4 mixto: un `SourceBuffer` admite UNA sola
 * pista de audio. Con varias, Chromium rechaza el init segment entero con
 * "Audio stream codec aac doesn't match SourceBuffer codecs", porque el mime
 * solo puede declarar un `mp4a` — y los releases multi-idioma traen cuatro o
 * cinco. Separando los carriles, cambiar de idioma solo reemplaza el contenido
 * del carril de audio: el vídeo ya buffereado sigue intacto, sin recarga ni
 * salto. Es el mismo reparto que usa DASH.
 *
 * Requisitos (si no se cumplen se LANZA, para que el caller caiga al camino
 * OPFS completo): navegador con MediaSource, vídeo que pasa sin re-encodear
 * (ver PASSTHROUGH_VIDEO_CODECS — su codec string se conoce de antemano) y
 * mimes que `MediaSource.isTypeSupported` acepte. Re-encodear vídeo aquí no es
 * una opción: medido en Chromium, pasar HEVC a AVC en el navegador va a ~0,33x
 * del tiempo real y la reproducción se queda sin buffer en segundos.
 *
 * Contrapresión: mediabunny hace `await` de cada `write()` del StreamTarget, así
 * que basta con no resolver el write mientras haya buffer por delante para
 * frenar la conversión y no acumular la película en memoria. Evicción: se borra
 * lo ya reproducido ante un QuotaExceededError.
 *
 * Limitación conocida: el seek HACIA ADELANTE más allá de lo ya transcodificado
 * se queda esperando (la conversión es secuencial); hacia atrás, dentro de la
 * ventana retenida, es inmediato.
 */
async function runProgressivePlayback(opts: {
  source: File | string;
  /**
   * El origen es un HLS en directo (Live TV). Cambia el modo de espera del
   * input, desactiva la duración/seek/EOF y deja la conversión corriendo hasta
   * que se cancele: un directo no termina.
   */
  live?: boolean;
  /** Índice 0-based de la pista de audio con la que arrancar. */
  audioTrackIndex: number;
  onProgress: (progress: number) => void;
  onStreamStart: (src: string) => void;
  onAudioTracks: (tracks: MediaBunnyAudioTrack[], activeIndex: number) => void;
  /** Publica el conmutador de pista de audio, o `null` al terminar. */
  onAudioSwitcher: (switcher: ((index: number) => void) | null) => void;
  /** Publica el seek (reinicio de la transcodificación en un offset), o `null`. */
  onSeekRestart: (seek: ((sec: number) => void) | null) => void;
  conversionRef: { current: CancellableConversion | null };
  abortedRef: { current: boolean };
  cleanupRef: { current: (() => void) | null };
}): Promise<void> {
  const { source, onProgress, onStreamStart, abortedRef, live = false } = opts;

  if (typeof MediaSource === "undefined") {
    throw new Error("MediaSource no soportado");
  }

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
    { registerDtsDecoder },
    { registerAacEncoder },
    { registerTrueHdDecoder },
  ] = await Promise.all([
    import("mediabunny"),
    import("@mediabunny/ac3"),
    import("@mediabunny/dts"),
    import("@mediabunny/aac-encoder"),
    import("@mediabunny/truehd"),
  ]);

  registerAc3Decoder();
  registerDtsDecoder();
  registerTrueHdDecoder();
  // Forzar SIEMPRE el encoder AAC del polyfill (AAC-LC garantizado). El encoder
  // nativo de Chromium a veces produce HE-AAC (object type 5/29) y entonces el
  // esds del `moov` no coincide con el `mp4a.40.2` declarado en el SourceBuffer.
  registerAacEncoder();

  // Cada carril lee por su cuenta: dos `Input` en vez de uno compartido, porque
  // dos `Conversion` concurrentes sobre el mismo `Input` competirían por su
  // estado de lectura. El coste son peticiones Range duplicadas; el carril de
  // audio es barato comparado con el de vídeo.
  const makeInput = () =>
    new Input({
      source:
        typeof source === "string"
          ? new UrlSource(source, urlSourceOptions(source, abortedRef))
          : new BlobSource(source),
      formats: ALL_FORMATS,
      // En HLS, los timestamps anclados al epoch (por `#EXT-X-PROGRAM-DATE-TIME`)
      // no sirven para MSE: el <video> arrancaría en 1.7e9 s. Relativos, el
      // muxer empieza cerca de 0 y el navegador puede reproducir el directo.
      formatOptions: { hls: { offsetTimestampsByDateTime: false } },
    });

  const probe = makeInput();

  // El vídeo solo puede ir en passthrough: su codec string (avc1.*) se conoce
  // de antemano y por eso el SourceBuffer se puede declarar antes de muxear.
  const primaryVideoTrack = await probe.getPrimaryVideoTrack();
  if (primaryVideoTrack) {
    const inputVideoCodec = await primaryVideoTrack.getCodec();
    if (!(inputVideoCodec && PASSTHROUGH_VIDEO_CODECS.has(inputVideoCodec))) {
      throw new Error(NON_PASSTHROUGH_VIDEO_ERROR);
    }
  }

  const inputAudioTracks = await probe.getAudioTracks();
  const audioTracks: MediaBunnyAudioTrack[] = inputAudioTracks.map(
    (track, index) => ({
      index,
      language: track.languageCode,
      name: track.name,
    })
  );
  let activeAudioIndex = 0;
  if (audioTracks.length > 0) {
    activeAudioIndex = Math.min(
      Math.max(opts.audioTrackIndex, 0),
      audioTracks.length - 1
    );
  }
  opts.onAudioTracks(audioTracks, activeAudioIndex);

  // Separar el audio en su propio carril solo tiene sentido si hay entre qué
  // elegir. Con una única pista cuesta caro y no aporta nada: son dos lecturas
  // del mismo archivo compitiendo por el ancho de banda, y el primer frame
  // llega bastante más tarde (medido: 36 s frente a 14 s). Con una sola pista
  // se muxea todo en el carril de vídeo, como antes.
  // En directo siempre un solo carril: muxear vídeo+audio juntos es justo lo
  // que deja que el <video> sincronice A/V por su cuenta.
  const useSeparateAudioLane = !live && audioTracks.length > 1;

  // Siempre AAC-LC: es lo único que el <video> decodifica en todas las
  // plataformas, y el AC-3/E-AC-3 de los releases no lo soporta ni Chromium.
  const aacOutputConfig = {
    codec: "aac",
    numberOfChannels: 2,
    sampleRate: 48_000,
    // `bitrate` es obligatorio para que el polyfill de AAC-LC se active: su
    // `supports()` exige bitrate definido; sin él, mediabunny cae al encoder
    // nativo de Chromium, que a veces produce HE-AAC (object type 5/29) y su
    // esds no coincide con el `mp4a.40.2` declarado en el SourceBuffer.
    bitrate: 128_000,
    forceTranscode: true,
  } as const;

  const mediaSource = new MediaSource();
  const objectUrl = URL.createObjectURL(mediaSource);
  let progressiveError: Error | null = null;

  const videoConversionRef: { current: CancellableConversion | null } = {
    current: null,
  };
  const audioConversionRef: { current: CancellableConversion | null } = {
    current: null,
  };
  // El caller cancela por este ref; tiene que alcanzar a los dos carriles.
  opts.conversionRef.current = {
    cancel: async () => {
      await Promise.allSettled([
        videoConversionRef.current?.cancel(),
        audioConversionRef.current?.cancel(),
      ]);
    },
  };

  const failProgressivePlayback = (error: unknown) => {
    progressiveError ??=
      error instanceof Error ? error : new Error(String(error));
    void videoConversionRef.current?.cancel().catch(() => undefined);
    void audioConversionRef.current?.cancel().catch(() => undefined);
  };

  // Timer del timeout de `sourceopen`, fuera de la promesa para que `cleanup`
  // pueda cancelarlo al abortar.
  let sourceOpenTimer: ReturnType<typeof setTimeout> | null = null;
  const clearSourceOpenTimer = () => {
    if (sourceOpenTimer !== null) {
      clearTimeout(sourceOpenTimer);
      sourceOpenTimer = null;
    }
  };

  interface Lane {
    kind: "video" | "audio";
    sourceBuffer: SourceBuffer | null;
    ready: boolean;
    pending: Uint8Array[];
    chain: Promise<void>;
  }
  const lanes: Record<"video" | "audio", Lane> = {
    video: { kind: "video", sourceBuffer: null, ready: false, pending: [], chain: Promise.resolve() },
    audio: { kind: "audio", sourceBuffer: null, ready: false, pending: [], chain: Promise.resolve() },
  };

  opts.cleanupRef.current = () => {
    clearSourceOpenTimer();
    for (const lane of Object.values(lanes)) {
      lane.ready = false;
      lane.pending.length = 0;
    }
    // NO revocar el objectUrl acá: en React StrictMode el efecto corre dos veces
    // y revocarlo antes de que el <video> lo monte mata `sourceopen`. Queda a
    // cargo del GC del browser.
  };

  const evictBehindPlayhead = async (sb: SourceBuffer) => {
    let ranges: TimeRanges;
    try {
      ranges = sb.buffered;
    } catch {
      throw new DOMException("SourceBuffer was detached", "InvalidStateError");
    }
    if (ranges.length === 0) {
      return;
    }
    const video = findStreamVideoEl();
    const start = ranges.start(0);
    const leadingEdge = ranges.end(ranges.length - 1);
    const playhead = video ? video.currentTime : leadingEdge;
    const removeEnd = Math.max(start, playhead - BUFFER_BEHIND_KEEP_SEC);
    let updating = true;
    try {
      updating = sb.updating;
    } catch {
      throw new DOMException("SourceBuffer was detached", "InvalidStateError");
    }
    if (removeEnd > start && !updating) {
      sb.remove(start, removeEnd);
      await waitForUpdateEnd(sb);
    } else {
      // Nada que liberar por detrás: dale un respiro a la reproducción.
      await sleep(300);
    }
  };

  const appendInOrder = async (lane: Lane, data: Uint8Array) => {
    const sb = lane.sourceBuffer;
    if (!sb) {
      throw new Error(`SourceBuffer de ${lane.kind} no disponible`);
    }
    for (;;) {
      if (abortedRef.current) {
        return;
      }
      if (mediaSource.readyState !== "open") {
        throw new DOMException("MediaSource is not open", "InvalidStateError");
      }
      try {
        // `as unknown as BufferSource`: `chunk.data` es un Uint8Array (válido
        // como BufferSource), pero el genérico Uint8Array<ArrayBufferLike> de
        // TS 5.7+ no es directamente asignable.
        sb.appendBuffer(data as unknown as BufferSource);
        await waitForUpdateEnd(sb);
        return;
      } catch (error) {
        const name = (error as DOMException | null)?.name;
        // Buffer lleno: NO es un fallo. La reproducción va bien; solo falta
        // espacio para seguir transcodificando por delante. Evictamos lo ya
        // reproducido y reintentamos SIN tope — a medida que el usuario mira, el
        // playhead avanza y libera espacio. Antes se rendía a los 8 intentos y
        // caía a transcodificar TODA la peli ("descargarla"), que es mucho peor
        // que esperar unos segundos. `evictBehindPlayhead` ya duerme cuando no
        // hay nada que liberar, así que esto no es un bucle ocupado; sale al
        // abortar (desmontar) o cuando entra espacio.
        if (name === "QuotaExceededError") {
          await evictBehindPlayhead(sb);
          continue;
        }
        throw error;
      }
    }
  };

  // Un SourceBuffer solo acepta un append a la vez; la cadena por carril también
  // conserva el orden de las cabeceras retenidas hasta conocer el mime.
  const scheduleAppend = (lane: Lane, data: Uint8Array) => {
    lane.chain = lane.chain.then(() => appendInOrder(lane, data));
    return lane.chain;
  };

  const applyBackpressure = async (lane: Lane) => {
    const video = findStreamVideoEl();
    const sb = lane.sourceBuffer;
    if (!(video && sb)) {
      return;
    }
    while (!abortedRef.current) {
      if (bufferedAheadOf(sb, video.currentTime) < BUFFER_AHEAD_HIGH_SEC) {
        return;
      }
      await sleep(200);
    }
  };

  const writableFor = (lane: Lane) =>
    new WritableStream({
      async write(chunk: { data: Uint8Array; position: number }) {
        if (abortedRef.current) {
          return;
        }
        // La cabecera del MP4 se escribe antes de que mediabunny conozca todos
        // los codecs de salida. Esos primeros chunks se retienen hasta que el
        // SourceBuffer tiene el mime exacto, y luego se agregan en orden.
        if (!lane.ready) {
          lane.pending.push(chunk.data.slice());
          return;
        }
        try {
          await scheduleAppend(lane, chunk.data);
          await applyBackpressure(lane);
        } catch (error) {
          // No rechazar el WritableStream tras un fallo de MSE: StreamTarget
          // puede seguir llamando a close() durante la cancelación, y cerrar un
          // writer en estado ERRORED dispara un segundo error que tapa el real.
          failProgressivePlayback(error);
        }
      },
    });

  // El `ChunkDemuxer` de Chromium solo acepta SourceBuffers nuevos mientras
  // sigue inicializando: en cuanto UNO recibe su init segment, cualquier
  // `addSourceBuffer` posterior falla con QuotaExceededError ("has reached the
  // limit of SourceBuffer objects"). Como cada carril conoce su mime cuando su
  // propia conversión arranca a producir, el de audio llegaba tarde. Esta
  // barrera retiene los appends hasta que los dos carriles están creados.
  const expectedLanes = useSeparateAudioLane ? 2 : 1;
  let createdLanes = 0;
  let releaseLaneBarrier!: () => void;
  const laneBarrier = new Promise<void>((resolve) => {
    releaseLaneBarrier = resolve;
  });

  /** Crea el SourceBuffer del carril y drena lo que quedó retenido. */
  const openLane = async (lane: Lane, mimeType: string) => {
    if (!MediaSource.isTypeSupported(mimeType)) {
      throw new Error(`Unsupported MSE mime: ${mimeType}`);
    }
    const sb = mediaSource.addSourceBuffer(mimeType);
    lane.sourceBuffer = sb;
    createdLanes++;
    if (createdLanes >= expectedLanes) {
      releaseLaneBarrier();
    }
    await laneBarrier;
    // El drenado va DENTRO de la cadena del carril, no suelto: en cuanto
    // `ready` pasa a true los `write()` empiezan a encolar sus propios appends,
    // y un append suelto en paralelo choca con ellos ("This SourceBuffer is
    // still processing an 'appendBuffer' or 'remove' operation"). Encolarlo
    // primero conserva el orden y serializa todo por el mismo canal.
    lane.chain = lane.chain.then(async () => {
      // De a uno, esperando el `updateend` de cada append: así el init segment
      // (ftyp/moov) nunca compite con el primer fragmento (moof).
      for (const data of lane.pending.splice(0)) {
        sb.appendBuffer(data as unknown as BufferSource);
        await waitForUpdateEnd(sb);
      }
    });
    lane.ready = true;
    await lane.chain;
  };

  /**
   * Corrige el codec AAC del mime según el `esds` REAL del `moov` ya generado:
   * `getMimeType()` declara `mp4a.40.2` pero el esds puede llevar object type
   * 5/29 si el encoder decidió HE-AAC, y Chromium rechaza el append si no
   * coinciden.
   */
  const fixAacProfile = (mimeType: string, pending: Uint8Array[]) => {
    const moovChunk = pending.find((c) => indexOfFourcc(c, "moov", 0) !== -1);
    if (!moovChunk) {
      return mimeType;
    }
    const objectType = parseAacObjectTypeFromMoov(moovChunk);
    if (objectType === null) {
      return mimeType;
    }
    const fixed = mimeType.replace(/mp4a\.40\.\d+/, `mp4a.40.${objectType}`);
    if (fixed !== mimeType) {
      console.info(
        `[mediabunny] perfil AAC corregido por esds: ${mimeType} -> ${fixed}`
      );
    }
    return fixed;
  };

  const sourceOpen = new Promise<void>((resolve, reject) => {
    sourceOpenTimer = setTimeout(
      () => reject(new Error("MediaSource sourceopen timed out")),
      15_000
    );
    mediaSource.addEventListener(
      "sourceopen",
      () => {
        // Cancelar el timer AQUÍ y no al final del montaje: `sourceopen` ya
        // disparó, que es lo único que este timeout vigila. Dejarlo armado
        // durante el montaje hacía que un arranque lento se reportara como
        // "sourceopen timed out" con el SourceBuffer ya creado.
        clearSourceOpenTimer();
        resolve();
      },
      { once: true }
    );
  });
  // Nadie espera `sourceOpen` hasta el primer `write()`; si el stream se aborta
  // antes, su rechazo llegaría a `unhandledrejection`.
  sourceOpen.catch(() => {
    /* aborted before anyone awaited it */
  });

  // Publica la fuente reproducible AHORA: el player monta el <video>, que
  // dispara `sourceopen`.
  onStreamStart(objectUrl);
  await sourceOpen;

  // `getDurationFromMetadata()` sin `skipLiveWait` espera a que el directo
  // termine, así que en vivo ni se consulta: `mediaSource.duration` se queda
  // como la calcula el navegador (infinita mientras el stream siga vivo).
  if (!live) {
    const durationSec = await probe
      .getDurationFromMetadata()
      .catch(() => null);
    if (durationSec && Number.isFinite(durationSec) && durationSec > 0) {
      try {
        // Fijar la duración desde los metadatos evita que el scrubber quede sin
        // longitud y que el guardado de progreso reciba `duration: 0`.
        mediaSource.duration = durationSec;
      } catch {
        /* la resuelve `endOfStream` al final */
      }
    }
  }

  // Estado del seek, leído por el bucle de reproducción y por los carriles para
  // abandonar temprano si llega un destino más nuevo mientras montan. Declarado
  // acá para quedar en alcance de `runVideoLane`/`runAudioLane`.
  let seekTarget = 0;
  let hasSeek = false;

  const runVideoLane = async (trimStart = 0) => {
    const lane = lanes.video;
    // Reinicio por seek: el carril ya existe, así que se reutiliza su
    // SourceBuffer en vez de crear uno nuevo.
    const resuming = Boolean(lane.ready && lane.sourceBuffer);
    const output = new Output({
      // `fastStart: "fragmented"` = MP4 append-only (init al frente, luego
      // moof+mdat en orden), que es lo que MSE necesita.
      format: new Mp4OutputFormat({ fastStart: "fragmented" }),
      target: new StreamTarget(writableFor(lane)),
    });
    const conversion = await Conversion.init({
      // En el arranque reutiliza el Input del sondeo (sus metadatos ya están
      // leídos, ahorra una lectura del `moov`). En un reinicio por seek hace
      // falta un lector nuevo: `probe` ya está consumido.
      input: resuming ? makeInput() : probe,
      output,
      video: (_track, n) => (n === 1 ? {} : { discard: true }),
      audio: useSeparateAudioLane
        ? { discard: true }
        : // `n` es 1-based por tipo. Solo sobrevive una pista: el mime del
          // SourceBuffer únicamente puede declarar un `mp4a`, y con varias
          // Chromium rechaza el init segment entero.
          (_track, n) =>
            n === activeAudioIndex + 1 ? aacOutputConfig : { discard: true },
      ...(trimStart > 0 ? { trim: { start: trimStart } } : {}),
    });
    if (!conversion.isValid) {
      throw new Error(
        `No se pudo procesar el vídeo (${describeDiscard(conversion)}).`
      );
    }
    videoConversionRef.current = conversion;
    if (abortedRef.current) {
      await conversion.cancel();
      return;
    }
    // Llegó un seek más nuevo mientras montábamos este carril: abandona esta
    // conversión para que el bucle reinicie en la posición correcta, sin
    // transcodificar el archivo entero primero.
    if (hasSeek) {
      await conversion.cancel();
      return;
    }
    if (!live) {
      conversion.onProgress = onProgress;
    }
    if (resuming && lane.sourceBuffer) {
      // El codec de salida es el mismo, así que se reutiliza el SourceBuffer.
      // mediabunny rebasa la salida recortada a 0; `timestampOffset` la devuelve
      // a la línea de tiempo global del <video>. Se fija ANTES de arrancar: en
      // cuanto produzca, sus writes ya se appendean en la posición correcta.
      lane.sourceBuffer.timestampOffset = trimStart;
      await conversion.execute();
      return;
    }
    // `getMimeType()` no resuelve hasta que la conversión está produciendo, así
    // que hay que lanzar `execute()` ANTES de esperarlo: al revés se bloquean
    // mutuamente. Mientras tanto los primeros chunks quedan retenidos en
    // `lane.pending`, que es justo para lo que está.
    const executing = conversion.execute();
    executing.catch(() => undefined);
    const mimeType = await output.getMimeType();
    await openLane(
      lane,
      useSeparateAudioLane ? mimeType : fixAacProfile(mimeType, lane.pending)
    );
    await executing;
  };

  const runAudioLane = async (trackIndex: number, trimStart: number) => {
    const lane = lanes.audio;
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: "fragmented" }),
      target: new StreamTarget(writableFor(lane)),
    });
    const conversion = await Conversion.init({
      input: makeInput(),
      output,
      video: { discard: true },
      // `n` es 1-based por tipo. Solo sobrevive la pista elegida: el mime del
      // SourceBuffer únicamente puede declarar un `mp4a`.
      audio: (_track, n) =>
        n === trackIndex + 1 ? aacOutputConfig : { discard: true },
      ...(trimStart > 0 ? { trim: { start: trimStart } } : {}),
    });
    if (!conversion.isValid) {
      throw new Error(
        `No se pudo procesar el audio (${describeDiscard(conversion)}).`
      );
    }
    audioConversionRef.current = conversion;
    if (abortedRef.current) {
      await conversion.cancel();
      return;
    }
    // Un seek más nuevo llegó mientras montábamos: abandona para que el bucle
    // reinicie en la posición correcta.
    if (hasSeek) {
      await conversion.cancel();
      return;
    }
    if (lane.ready && lane.sourceBuffer) {
      // Reanudación tras un cambio de pista: el codec de salida es el mismo
      // (AAC-LC 48 kHz estéreo), así que el SourceBuffer se reutiliza tal cual.
      // mediabunny rebasa la salida recortada a 0, y `timestampOffset` la
      // devuelve a la línea de tiempo global del <video>. Se fija ANTES de
      // arrancar la conversión: en cuanto empiece, sus writes ya se appendean.
      lane.sourceBuffer.timestampOffset = trimStart;
      await conversion.execute();
      return;
    }
    // Ver el comentario de `runVideoLane`: el mime no llega hasta que la
    // conversión produce, así que primero se arranca y luego se espera.
    const executing = conversion.execute();
    executing.catch(() => undefined);
    const mimeType = await output.getMimeType();
    await openLane(lane, fixAacProfile(mimeType, lane.pending));
    await executing;
  };

  // Un fallo del carril de audio no debe llegar a `unhandledrejection` mientras
  // nadie lo espera (entre un cambio de pista y el siguiente `await`), pero
  // tampoco puede desaparecer en silencio: sin esto, "se ve pero no se oye" no
  // deja ni un rastro en la consola.
  const watchAudioLane = (promise: Promise<void>) => {
    promise.catch((error: unknown) => {
      // Sin esto el vídeo se quedaría esperando en la barrera a un carril de
      // audio que ya no va a llegar: mejor ver la película muda que nada.
      releaseLaneBarrier();
      // Cambiar de idioma cancela la conversión en curso a propósito; ese
      // rechazo es el final normal del carril anterior, no una avería.
      const canceled =
        error instanceof Error && /canceled/i.test(error.name + error.message);
      if (!(abortedRef.current || canceled)) {
        console.warn("[mediabunny] el carril de audio falló:", error);
      }
    });
    return promise;
  };
  // Lo asigna el bucle de reproducción al arrancar cada carril de audio; un
  // cambio de pista lo reemplaza con el nuevo run.
  let audioLanePromise: Promise<void> = Promise.resolve();

  /** Serializa los cambios de pista: dos clics seguidos no pueden solaparse. */
  let audioSwitchChain: Promise<void> = Promise.resolve();
  const switchAudioTrack = (index: number) => {
    if (
      !useSeparateAudioLane ||
      index === activeAudioIndex ||
      index < 0 ||
      index >= audioTracks.length ||
      abortedRef.current
    ) {
      return;
    }
    activeAudioIndex = index;
    audioSwitchChain = audioSwitchChain
      .then(async () => {
        const lane = lanes.audio;
        const video = findStreamVideoEl();
        const resumeSec = video && Number.isFinite(video.currentTime)
          ? Math.max(0, video.currentTime)
          : 0;
        await audioConversionRef.current?.cancel().catch(() => undefined);
        await audioLanePromise.catch(() => undefined);
        if (abortedRef.current || mediaSource.readyState !== "open") {
          return;
        }
        // Vaciar el audio ya buffereado: lo que queda es del idioma anterior.
        const sb = lane.sourceBuffer;
        if (sb) {
          lane.chain = lane.chain
            .then(async () => {
              if (mediaSource.readyState !== "open") {
                return;
              }
              sb.remove(0, mediaSource.duration || Number.MAX_SAFE_INTEGER);
              await waitForUpdateEnd(sb);
            })
            .catch(() => undefined);
          await lane.chain;
        }
        audioLanePromise = watchAudioLane(runAudioLane(index, resumeSec));
      })
      .catch((error: unknown) => {
        failProgressivePlayback(error);
      });
  };
  opts.onAudioSwitcher(
    !live && useSeparateAudioLane ? switchAudioTrack : null,
  );

  // --- Seek (reinicio de la transcodificación en un offset) ---
  // La conversión es secuencial: saltar más allá de lo ya transcodificado deja
  // al <video> esperando para siempre porque ese contenido todavía no existe.
  // `requestSeek` marca el destino y cancela las conversiones en curso; el bucle
  // de reproducción de abajo relanza ambos carriles desde esa posición. Un scrub
  // rápido solo actualiza el destino: el bucle converge a la última posición.
  const requestSeek = (sec: number) => {
    if (abortedRef.current || !Number.isFinite(sec) || sec < 0) {
      return;
    }
    seekTarget = sec;
    hasSeek = true;
    void videoConversionRef.current?.cancel().catch(() => undefined);
    void audioConversionRef.current?.cancel().catch(() => undefined);
  };
  // En directo no hay seek: el <video> solo puede moverse dentro de lo ya
  // buffereado, y reiniciar la conversión desde el borde en vivo no tiene
  // sentido (el canal se ve desde la ventana de la playlist, como hls.js).
  opts.onSeekRestart(live ? null : requestSeek);

  try {
    // Bucle de reproducción: corre ambos carriles desde `startAt`. Si llega un
    // seek, las conversiones se cancelan y el bucle reinicia en la nueva
    // posición. Sin seek, el carril de vídeo corre hasta el final y el bucle
    // termina.
    let startAt = 0;
    for (;;) {
      hasSeek = false;
      if (startAt > 0) {
        // Vaciar ambos SourceBuffer: lo buffereado es anterior al destino. Se
        // encola en la cadena del carril para respetar los appends en vuelo.
        for (const lane of [lanes.video, lanes.audio]) {
          const sb = lane.sourceBuffer;
          if (sb && lane.ready && mediaSource.readyState === "open") {
            lane.chain = lane.chain
              .then(async () => {
                if (mediaSource.readyState !== "open") {
                  return;
                }
                sb.remove(0, mediaSource.duration || Number.MAX_SAFE_INTEGER);
                await waitForUpdateEnd(sb);
              })
              .catch(() => undefined);
            await lane.chain;
          }
        }
      }
      audioLanePromise = watchAudioLane(
        useSeparateAudioLane
          ? runAudioLane(activeAudioIndex, startAt)
          : Promise.resolve()
      );
      try {
        await runVideoLane(startAt);
        // El audio puede seguir con un cambio de pista en curso.
        await audioSwitchChain;
        await audioLanePromise;
      } catch (error) {
        // Un seek cancela las conversiones a propósito: no es una avería, hay
        // que reiniciar en la nueva posición. Cualquier otro fallo es real.
        const canceled =
          error instanceof Error && /cancel/i.test(error.name + error.message);
        if (!abortedRef.current && hasSeek && canceled) {
          startAt = seekTarget;
          continue;
        }
        if (progressiveError) {
          throw progressiveError;
        }
        throw error;
      }
      // El carril de vídeo llegó al final. Si entró un seek justo al terminar,
      // reiniciar; si no, la reproducción está completa.
      if (!abortedRef.current && hasSeek) {
        startAt = seekTarget;
        continue;
      }
      break;
    }
  } finally {
    opts.onAudioSwitcher(null);
    opts.onSeekRestart(null);
  }
  if (progressiveError) {
    throw progressiveError;
  }

  // Cierra el stream para que el <video> obtenga duración/fin definitivos. Un
  // directo no termina: cerrarlo cortaría el canal.
  if (!(live || abortedRef.current) && mediaSource.readyState === "open") {
    try {
      mediaSource.endOfStream();
    } catch {
      /* ya cerrado */
    }
  }
}

/** Handle para cortar una reproducción en directo montada con MediaBunny. */
export interface LivePlaybackHandle {
  cancel: () => void;
}

/**
 * Reproduce un canal HLS en directo con el pipeline de MediaBunny (MSE) en vez
 * de hls.js. Es el camino que hace audible un canal cuyo audio el navegador no
 * puede decodificar (AC-3/E-AC-3/DTS/TrueHD): MediaBunny decodifica el audio,
 * lo re-encodea a AAC y muxea vídeo+audio en un SourceBuffer, así el `<video>`
 * sincroniza A/V por su cuenta (sin relojes paralelos que cuadrar).
 *
 * No se espera a que termine: un directo nunca termina. Devuelve un handle
 * para cancelar la conversión al desmontar o al cambiar de canal.
 */
export function startLivePlayback(opts: {
  url: string;
  onStart: (src: string) => void;
  onError: (error: Error) => void;
}): LivePlaybackHandle {
  const abortedRef = { current: false };
  const conversionRef: { current: CancellableConversion | null } = {
    current: null,
  };
  const cleanupRef: { current: (() => void) | null } = { current: null };

  if (typeof MediaSource === "undefined") {
    opts.onError(new Error("MediaSource no soportado"));
    return { cancel: () => undefined };
  }

  void runProgressivePlayback({
    source: opts.url,
    live: true,
    audioTrackIndex: 0,
    onProgress: () => undefined,
    onStreamStart: (src) => {
      if (!abortedRef.current) {
        opts.onStart(src);
      }
    },
    onAudioTracks: () => undefined,
    onAudioSwitcher: () => undefined,
    onSeekRestart: () => undefined,
    conversionRef,
    abortedRef,
    cleanupRef,
  })
    .then(() => undefined)
    .catch((error: unknown) => {
      // Cancelar a propósito también rechaza; eso no es un fallo del canal.
      if (abortedRef.current) {
        return;
      }
      opts.onError(
        error instanceof Error ? error : new Error(String(error)),
      );
    });

  return {
    cancel: () => {
      abortedRef.current = true;
      try {
        cleanupRef.current?.();
      } catch {
        /* noop */
      }
      void conversionRef.current?.cancel().catch(() => undefined);
    },
  };
}

/** Resultado de una descarga, para que la UI distinga cancelar de fallar. */
export type DownloadOutcome = "done" | "canceled";

/**
 * Guarda una peli/serie para verla offline. Para fuentes incompatibles
 * (MKV/HEVC/AC-3…) transcodifica a un MP4 compatible y lo escribe DIRECTO en
 * OPFS, reutilizando el mismo pipeline de mediabunny que la reproducción. Para
 * fuentes ya nativas copia el archivo original a OPFS.
 *
 * El archivo queda en el almacenamiento privado del navegador: no se abre un
 * selector de archivos ni se crea una descarga visible para el usuario.
 *
 * Cancelación: el caller pone `abortedRef.current = true` y, si hay conversión en
 * curso, llama `conversionRef.current?.cancel()` — igual que el hook al desmontar.
 */
interface DownloadMediaFileOptions {
  url: string;
  filename: string;
  storageKey: string;
  codecHint?: string;
  /**
   * Índice 0-based de la pista de audio seleccionada en el player. Cuando la
   * fuente necesita transcodificar, el MP4 guardado conserva SOLO esa pista
   * para que se oiga el idioma elegido al verlo sin conexión.
   */
  audioTrackIndex?: number;
  onProgress?: (progress: number) => void;
  abortedRef: { current: boolean };
  conversionRef: { current: CancellableConversion | null };
}

export async function downloadMediaFile(
  opts: DownloadMediaFileOptions
): Promise<DownloadOutcome> {
  const {
    url,
    filename,
    storageKey,
    codecHint = "",
    audioTrackIndex,
    onProgress,
    abortedRef,
    conversionRef,
  } = opts;

  // Resolver el redirect opaco de TorBox a la URL final del CDN (igual que la
  // reproducción): solo el server puede seguir esa cadena sin romper CORS.
  let resolved = url;
  if (isTorboxRedirectUrl(url)) {
    try {
      const res = await fetch("/api/stream/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        const data = (await res.json()) as { url?: string };
        if (typeof data.url === "string" && data.url) {
          resolved = data.url;
        }
      }
    } catch {
      /* resolución falló → usar la URL original */
    }
  }
  if (abortedRef.current) {
    return "canceled";
  }

  const extension = needsMediaBunny(filename, codecHint)
    ? ".mp4"
    : (filename.match(/\.[a-z0-9]+$/i)?.[0] ?? ".mp4").toLowerCase();
  const storedName = offlineFileName(storageKey, extension);
  const root = await navigator.storage.getDirectory();

  // Fuente ya reproducible de forma nativa: se copia al almacenamiento privado.
  if (!needsMediaBunny(filename, codecHint)) {
    const response = await fetch(resolved);
    if (!response.ok || !response.body) {
      throw new Error(`Could not save media: HTTP ${response.status}`);
    }
    const handle = await root.getFileHandle(storedName, { create: true });
    const writable = await handle.createWritable();
    try {
      const reader = response.body.getReader();
      const total = Number(response.headers.get("content-length")) || 0;
      let received = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        if (abortedRef.current) {
          await writable.abort();
          await root.removeEntry(storedName).catch(() => undefined);
          return "canceled";
        }
        await writable.write(chunk.value);
        received += chunk.value.byteLength;
        if (total > 0) {
          onProgress?.(Math.min(1, received / total));
        }
      }
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      await root.removeEntry(storedName).catch(() => undefined);
      throw error;
    }
    onProgress?.(1);
    writeOfflineExpiry(storageKey, Date.now() + OFFLINE_RETENTION_MS);
    return "done";
  }

  // Incompatible → transcodificar a MP4 compatible dentro de OPFS.
  const handle = await root.getFileHandle(storedName, { create: true });
  const writable = await handle.createWritable();
  try {
    const outcome = await transcodeToWritable(
      resolved,
      createOpfsWriteStream(writable),
      onProgress,
      conversionRef,
      abortedRef,
      audioTrackIndex
    );
    if (outcome === "canceled") {
      await root.removeEntry(storedName).catch(() => undefined);
    }
    if (outcome === "done") {
      writeOfflineExpiry(storageKey, Date.now() + OFFLINE_RETENTION_MS);
    }
    return outcome;
  } catch (error) {
    await writable.abort().catch(() => undefined);
    await root.removeEntry(storedName).catch(() => undefined);
    throw error;
  }
}

/**
 * Transcodes unsupported media (MKV, EAC-3, AC-3, DTS…) for browser playback.
 *
 * Intenta primero REPRODUCCIÓN PROGRESIVA (MediaSource): el <video> arranca en
 * cuanto llega el primer fragmento, mientras el resto se sigue transcodificando
 * en segundo plano. Si eso no es viable (sin MediaSource, video que re-encodea,
 * mime no soportado) o falla en cualquier punto, cae al camino histórico:
 * transcodifica el archivo completo a OPFS y recién ahí crea el blob URL. Así,
 * en el peor caso el comportamiento es idéntico al anterior — nunca peor.
 *
 * Reads the input with a random-access MediaBunny source — `BlobSource` for a
 * local `File`, `UrlSource` (HTTP Range) for a remote URL — so backward seeks
 * (MP4 `moov` at the end of the file, MKV cues…) work without the "Read is
 * before the cached region" error that `ReadableStreamSource` throws on
 * forward-only streams.
 */
export function useMediaBunny(
  source: File | string | null,
  filename: string,
  codecHint = "",
  retryKey = 0
): UseMediaBunny {
  const [state, setState] = useState<MediaBunnyState>({ status: "idle" });
  const [audioTracks, setAudioTracks] = useState<MediaBunnyAudioTrack[]>([]);
  const [activeAudioTrack, setActiveAudioTrack] = useState(0);
  const blobUrlRef = useRef<string | null>(null);
  const conversionRef = useRef<CancellableConversion | null>(null);
  // URL del MediaSource durante el streaming progresivo, para reconstruir el
  // estado en cada tick de progreso sin cambiar la `src` (cambiarla recargaría
  // el <video>).
  const streamUrlRef = useRef<string | null>(null);
  const mseCleanupRef = useRef<(() => void) | null>(null);
  // Lo publica la reproducción progresiva mientras está viva; es `null` en el
  // camino OPFS, donde el archivo ya lleva todas las pistas y no hay nada que
  // conmutar desde acá.
  const audioSwitcherRef = useRef<((index: number) => void) | null>(null);
  // Lo publica la reproducción progresiva mientras está viva; es `null` fuera de
  // ese camino (OPFS/nativo), donde el <video> sabe hacer seek por su cuenta.
  const seekRef = useRef<((sec: number) => void) | null>(null);

  const selectAudioTrack = useCallback((index: number) => {
    const switcher = audioSwitcherRef.current;
    if (!switcher) {
      return;
    }
    setActiveAudioTrack(index);
    switcher(index);
  }, []);

  const seekTo = useCallback((sec: number) => {
    seekRef.current?.(sec);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `retryKey` intentionally restarts playback without being read inside the effect.
  useEffect(() => {
    if (!(source && needsMediaBunny(filename, codecHint))) {
      setState({ status: "idle" });
      return;
    }

    const abortedRef = { current: false };
    // Arranque: todavía no se sabe si reproducirá en vivo. "preparing" = sin %.
    setState({ status: "processing", progress: 0, mode: "preparing" });
    setAudioTracks([]);
    setActiveAudioTrack(0);

    const cleanup = async () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      if (mseCleanupRef.current) {
        try {
          mseCleanupRef.current();
        } catch {
          /* noop */
        }
        mseCleanupRef.current = null;
      }
      streamUrlRef.current = null;
    };

    (async () => {
      // Algunas fuentes de TorBox llegan como URLs de "resolve" (un addon debrid
      // con `/resolve/torbox/...` o el endpoint `requestdl` de la API de TorBox)
      // cuyo hop intermedio responde un 3xx SIN `Access-Control-Allow-Origin`,
      // así que `fetch()` aborta acá ("Failed to fetch") antes de llegar al CDN.
      // El server resuelve la cadena y nos devuelve la URL final del CDN, que
      // el browser sí puede leer (refleja ACAO + soporta Range). Si la
      // resolución falla, caemos a la URL original: mejor intentar (algún CDN de
      // TorBox refleja ACAO y andaría igual) que rendir con error antes de
      // probar. Solo aplica a strings; un `File` local no tiene redirect.
      let resolvedSource = source;
      if (typeof source === "string" && isTorboxRedirectUrl(source)) {
        try {
          const res = await fetch("/api/stream/resolve", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: source }),
          });
          if (res.ok) {
            const data = (await res.json()) as { url?: string };
            if (typeof data.url === "string" && data.url) {
              resolvedSource = data.url;
            }
          }
        } catch {
          /* resolution failed → fall back to the original URL */
        }
        if (abortedRef.current) {
          return;
        }
      }

      // 1) Camino preferido: reproducción progresiva mientras se transcodifica.
      try {
        await runProgressivePlayback({
          source: resolvedSource,
          onProgress: (progress) => {
            if (!abortedRef.current && streamUrlRef.current) {
              setState({
                status: "streaming",
                src: streamUrlRef.current,
                progress,
              });
            }
          },
          onStreamStart: (url) => {
            streamUrlRef.current = url;
            if (!abortedRef.current) {
              setState({ status: "streaming", src: url, progress: 0 });
            }
          },
          audioTrackIndex: 0,
          onAudioTracks: (tracks, activeIndex) => {
            if (!abortedRef.current) {
              setAudioTracks(tracks);
              setActiveAudioTrack(activeIndex);
            }
          },
          onAudioSwitcher: (switcher) => {
            audioSwitcherRef.current = switcher;
          },
          onSeekRestart: (seek) => {
            seekRef.current = seek;
          },
          conversionRef,
          abortedRef,
          cleanupRef: mseCleanupRef,
        });
        if (abortedRef.current) {
          return;
        }
        if (streamUrlRef.current) {
          setState({ status: "done", src: streamUrlRef.current });
        }
        return;
      } catch (progressiveError) {
        if (abortedRef.current) {
          return;
        }
        // Logueamos el motivo real de la caída al camino OPFS completo (codec
        // de vídeo que habría que re-encodear, mime no soportado por
        // MediaSource, fallo de red/CORS al leer la fuente…) — sin esto no hay
        // forma de saber desde la consola por qué una fuente tarda en salir.
        const message =
          progressiveError instanceof Error ? progressiveError.message : "";
        if (message === NON_PASSTHROUGH_VIDEO_ERROR) {
          console.info(
            "[mediabunny] source video codec requires full transcode; falling back"
          );
        } else {
          console.warn(
            "[mediabunny] progressive playback failed, falling back to full transcode:",
            progressiveError
          );
        }
        // Telemetría del fallback: el camino progresivo (reproducir mientras se
        // transcodifica) cayó al camino lento (transcodificar el archivo entero
        // antes de reproducir). Sin esto no hay forma de saber POR QUÉ pasa en
        // producción. Se manda solo el nombre del archivo y el hint de codec —
        // NUNCA la URL de origen, que lleva el token de TorBox. `capture` respeta
        // el opt-in del consentimiento (ver components/cookie-consent.tsx).
        posthog.capture("mediabunny_progressive_fallback", {
          reason: message,
          is_non_passthrough: message === NON_PASSTHROUGH_VIDEO_ERROR,
          filename,
          codec_hint: codecHint,
        });
        // Progressive no fue posible / falló: limpiar MSE y dejar que el caller
        // muestre el error. La reproducción no debe convertir el archivo entero
        // automáticamente ni presentarlo como una descarga.
        try {
          await conversionRef.current?.cancel();
        } catch {
          /* noop */
        }
        conversionRef.current = null;
        if (mseCleanupRef.current) {
          try {
            mseCleanupRef.current();
          } catch {
            /* noop */
          }
          mseCleanupRef.current = null;
        }
        streamUrlRef.current = null;
        audioSwitcherRef.current = null;
        seekRef.current = null;
        setAudioTracks([]);
        await cleanup();
        if (!abortedRef.current) {
          setState({
            status: "error",
            message:
              message || "No se pudo reproducir este medio en el navegador.",
          });
        }
      }
    })();

    return () => {
      abortedRef.current = true;
      // Cancel the in-flight conversion first (if it already exists) so its
      // WebCodecs decoder/encoder sessions are released before we pull the
      // OPFS file out from under it. If `conversion` hasn't been created yet,
      // the abortedRef check inside the pipeline cancels it as soon as it is.
      if (conversionRef.current) {
        void conversionRef.current.cancel().then(cleanup, cleanup);
      } else {
        cleanup();
      }
    };
  }, [source, filename, codecHint, retryKey]);

  return { ...state, audioTracks, activeAudioTrack, selectAudioTrack, seekTo };
}
