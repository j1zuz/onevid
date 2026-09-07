"use client";

import { useEffect, useRef, useState } from "react";
import { isTorboxRedirectUrl, needsMediaBunny } from "@/utils/stream-codec";

export type MediaBunnyState =
  | { status: "idle" }
  | { status: "processing"; progress: number }
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
const PASSTHROUGH_VIDEO_CODECS = new Set(["avc", "vp9", "av1"]);
const PASSTHROUGH_AUDIO_CODECS = new Set(["aac", "mp3", "opus"]);

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
const BUFFER_AHEAD_HIGH_SEC = 30;
// Cuánto video ya reproducido conservamos DETRÁS del playhead al evictar para
// liberar memoria del SourceBuffer (permite un pequeño seek hacia atrás).
const BUFFER_BEHIND_KEEP_SEC = 10;
// Tope de reintentos de append tras QuotaExceededError antes de rendirse (y
// caer al camino OPFS completo). Con la contrapresión activa casi nunca se
// llega a la cuota; esto es solo la red de seguridad.
const MAX_QUOTA_RETRIES = 8;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

/** Minimal shape used to cancel an in-flight conversion from the caller. */
interface CancellableConversion {
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
      reject(
        new Error(
          `SourceBuffer error (${sb.buffered.length} buffered ranges, updating=${sb.updating})`
        )
      );
    };
    sb.addEventListener("updateend", onDone, { once: true });
    sb.addEventListener("error", onFail, { once: true });
  });
}

/** Segundos ya buffereados por delante de `t` (0 si `t` cae fuera de todo rango). */
function bufferedAheadOf(sb: SourceBuffer, t: number): number {
  const ranges = sb.buffered;
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
      canEncodeAudio,
    },
    { registerAc3Decoder },
    { registerDtsDecoder },
    { registerAacEncoder },
  ] = await Promise.all([
    import("mediabunny"),
    import("@mediabunny/ac3"),
    import("@mediabunny/dts"),
    import("@mediabunny/aac-encoder"),
  ]);

  registerAc3Decoder();
  registerDtsDecoder();
  // Solo usamos el polyfill si el navegador no puede encodear AAC nativo
  // (algunos, como Firefox, no lo soportan en WebCodecs).
  if (!(await canEncodeAudio("aac"))) {
    registerAacEncoder();
  }

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
 * Reproducción progresiva: transcodifica a MP4 fragmentado y va alimentando
 * los fragmentos a un `MediaSource` a medida que se generan, así el <video>
 * empieza a reproducir casi de inmediato en vez de esperar el archivo entero.
 * Todo ocurre en el navegador (WASM) — sin proxy ni servidor intermedio.
 *
 * Requisitos (si no se cumplen, se LANZA para que el caller caiga al camino
 * OPFS completo): navegador con MediaSource, video que pasa sin re-encodear
 * (avc/vp9/av1 — su codec string es conocido de antemano) y un mime que
 * `MediaSource.isTypeSupported` acepte. El video HEVC (que sí re-encodea) usa
 * el camino OPFS, porque el `avc1.*` de salida no se conoce hasta muxear.
 *
 * Contrapresión: mediabunny hace `await` de cada `write()` del StreamTarget
 * (el camino OPFS ya depende de eso), así que basta con no resolver el write
 * mientras haya suficiente buffer por delante para pausar la conversión y no
 * acumular toda la película en memoria. Evicción: se borra lo ya reproducido
 * ante un QuotaExceededError.
 *
 * Limitación conocida: el seek HACIA ADELANTE más allá de lo ya transcodificado
 * se queda esperando (la conversión es secuencial); el seek hacia atrás dentro
 * de la ventana retenida es inmediato.
 */
