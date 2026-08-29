"use client";

import { createPlayer, videoFeatures } from "@videojs/react";
import { HlsJsVideo } from "@videojs/react/media/hlsjs-video";
import { Video, VideoSkin } from "@videojs/react/video";
import { useEffect, useState } from "react";
import "@videojs/react/video/skin.css";
import { cn } from "@workspace/ui/lib/utils";
import "./video-js-player-overrides.css";
import { MediaTrackControls } from "@/components/stream/media-track-controls";
import type { MimeType } from "@/types/stream";

interface VideoJsStreamPlayerProps {
  autoPlay?: boolean;
  className?: string;
  controls?: boolean;
  fullscreenOnPlay?: boolean;
  isPlayMode?: boolean;
  mimeType?: MimeType;
  onEnded?: () => void;
  onError?: (error: Error) => void;
  onLoadStart?: () => void;
  onPlaying?: () => void;
  onSourceInfo?: (info: { url: string; mimeType: string }) => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onWaiting?: () => void;
  playsInline?: boolean;
  poster?: string;
  preload?: "auto" | "metadata" | "none";
  src: string;
}

const { Player } = createPlayer({ features: videoFeatures });

export function VideoJsStreamPlayer({
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
  // State (not a ref) so the track controls re-render once the <video> mounts
  // and they can read its audio/text track lists.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  // HLS (streams en vivo o .m3u8 bajo demanda) necesita hls.js para MSE: un
  // <video> nativo solo lo reproduce en Safari. HlsJsVideo decide internamente
  // MSE vs. nativo según soporte del navegador.
  const isHls = mimeType === "application/x-mpegURL";

  const rootClassName = cn(
    "stream-video-player-root w-full overflow-hidden rounded-lg",
    isPlayMode && "play-mode",
    className
  );

  // Report source info on mount
  useEffect(() => {
    if (onSourceInfo) {
      onSourceInfo({ url: src, mimeType });
    }
  }, [src, mimeType, onSourceInfo]);

  const handleError = (error: unknown) => {
    const err =
      error instanceof Error
        ? error
        : new Error(String(error || "Unknown error"));
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

  // The skin's own play/pause button is hidden (see the override CSS) in
  // favor of tapping the video itself, so this is the only way to toggle
  // playback short of the keyboard shortcut.
  const handleTogglePlay = () => {
    if (!videoEl) {
      return;
    }
    if (videoEl.paused || videoEl.ended) {
      // A tap that pauses while the play() request is still pending rejects the
      // returned promise with an AbortError. That is benign — playback recovers
      // on its own — so swallow it and only report real failures.
      videoEl.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        handleError(error);
      });
    } else {
      videoEl.pause();
    }
  };

  return (
    <div className={rootClassName}>
      <Player>
        <VideoSkin>
          {isHls ? (
            <HlsJsVideo
              autoPlay={autoPlay}
              controls={controls}
              onClick={handleTogglePlay}
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
            />
          ) : (
            <Video
              autoPlay={autoPlay}
              controls={controls}
              onClick={handleTogglePlay}
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
            />
          )}
          {/* `controls` here is the native <video controls> attribute: when
              the caller wants that instead of the skin's own bar, stacking
              our menu cluster on top of it would just look broken. */}
          {!controls && <MediaTrackControls video={videoEl} />}
        </VideoSkin>
      </Player>
    </div>
  );
}

export default VideoJsStreamPlayer;
