"use client";

import { createPlayer, useMedia, videoFeatures } from "@videojs/react";
import { PlayIcon } from "@videojs/react/icons";
import { HlsJsVideo } from "@videojs/react/media/hlsjs-video";
import { Video, VideoSkin } from "@videojs/react/video";
import { useCallback, useEffect, useState } from "react";
import "@videojs/react/video/skin.css";
import { cn } from "@workspace/ui/lib/utils";
import "./video-js-player-overrides.css";
import type { MimeType } from "@/types/stream";

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
  mimeType?: MimeType;
  onEnded?: () => void;
  onError?: (error: Error) => void;
  onLoadStart?: () => void;
  onPlaying?: () => void;
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
}

/** Una pista de subtítulos externa, ya en WebVTT y servible con CORS propio. */
export interface SubtitleTrackSource {
  id: string;
  label: string;
  srcLang: string;
  url: string;
}

const { Player } = createPlayer({ features: videoFeatures });

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

// Juego de eventos con el que @videojs/core sincroniza su propio estado. Con
// solo `play`/`pause` el icono se queda viejo tras un `ended`, un cambio de
// fuente (`emptied`), un seek o mientras el medio aún no tiene datos.
const SYNC_EVENTS = [
  "emptied",
  "ended",
  "loadeddata",
  "canplay",
  "pause",
  "play",
  "playing",
  "seeked",
  "waiting",
];

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
  onEnded,
  onError,
  onSourceInfo,
  onLoadStart,
  onWaiting,
  onPlaying,
  onTimeUpdate,
}: VideoJsStreamPlayerProps) {
  // Estado y no ref: al montar el <video> hay que re-renderizar para publicarlo
  // vía `onMediaRef` y para que el indicador de pausa se enganche a sus eventos.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  // Indicador central: un play fijo mientras el medio está pausado Y tiene ya
  // datos que reproducir. Sin animación — un destello al pausar/reanudar solo
  // estorba. Arranca oculto porque hasta el primer evento no se sabe si el
  // navegador dejó arrancar el autoplay.
  const [showPlayIcon, setShowPlayIcon] = useState(false);
  // Objeto media del skin, que `MediaBridge` saca del contexto de `<Player>`.
  const [media, setMedia] = useState<unknown>(null);
  const handleMedia = useCallback((next: unknown) => setMedia(next), []);
  // HLS (streams en vivo o .m3u8 bajo demanda) necesita hls.js para MSE: un
  // <video> nativo solo lo reproduce en Safari. HlsJsVideo decide internamente
  // MSE vs. nativo según soporte del navegador.
  const isHls = mimeType === "application/x-mpegURL";

  const rootClassName = cn(
    // `relative` es carga útil: el overlay central es `absolute inset-0` y sin
    // esto se posicionaría contra un ancestro cualquiera.
    "stream-video-player-root relative w-full overflow-hidden rounded-lg",
    isPlayMode && "play-mode",
    className
  );

  useEffect(() => {
    onMediaRef?.({ media, video: videoEl });
  }, [media, videoEl, onMediaRef]);

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

  // Sigue el estado real del <video> para el icono central.
  useEffect(() => {
    if (!videoEl) {
      return;
    }
    // `readyState` entra en la condición para no plantar un play encima de la
    // pantalla de carga: mientras no hay datos no está "pausado", está cargando.
    const sync = () =>
      setShowPlayIcon(
        (videoEl.paused || videoEl.ended) && videoEl.readyState >= 2
      );
    // Lectura inmediata: el elemento puede llevar rato montado (remonte por
    // cambio de fuente) o el navegador puede haber bloqueado el autoplay, y en
    // ninguno de los dos casos llega ya un evento que delate el estado.
    sync();
    for (const type of SYNC_EVENTS) {
      videoEl.addEventListener(type, sync);
    }
    return () => {
      for (const type of SYNC_EVENTS) {
        videoEl.removeEventListener(type, sync);
      }
    };
  }, [videoEl]);

  const handleError = (error: unknown) => {
    const message = serializePlaybackError(error);
    const err = error instanceof Error ? error : new Error(message);
    console.error("Playback error:", err);
    onError?.(err);
  };

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const el = e.target as HTMLVideoElement;
    onTimeUpdate?.(
      el.currentTime,
      Number.isFinite(el.duration) ? el.duration : 0
    );
  };

  return (
    <div className={rootClassName}>
      <Player>
        <VideoSkin>
          {isHls ? (
            <HlsJsVideo
              autoPlay={autoPlay}
              controls={controls}
              onEnded={onEnded}
              onError={handleError}
              onLoadStart={onLoadStart}
              onPlaying={onPlaying}
              onTimeUpdate={handleTimeUpdate}
              onWaiting={onWaiting}
              playsInline={playsInline}
              poster={poster}
              preload={preload}
              ref={setVideoEl}
              // @videojs/core detecta HLS comparando contra su propio string
              // interno ("application/vnd.apple.mpegurl"), distinto del que
              // usa este proyecto ("application/x-mpegURL"). Pasar el
              // mimeType tal cual rompería la detección y haría caer siempre
              // al delegate nativo (sin hls.js).
              source={{ src, type: "application/vnd.apple.mpegurl" }}
            >
              {subtitleTracks}
            </HlsJsVideo>
          ) : (
            <Video
              autoPlay={autoPlay}
              controls={controls}
              onEnded={onEnded}
              onError={handleError}
              onLoadStart={onLoadStart}
              onPlaying={onPlaying}
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
        </VideoSkin>
      </Player>
      {/* Indicador de pausa. El toggle en sí lo hace el gesto `tap` del propio
          skin, no este overlay (de ahí `pointer-events-none`). */}
      {showPlayIcon && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
            <PlayIcon className="size-8 fill-current" />
          </div>
        </div>
      )}
    </div>
  );
}

export default VideoJsStreamPlayer;