async function runProgressivePlayback(opts: {
  source: File | string;
  onProgress: (progress: number) => void;
  onStreamStart: (src: string) => void;
  conversionRef: { current: CancellableConversion | null };
  abortedRef: { current: boolean };
  cleanupRef: { current: (() => void) | null };
}): Promise<void> {
  const { source, onProgress, onStreamStart, conversionRef, abortedRef } = opts;

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
      canEncodeAudio,
    },
    { registerAc3Decoder },
    { registerDtsDecoder },
    { registerAacEncoder },
  ] = await Promise.all([
    import("mediabunny"),
    import("@mediabunny/ac3"),
    import("@mediabunny/dts"),
    import("@mediabunny/aac-encoder"),
  ]);

  registerAc3Decoder();
  registerDtsDecoder();
  // Solo usamos el polyfill si el navegador no puede encodear AAC nativo
  // (algunos, como Firefox, no lo soportan en WebCodecs).
  if (!(await canEncodeAudio("aac"))) {
    registerAacEncoder();
  }

  const inputSource =
    typeof source === "string"
      ? new UrlSource(source, urlSourceOptions(source, abortedRef))
      : new BlobSource(source);
  const input = new Input({ source: inputSource, formats: ALL_FORMATS });

  // Probamos las pistas para armar el mime de MSE ANTES de crear el
  // SourceBuffer (que lo exige por adelantado). Los códecs compatibles pasan
  // sin re-encodear; los demás se convierten a AVC dentro del mismo stream.
  const videoTrack = await input.getPrimaryVideoTrack();
  const videoCodec = videoTrack ? await videoTrack.getCodec() : null;
  if (!videoTrack) {
    throw new Error("La fuente no contiene una pista de video");
  }
  const canPassthroughVideo = Boolean(
    videoCodec && PASSTHROUGH_VIDEO_CODECS.has(videoCodec)
  );
  // Mediabunny emite AVC en el mismo Output cuando el códec de entrada no se
  // puede pasar directamente. Este codec string permite crear el SourceBuffer
  // antes de que llegue el primer fragmento codificado.
  const videoCodecString = canPassthroughVideo
    ? await videoTrack.getCodecParameterString()
    : "avc1.4d401f";
  if (!videoCodecString) {
    throw new Error("Unknown video codec string");
  }

  const audioTrack = await input.getPrimaryAudioTrack();
  let audioCodecString: string | null = null;
  let canPassThroughAudio = Boolean(
    audioTrack && (await audioTrack.getCodec()) === "aac"
  );
  if (audioTrack) {
    // MSE requires the codec string in the SourceBuffer to match the actual
    // initialization segment. Only pass through AAC when its exact string is
    // available; incompatible audio is discarded for the progressive video
    // path and remains available through the complete transcode fallback.
    if (canPassThroughAudio) {
      audioCodecString = await audioTrack.getCodecParameterString();
      canPassThroughAudio = Boolean(audioCodecString);
    }
  }

  const codecList = audioCodecString
    ? `${videoCodecString}, ${audioCodecString}`
    : videoCodecString;
  const mimeType = `video/mp4; codecs="${codecList}"`;
  if (!MediaSource.isTypeSupported(mimeType)) {
    throw new Error(`Unsupported MSE mime: ${mimeType}`);
  }

  const mediaSource = new MediaSource();
  const objectUrl = URL.createObjectURL(mediaSource);
  let sourceBuffer: SourceBuffer | null = null;
  let objectUrlRevoked = false;

  opts.cleanupRef.current = () => {
    if (!objectUrlRevoked) {
      objectUrlRevoked = true;
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        /* already revoked */
      }
    }
  };

  // El SourceBuffer solo puede crearse una vez que el <video> adjunta el
  // MediaSource (evento `sourceopen`), que a su vez requiere que ya le hayamos
  // pasado la `src` al player — de ahí que `onStreamStart` vaya antes. Timeout
  // defensivo: si `sourceopen` nunca dispara, rechazamos para caer al camino
  // OPFS en vez de colgarnos.
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("MediaSource sourceopen timed out")),
      15_000
    );
    const settleResolve = () => {
      clearTimeout(timer);
      resolve();
    };
    const settleReject = (error: unknown) => {
      clearTimeout(timer);
      reject(error as Error);
    };
    mediaSource.addEventListener(
      "sourceopen",
      async () => {
        try {
          sourceBuffer = mediaSource.addSourceBuffer(mimeType);
        } catch (error) {
          settleReject(error);
          return;
        }
        // Fijar la duración desde los metadatos (rápido, ya leídos) evita que
        // el scrubber quede sin longitud y que el guardado de progreso reciba
        // `duration: 0` hasta que `endOfStream` la resuelva al final.
        try {
          const durationSec = await input.getDurationFromMetadata();
          if (durationSec && Number.isFinite(durationSec) && durationSec > 0) {
            mediaSource.duration = durationSec;
          }
        } catch {
          /* duración desconocida: el <video> la resuelve al endOfStream */
        }
        settleResolve();
      },
      { once: true }
    );
  });

  // Publica la fuente reproducible AHORA: el player monta el <video>, que
  // dispara `sourceopen` y resuelve `ready`. El primer `write()` de mediabunny
  // espera a `ready`, así que no hay carrera aunque llegue antes de montarse.
  onStreamStart(objectUrl);

  const evictBehindPlayhead = async (sb: SourceBuffer) => {
    const ranges = sb.buffered;
    if (ranges.length === 0) {
      return;
    }
    const video = findStreamVideoEl();
    const start = ranges.start(0);
    const leadingEdge = ranges.end(ranges.length - 1);
    // Sin elemento aún (raro bajo cuota tan temprano) usamos el borde de cabeza,
    // que conserva solo la ventana más reciente.
    const playhead = video ? video.currentTime : leadingEdge;
    const removeEnd = Math.max(start, playhead - BUFFER_BEHIND_KEEP_SEC);
    if (removeEnd > start && !sb.updating) {
      sb.remove(start, removeEnd);
      await waitForUpdateEnd(sb);
    } else {
      // No hay nada que liberar por detrás del playhead: dale un respiro a la
      // reproducción para que avance antes de reintentar.
      await sleep(300);
    }
  };

  const appendInOrder = async (data: Uint8Array) => {
    await ready;
    const sb = sourceBuffer;
    if (!sb) {
      throw new Error("SourceBuffer no disponible");
    }
    for (let attempt = 0; ; attempt++) {
      if (abortedRef.current) {
        return;
      }
      try {
        // `as unknown as BufferSource`: `chunk.data` es un Uint8Array (válido
        // como BufferSource), pero el genérico Uint8Array<ArrayBufferLike> de
        // TS 5.7+ no es directamente asignable — mismo motivo por el que
        // createOpfsWriteStream castea al escribir a OPFS.
        sb.appendBuffer(data as unknown as BufferSource);
        await waitForUpdateEnd(sb);
        return;
      } catch (error) {
        const name = (error as DOMException | null)?.name;
        if (name === "QuotaExceededError" && attempt < MAX_QUOTA_RETRIES) {
          await evictBehindPlayhead(sb);
          continue;
        }
        throw error;
      }
    }
  };

  const applyBackpressure = async (sb: SourceBuffer) => {
    const video = findStreamVideoEl();
    if (!video) {
      return;
    }
    while (!abortedRef.current) {
      if (bufferedAheadOf(sb, video.currentTime) < BUFFER_AHEAD_HIGH_SEC) {
        return;
      }
      await sleep(200);
    }
  };

  let progressiveError: Error | null = null;
  const writable = new WritableStream({
    async write(chunk: { data: Uint8Array; position: number }) {
      if (abortedRef.current) {
        return;
      }
      try {
        await appendInOrder(chunk.data);
        if (sourceBuffer) {
          await applyBackpressure(sourceBuffer);
        }
      } catch (error) {
        // Do not reject the WritableStream after MSE fails. StreamTarget can
        // still call close() during cancellation, and closing an errored
        // writer causes the secondary "Cannot close a ERRORED writable
        // stream" error. Keep the stream writable, cancel the conversion, and
        // surface the original SourceBuffer error after execute() unwinds.
        progressiveError =
          error instanceof Error ? error : new Error(String(error));
        void conversionRef.current?.cancel().catch(() => undefined);
      }
    },
  });

  const conversion = await Conversion.init({
    input,
    output: new Output({
      // `fastStart: "fragmented"` = MP4 escrito append-only (init al frente,
      // luego moof+mdat en orden), que es justo lo que MSE necesita para ir
      // agregando al SourceBuffer sin re-escribir cabeceras.
      format: new Mp4OutputFormat({ fastStart: "fragmented" }),
      target: new StreamTarget(writable),
    }),
    video: async (track) => {
      const codec = await track.getCodec();
      return codec && PASSTHROUGH_VIDEO_CODECS.has(codec) ? {} : { codec: "avc" };
    },
    audio: canPassThroughAudio ? {} : { discard: true },
  });

  if (!conversion.isValid) {
    const reason = conversion.discardedTracks[0]?.reason ?? "unknown";
    throw new Error(`No se pudo procesar el video (${reason}).`);
  }

  conversionRef.current = conversion;
  if (abortedRef.current) {
    await conversion.cancel();
    return;
  }
  conversion.onProgress = onProgress;
  try {
    await conversion.execute();
  } catch (error) {
    if (progressiveError) {
      throw progressiveError;
    }
    throw error;
  }

  // Cierra el stream para que el <video> obtenga duración/fin definitivos.
  if (!abortedRef.current && mediaSource.readyState === "open") {
    try {
      mediaSource.endOfStream();
    } catch {
      /* ya cerrado */
    }
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
  filename: string
): MediaBunnyState {
  const [state, setState] = useState<MediaBunnyState>({ status: "idle" });
  const blobUrlRef = useRef<string | null>(null);
  const opfsNameRef = useRef<string | null>(null);
  const conversionRef = useRef<CancellableConversion | null>(null);
  // URL del MediaSource durante el streaming progresivo, para reconstruir el
  // estado en cada tick de progreso sin cambiar la `src` (cambiarla recargaría
  // el <video>).
  const streamUrlRef = useRef<string | null>(null);
  const mseCleanupRef = useRef<(() => void) | null>(null);

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
      if (mseCleanupRef.current) {
        try {
          mseCleanupRef.current();
        } catch {
          /* noop */
        }
        mseCleanupRef.current = null;
      }
      streamUrlRef.current = null;
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
        // Logueamos el motivo real de la caída al camino OPFS completo (video
        // HEVC, mime no soportado por MediaSource, fallo de red/CORS al leer
        // la fuente, etc.) — sin esto no había forma de diagnosticar desde la
        // consola por qué una fuente concreta tarda en mostrarse.
        const message =
          progressiveError instanceof Error ? progressiveError.message : "";
        if (message === "Progressive playback requires a passthrough video codec") {
          console.info(
            "[mediabunny] source video codec requires full transcode; falling back"
          );
        } else {
          console.warn(
            "[mediabunny] progressive playback failed, falling back to full transcode:",
            progressiveError
          );
        }
        // Progressive no fue posible / falló → limpiar MSE y caer al camino
        // OPFS completo. Cancelamos la conversión progresiva para liberar sus
        // sesiones de WebCodecs antes de arrancar la de fallback.
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
        setState({ status: "processing", progress: 0 });
      }

      // 2) Fallback: transcodifica todo a OPFS y luego reproduce el blob.
      opfsNameRef.current = opfsName;
      try {
        const file = await transcodeToMp4(
          resolvedSource,
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
      // the abortedRef check inside the pipeline cancels it as soon as it is.
      if (conversionRef.current) {
        void conversionRef.current.cancel().then(cleanup, cleanup);
      } else {
        cleanup();
      }
    };
  }, [source, filename]);

  return state;
}
