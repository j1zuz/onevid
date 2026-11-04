"use client";

import {
  createPlayer,
  Gesture,
  selectControls,
  useMedia,
  videoFeatures,
} from "@videojs/react";
import { HlsJsVideo } from "@videojs/react/media/hlsjs-video";
import { Video, VideoSkin } from "@videojs/react/video";
import {
  useCallback,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
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
  /** Opt-in live controls and credential-safe error reporting; movies retain their defaults. */
  liveMode?: boolean;
  /** Rendered inside the skin so live controls are included in its fullscreen element. */
  liveControls?: ReactNode;
  mimeType?: MimeType;
  onEnded?: () => void;
  onError?: (error: Error) => void;
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
  onLoadStart,
  onWaiting,
  onPlaying,
  onTimeUpdate,
}: VideoJsStreamPlayerProps) {
  // Estado y no ref: al montar el <video> hay que re-renderizar para publicarlo
  // vía `onMediaRef`.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  // Objeto media del skin, que `MediaBridge` saca del contexto de `<Player>`.
  const [media, setMedia] = useState<unknown>(null);
  const handleMedia = useCallback((next: unknown) => setMedia(next), []);
  // HLS (streams en vivo o .m3u8 bajo demanda) necesita hls.js para MSE: un
  // <video> nativo solo lo reproduce en Safari. HlsJsVideo decide internamente
  // MSE vs. nativo según soporte del navegador.
  const isHls = mimeType === "application/x-mpegURL";

  const rootClassName = cn(
    "stream-video-player-root relative w-full overflow-hidden rounded-lg",
    isPlayMode && "play-mode",
    liveMode && "live-mode",
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

  const handleError = useCallback(
    (error: unknown) => {
      if (liveMode) {
        // HLS errors can embed provider URLs and credentials, including in their cause/data.
        onError?.(new Error("No se pudo reproducir este canal de Live TV."));
        return;
      }
      const message = serializePlaybackError(error);
      const err = error instanceof Error ? error : new Error(message);
      console.error("Playback error:", err);
      onError?.(err);
    },
    [liveMode, onError],
  );

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const el = e.target as HTMLVideoElement;
    onTimeUpdate?.(
      el.currentTime,
      Number.isFinite(el.duration) ? el.duration : 0
    );
  };
  const hlsVideoProps = {
    autoPlay,
    controls,
    onEnded,
    onError: handleError,
    onLoadStart,
    onPlaying,
    onTimeUpdate: handleTimeUpdate,
    onWaiting,
    playsInline,
    poster,
    preload,
    ref: setVideoEl,
    source: {
      src,
      type: "application/vnd.apple.mpegurl",
      ...(liveMode ? { engine: { hlsJs: { debug: false } } } : {}),
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
          <PlayerControlsBridge onVisibilityChange={onControlsVisibility} />
          <Gesture type="tap" action="togglePaused" pointer="touch" region="center" />
        </VideoSkin>
      </Player>
    </div>
  );
}

export default VideoJsStreamPlayer;
