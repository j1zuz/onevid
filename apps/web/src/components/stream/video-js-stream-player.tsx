"use client";

import {
  createPlayer,
  Gesture,
  selectControls,
  useMedia,
  videoFeatures,
} from "@videojs/react";
import {
  HlsJsVideo,
  type HlsEngineConfig,
} from "@videojs/react/media/hlsjs-video";
import { Video, VideoSkin } from "@videojs/react/video";
import posthog from "posthog-js";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import "@videojs/react/video/skin.css";
import { cn } from "@workspace/ui/lib/utils";
import "./video-js-player-overrides.css";
import type { MimeType } from "@/types/stream";

type HlsJsConfig = NonNullable<HlsEngineConfig["hlsJs"]>;

/**
 * hls.js del directo. El objetivo es arrancar cerca del borde
 * (`liveSyncDurationCount`) sin acumular RAM (`backBufferLength`) y sin que la
 * latencia derive con el tiempo (`liveMaxLatencyDurationCount` +
 * `maxLiveSyncPlaybackRate`). El colchón por delante no aumenta la latencia: el
 * playhead sigue cerca del borde; solo protege de la jitter del proveedor.
 */
const LIVE_HLS_CONFIG_CONTROL: HlsJsConfig = {
  // Arranque: primera estimación baja para que el primer segmento sea ligero y
  // `maxLoadingDelay` corto para no esperar 4 s a elegir nivel.
  startLevel: -1,
  abrEwmaDefaultEstimate: 800_000,
  maxLoadingDelay: 3,
  initialLiveManifestSize: 1,
  // Régimen: 20–30 s por delante; 40 MB y 15 s de back buffer en vez del
  // default `backBufferLength: Infinity` (que acumula RAM en sesiones largas).
  maxBufferLength: 30,
  maxMaxBufferLength: 60,
  maxBufferSize: 40 * 1000 * 1000,
  backBufferLength: 15,
  liveSyncDurationCount: 3,
  liveMaxLatencyDurationCount: 6,
  maxLiveSyncPlaybackRate: 1.1,
  // Más conservador que los defaults (4 y 0.7) en redes/proveedores inestables.
  maxStarvationDelay: 3,
  abrBandWidthUpFactor: 0.65,
  enableWorker: true,
  // Los proveedores IPTV reales tardan varios segundos en el primer byte (hemos
  // medido hasta ~6 s en el manifiesto). Los timeouts del default (10 s) se
  // quedaban cortos en recargas de playlist y segmentos, y convertían una
  // lentitud normal en un error fatal. Estos valores dan margen sin dejar el
  // canal colgado para siempre: el watchdog de LiveTvPlayer sigue mandando.
  manifestLoadPolicy: {
    default: {
      maxTimeToFirstByteMs: 20000,
      maxLoadTimeMs: 30000,
      timeoutRetry: { maxNumRetry: 3, retryDelayMs: 0, maxRetryDelayMs: 0 },
      errorRetry: { maxNumRetry: 2, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
    },
  },
  playlistLoadPolicy: {
    default: {
      maxTimeToFirstByteMs: 15000,
      maxLoadTimeMs: 30000,
      timeoutRetry: { maxNumRetry: 3, retryDelayMs: 0, maxRetryDelayMs: 0 },
      errorRetry: { maxNumRetry: 3, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
    },
  },
  fragLoadPolicy: {
    default: {
      maxTimeToFirstByteMs: 12000,
      maxLoadTimeMs: 60000,
      timeoutRetry: { maxNumRetry: 4, retryDelayMs: 0, maxRetryDelayMs: 0 },
      errorRetry: { maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
    },
  },
};

/**
 * Variante A/B del directo: prioriza arranque/latencia sobre colchón. Se elige
 * una sola vez por carga (cambiarla en caliente recrearía el motor de hls.js y
 * reiniciaría el canal). Para probar en local: `?live_variant=fast-start`.
 */
const LIVE_HLS_CONFIG_FAST_START: HlsJsConfig = {
  startLevel: 0,
  abrEwmaDefaultEstimate: 600_000,
  maxLoadingDelay: 2,
  initialLiveManifestSize: 1,
  maxBufferLength: 20,
  maxMaxBufferLength: 40,
  maxBufferSize: 30 * 1000 * 1000,
  backBufferLength: 10,
  liveSyncDurationCount: 2,
  liveMaxLatencyDurationCount: 5,
  maxLiveSyncPlaybackRate: 1.1,
  maxStarvationDelay: 2,
  abrBandWidthUpFactor: 0.6,
  enableWorker: true,
  manifestLoadPolicy: LIVE_HLS_CONFIG_CONTROL.manifestLoadPolicy,
  playlistLoadPolicy: LIVE_HLS_CONFIG_CONTROL.playlistLoadPolicy,
  fragLoadPolicy: LIVE_HLS_CONFIG_CONTROL.fragLoadPolicy,
};

// Nota para el futuro: algunos proveedores IPTV sirven H.264 corrupto que el
// decoder del navegador rechaza (MEDIA_ERR_DECODE). El pipeline de MediaBunny
// en live solo transcodifica audio; el vídeo H.264 va en passthrough, así que
// no puede repararlo. No forzamos re-encode de vídeo en vivo: no es viable a
// tiempo real. La alerta muestra la causa real al usuario.

type LiveConfigVariant = "control" | "fast-start";
const LIVE_CONFIG_FLAG = "live-player-buffer";

function resolveLiveConfigVariant(): LiveConfigVariant {
  if (typeof window === "undefined") {
    return "control";
  }
  try {
    const override = new URLSearchParams(window.location.search).get(
      "live_variant"
    );
    if (override === "fast-start" || override === "b") {
      return "fast-start";
    }
    if (override === "control" || override === "a") {
      return "control";
    }
    const flag = posthog.getFeatureFlag(LIVE_CONFIG_FLAG);
    if (flag === "fast-start" || flag === "b") {
      return "fast-start";
    }
  } catch {
    /* Sin PostHog disponible: control. */
  }
  return "control";
}

const LIVE_HLS_CONFIGS: Record<LiveConfigVariant, HlsJsConfig> = {
  control: LIVE_HLS_CONFIG_CONTROL,
  "fast-start": LIVE_HLS_CONFIG_FAST_START,
};

/**
 * hls.js de VOD. Arranca con un colchón moderado y, si la reproducción aguanta
 * 10 s, la rampa de buffer de abajo lo sube a 60 s / 90 MB. `startFragPrefetch`
 * adelanta el primer fragmento sin retrasar el primer frame.
 */
const VOD_HLS_CONFIG: HlsJsConfig = {
  maxBufferLength: 30,
  maxMaxBufferLength: 60,
  maxBufferSize: 60 * 1000 * 1000,
  backBufferLength: 30,
  startFragPrefetch: true,
  capLevelToPlayerSize: true,
  abrEwmaDefaultEstimate: 1_000_000,
  maxStarvationDelay: 4,
  enableWorker: true,
};

const VOD_BUFFER_AFTER_RAMP_SEC = 60;
const VOD_BUFFER_AFTER_RAMP_BYTES = 90 * 1000 * 1000;
const VOD_BUFFER_RAMP_DELAY_MS = 10_000;

function monotonicNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

interface HlsEngineHandle {
  config: {
    maxBufferLength: number;
    maxBufferSize: number;
  };
  startLoad?: () => void;
  recoverMediaError?: () => void;
}

interface LiveHlsErrorData {
  type?: string;
  details?: string;
  fatal?: boolean;
  reason?: string;
}

const MAX_LIVE_INPLACE_RECOVERIES = 2;
const LIVE_RECOVERY_BACKOFF_MS = [400, 1200];
const LIVE_STABLE_RESET_MS = 10_000;

/**
 * hls.js entrega el detalle en `MediaError.data`, pero el `<video>` lo entrega
 * envuelto en un `ErrorEvent.error`. Aceptamos las dos formas.
 */
function liveErrorData(error: unknown): LiveHlsErrorData | undefined {
  const candidate = error as
    | {
        data?: LiveHlsErrorData;
        error?: { data?: LiveHlsErrorData };
      }
    | null
    | undefined;
  return candidate?.data ?? candidate?.error?.data;
}

/** El `Hls` de hls.js vive en `media.engine` cuando el camino es MSE. */
function getHlsEngine(media: unknown): HlsEngineHandle | null {
  const engine = (media as { engine?: unknown } | null)?.engine;
  if (!engine || typeof engine !== "object" || !("config" in engine)) {
    return null;
  }
  return engine as HlsEngineHandle;
}

function serializePlaybackError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof HTMLVideoElement !== "undefined" && error && typeof error === "object") {
    const eventLike = error as {
      target?: unknown;
      currentTarget?: unknown;
      type?: unknown;
    };
    const video =
      eventLike.target instanceof HTMLVideoElement
        ? eventLike.target
        : eventLike.currentTarget instanceof HTMLVideoElement
          ? eventLike.currentTarget
          : null;
    const mediaError = video?.error;
    if (mediaError) {
      const details = mediaError.message ? `: ${mediaError.message}` : "";
      return `Video playback error (code ${mediaError.code})${details}`;
    }
    if (typeof eventLike.type === "string") {
      return `Video playback error (${eventLike.type})`;
    }
  }
  if (!error || typeof error !== "object") {
    return String(error || "Unknown error");
  }

  const value = error as {
    message?: unknown;
    error?: unknown;
    code?: unknown;
  };
  if (typeof value.message === "string" && value.message) {
    return value.message;
  }
  if (typeof value.error === "string" && value.error) {
    return value.error;
  }
  if (typeof value.code === "number") {
    return `Media playback error (code ${value.code})`;
  }

  try {
    const seen = new WeakSet<object>();
    const serialized = JSON.stringify(error, (_key, nestedValue: unknown) => {
      if (typeof nestedValue === "object" && nestedValue !== null) {
        if (seen.has(nestedValue)) {
          return "[Circular]";
        }
        seen.add(nestedValue);
      }
      if (typeof Element !== "undefined" && nestedValue instanceof Element) {
        return `[${nestedValue.tagName.toLowerCase()} element]`;
      }
      return nestedValue;
    });
    return serialized || "Unknown playback error";
  } catch {
    return Object.prototype.toString.call(error);
  }
}

interface VideoJsStreamPlayerProps {
  autoPlay?: boolean;
  className?: string;
  controls?: boolean;
  isPlayMode?: boolean;
  /** Opt-in live controls and credential-safe error reporting; movies retain their defaults. */
  liveMode?: boolean;
  /** Rendered inside the skin so live controls are included in its fullscreen element. */
  liveControls?: ReactNode;
  mimeType?: MimeType;
  onEnded?: () => void;
  onError?: (error: Error) => void;
  onCanPlay?: () => void;
  onLoadStart?: () => void;
  onPlaying?: () => void;
  onControlsVisibility?: (visible: boolean) => void;
  /** Publica el <video> y el objeto media para los selectores de la barra. */
  onMediaRef?: (refs: { media: unknown; video: HTMLVideoElement | null }) => void;
  /**
   * Subtítulos externos (los de los addons). Se montan como `<track>`, así que
   * aparecen en `video.textTracks` y el selector de la barra los recoge solo.
   */
  subtitles?: SubtitleTrackSource[];
  onSourceInfo?: (info: { url: string; mimeType: string }) => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onWaiting?: () => void;
  playsInline?: boolean;
  poster?: string;
  preload?: "auto" | "metadata" | "none";
  src: string;
  /**
   * Metadatos no sensibles para segmentar los eventos del player
   * (`player_ttff_ms`, `live_playback_error`): por ejemplo `content_id`,
   * `content_type` o `channel_name`. Nunca incluir URLs ni tokens.
   */
  ttffProperties?: Record<string, string | number | boolean>;
}

/** Una pista de subtítulos externa, ya en WebVTT y servible con CORS propio. */
export interface SubtitleTrackSource {
  id: string;
  label: string;
  srcLang: string;
  url: string;
}

const { Player, usePlayer } = createPlayer({ features: videoFeatures });

/**
 * `useMedia()` solo existe dentro de `<Player>`, pero los selectores de pista
 * viven en la barra superior, fuera. Este componente no pinta nada: solo saca
 * el objeto media al exterior, que es lo que `useMediaTracks` necesita para
 * hablar con hls.js.
 */
function MediaBridge({ onMedia }: { onMedia: (media: unknown) => void }) {
  const media = useMedia();
  useEffect(() => {
    onMedia(media);
  }, [media, onMedia]);
  return null;
}

function PlayerControlsBridge({
  onVisibilityChange,
}: {
  onVisibilityChange?: (visible: boolean) => void;
}) {
  const controls = usePlayer(selectControls);
  useEffect(() => {
    onVisibilityChange?.(controls?.controlsVisible ?? false);
  }, [controls?.controlsVisible, onVisibilityChange]);
  return null;
}

function LivePlaybackErrorBridge({
  onError,
}: {
  onError: (error: unknown) => void;
}) {
  const error = usePlayer((state) => state.error);
  useEffect(() => {
    if (error) onError(error);
  }, [error, onError]);
  return null;
}

export function VideoJsStreamPlayer({
  onMediaRef,
  subtitles,
  src,
  mimeType = "video/mp4",
  poster,
  className,
  autoPlay = false,
  controls = false,
  playsInline = true,
  preload = "metadata",
  isPlayMode = false,
  liveMode = false,
  liveControls,
  onEnded,
  onError,
  onSourceInfo,
  onControlsVisibility,
  onCanPlay,
  onLoadStart,
  onWaiting,
  onPlaying,
  onTimeUpdate,
  ttffProperties,
}: VideoJsStreamPlayerProps) {
  // Estado y no ref: al montar el <video> hay que re-renderizar para publicarlo
  // vía `onMediaRef`.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  // Objeto media del skin, que `MediaBridge` saca del contexto de `<Player>`.
  const [media, setMedia] = useState<unknown>(null);
  const handleMedia = useCallback((next: unknown) => setMedia(next), []);
  // TTFF: se mide desde que la fuente queda montada hasta el primer `playing`.
  // Los eventos posteriores (seek, recuperación de un corte) no lo reenvían.
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const ttffReportedRef = useRef(false);
  // Recuperación en caliente del directo: si hls.js emite un fatal, probamos
  // `recoverMediaError`/`startLoad` antes de rendirnos y mostrar la alerta.
  const liveRecoveryAttemptsRef = useRef(0);
  const liveRecoveryTimerRef = useRef<number | null>(null);
  const liveStableTimerRef = useRef<number | null>(null);
  // Evita duplicar el evento: el mismo fatal llega por el <video> y por el
  // bridge de estado del player.
  const lastLiveErrorRef = useRef<{ details: string; at: number } | null>(null);
  // HLS (streams en vivo o .m3u8 bajo demanda) necesita hls.js para MSE: un
  // <video> nativo solo lo reproduce en Safari. HlsJsVideo decide internamente
  // MSE vs. nativo según soporte del navegador.
  const isHls = mimeType === "application/x-mpegURL";
  // Se resuelve al montar el <video> (no al cargar el chunk): para entonces los
  // flags de PostHog ya suelen estar disponibles. Cambiarla en caliente
  // recrearía hls.js y reiniciaría el canal, así que es estable por sesión.
  const [liveConfigVariant] = useState<LiveConfigVariant>(() =>
    resolveLiveConfigVariant()
  );
  const liveHlsConfig = LIVE_HLS_CONFIGS[liveConfigVariant];

  const rootClassName = cn(
    "stream-video-player-root relative w-full overflow-hidden rounded-lg",
    isPlayMode && "play-mode",
    liveMode && "live-mode",
    className
  );

  useEffect(() => {
    onMediaRef?.({ media, video: videoEl });
  }, [media, videoEl, onMediaRef]);

  // Cada fuente nueva reinicia la medición y la rampa de buffer.
  useEffect(() => {
    startedAtRef.current = monotonicNow();
    ttffReportedRef.current = false;
    liveRecoveryAttemptsRef.current = 0;
    lastLiveErrorRef.current = null;
    if (liveRecoveryTimerRef.current !== null) {
      window.clearTimeout(liveRecoveryTimerRef.current);
      liveRecoveryTimerRef.current = null;
    }
    if (liveStableTimerRef.current !== null) {
      window.clearTimeout(liveStableTimerRef.current);
      liveStableTimerRef.current = null;
    }
    setHasStartedPlaying(false);
  }, [src]);

  // Los timers de recuperación no deben sobrevivir al desmontaje.
  useEffect(
    () => () => {
      if (liveRecoveryTimerRef.current !== null) {
        window.clearTimeout(liveRecoveryTimerRef.current);
      }
      if (liveStableTimerRef.current !== null) {
        window.clearTimeout(liveStableTimerRef.current);
      }
    },
    []
  );

  // `default` a propósito en ninguno: el <track> arranca desactivado y es el
  // selector el que pone `mode = "showing"` cuando el usuario elige idioma.
  const subtitleTracks = subtitles?.map((track) => (
    <track
      key={track.id}
      kind="subtitles"
      label={track.label}
      src={track.url}
      srcLang={track.srcLang}
    />
  ));
  // Report source info on mount
  useEffect(() => {
    if (onSourceInfo) {
      onSourceInfo({ url: src, mimeType });
    }
  }, [src, mimeType, onSourceInfo]);

  const tryRecoverLivePlayback = useCallback(
    (error: unknown): boolean => {
      const data = liveErrorData(error);
      if (!data) {
        return false;
      }
      // `fatal: false` significa que hls.js ya se está recuperando solo; no
      // mostramos la alerta ni pisamos su recuperación.
      if (data.fatal === false) {
        return true;
      }
      if (liveRecoveryTimerRef.current !== null) {
        return true;
      }
      if (liveRecoveryAttemptsRef.current >= MAX_LIVE_INPLACE_RECOVERIES) {
        return false;
      }
      const engine = getHlsEngine(media);
      if (!engine) {
        return false;
      }
      const attempt = liveRecoveryAttemptsRef.current;
      liveRecoveryAttemptsRef.current += 1;
      const delay = LIVE_RECOVERY_BACKOFF_MS[attempt] ?? 1200;
      liveRecoveryTimerRef.current = window.setTimeout(() => {
        liveRecoveryTimerRef.current = null;
        if (data.type === "mediaError") {
          engine.recoverMediaError?.();
        } else {
          engine.startLoad?.();
        }
      }, delay);
      return true;
    },
    [media]
  );

  const handleError = useCallback(
    (error: unknown) => {
      if (liveMode) {
        const candidate = error as {
          data?: LiveHlsErrorData;
          error?: {
            code?: unknown;
            data?: LiveHlsErrorData;
          };
          target?: unknown;
        };
        const data = candidate.data ?? candidate.error?.data;
        const mediaErrorCode =
          (candidate.error?.code as number | undefined) ??
          (typeof HTMLVideoElement !== "undefined" &&
          candidate.target instanceof HTMLVideoElement
            ? candidate.target.error?.code
            : undefined) ??
          null;
        // `MEDIA_ERR_DECODE` (3) sin detalle de hls.js también es un problema de
        // códec: el navegador no pudo decodificar el vídeo de ese segmento.
        const details =
          data?.details ??
          (mediaErrorCode === 3 ? "mediaDecodeError" : "unknown");
        const now = Date.now();
        const recovering = tryRecoverLivePlayback(error);
        const shouldReport =
          !lastLiveErrorRef.current ||
          lastLiveErrorRef.current.details !== details ||
          now - lastLiveErrorRef.current.at > 1500;
        if (shouldReport) {
          lastLiveErrorRef.current = { details, at: now };
          try {
            posthog.capture("live_playback_error", {
              details,
              hls_type: data?.type ?? null,
              fatal: data?.fatal ?? null,
              media_error_code: mediaErrorCode,
              recovery_attempt: liveRecoveryAttemptsRef.current,
              recovered: recovering,
              config_variant: liveConfigVariant,
              ...(ttffProperties ?? {}),
            });
          } catch {
            // La analítica nunca debe romper la reproducción.
          }
        }
        if (recovering) {
          return;
        }
        const failure = new Error(
          "No se pudo reproducir este canal de Live TV."
        ) as Error & { details?: string };
        failure.details = details;
        onError?.(failure);
        return;
      }
      const message = serializePlaybackError(error);
      const err = error instanceof Error ? error : new Error(message);
      onError?.(err);
    },
    [liveConfigVariant, liveMode, onError, tryRecoverLivePlayback, ttffProperties]
  );

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const el = e.target as HTMLVideoElement;
    onTimeUpdate?.(
      el.currentTime,
      Number.isFinite(el.duration) ? el.duration : 0
    );
  };

  const handlePlaying = useCallback(() => {
    const startedAt = startedAtRef.current;
    if (!ttffReportedRef.current && startedAt !== null) {
      ttffReportedRef.current = true;
      try {
        posthog.capture("player_ttff_ms", {
          ttff_ms: Math.max(0, Math.round(monotonicNow() - startedAt)),
          mode: liveMode ? "live" : "vod",
          engine: isHls ? "hls" : "native",
          mime_type: mimeType,
          autoplay: autoPlay,
          preload,
          ...(liveMode ? { config_variant: liveConfigVariant } : {}),
          ...(ttffProperties ?? {}),
        });
      } catch {
        // La analítica nunca debe romper la reproducción.
      }
    }
    setHasStartedPlaying(true);
    if (liveMode) {
      // Tras 10 s de reproducción estable, perdonamos los intentos de
      // recuperación anteriores: un corte puntual no debe agotar el presupuesto
      // para un corte que ocurra una hora después.
      if (liveStableTimerRef.current !== null) {
        window.clearTimeout(liveStableTimerRef.current);
      }
      liveStableTimerRef.current = window.setTimeout(() => {
        liveRecoveryAttemptsRef.current = 0;
        liveStableTimerRef.current = null;
      }, LIVE_STABLE_RESET_MS);
    }
    onPlaying?.();
  }, [isHls, liveConfigVariant, liveMode, mimeType, onPlaying, ttffProperties, autoPlay, preload]);

  // En VOD HLS, una vez que la reproducción se sostiene 10 s, subimos el
  // colchón. Hacerlo en el segundo 0 solo descarga de más antes de saber si la
  // red aguanta. En Live no se toca: 30 s por delante ya es suficiente.
  useEffect(() => {
    if (!hasStartedPlaying || liveMode || !isHls) {
      return;
    }
    const engine = getHlsEngine(media);
    if (!engine) {
      return;
    }
    const timer = window.setTimeout(() => {
      engine.config.maxBufferLength = VOD_BUFFER_AFTER_RAMP_SEC;
      engine.config.maxBufferSize = VOD_BUFFER_AFTER_RAMP_BYTES;
    }, VOD_BUFFER_RAMP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [hasStartedPlaying, isHls, liveMode, media]);

  const hlsVideoProps = {
    autoPlay,
    controls,
    onEnded,
    onError: handleError,
    onCanPlay,
    onLoadStart,
    onPlaying: handlePlaying,
    onTimeUpdate: handleTimeUpdate,
    onWaiting,
    playsInline,
    poster,
    preload,
    ref: setVideoEl,
    source: {
      src,
      type: "application/vnd.apple.mpegurl",
      // Config separada: el directo prioriza latencia estable y RAM acotada; el
      // VOD arranca con 30 s y la rampa lo sube a 60 s si la red aguanta.
      engine: {
        hlsJs: liveMode ? liveHlsConfig : VOD_HLS_CONFIG,
      },
    },
    ...(liveMode
      ? {
          crossOrigin: "anonymous",
          fallback: "Tu navegador no admite la reproducción de este canal.",
        }
      : {}),
  } as ComponentProps<typeof HlsJsVideo>;

  return (
    <div
      className={rootClassName}
      onKeyDownCapture={
        liveMode
          ? (event) => {
              // Keep live playback at normal speed even though VideoSkin registers VOD hotkeys.
              if (event.key === ">" || event.key === "<") {
                event.preventDefault();
                event.stopPropagation();
              }
            }
          : undefined
      }
    >
      <Player>
        <VideoSkin>
          {liveMode ? <LivePlaybackErrorBridge onError={handleError} /> : null}
          {liveMode ? liveControls : null}
          {isHls ? (
            <HlsJsVideo {...hlsVideoProps}>
              {subtitleTracks}
            </HlsJsVideo>
          ) : (
            <Video
              autoPlay={autoPlay}
              controls={controls}
              onEnded={onEnded}
              onError={handleError}
              onCanPlay={onCanPlay}
              onLoadStart={onLoadStart}
              onPlaying={handlePlaying}
              onTimeUpdate={handleTimeUpdate}
              onWaiting={onWaiting}
              playsInline={playsInline}
              poster={poster}
              preload={preload}
              ref={setVideoEl}
              src={src}
              {...({ type: mimeType } as React.ComponentProps<typeof Video>)}
            >
              {subtitleTracks}
            </Video>
          )}
          {/* Los selectores de audio y subtítulos se pintan en la barra
              superior, junto al de medios; acá solo se saca lo que necesitan. */}
          <MediaBridge onMedia={handleMedia} />
          <PlayerControlsBridge onVisibilityChange={onControlsVisibility} />
          <Gesture type="tap" action="togglePaused" pointer="touch" region="center" />
        </VideoSkin>
      </Player>
    </div>
  );
}

export default VideoJsStreamPlayer;
