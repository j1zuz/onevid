"use client";

import { createPlayer, videoFeatures } from "@videojs/react";
import { Video, VideoSkin } from "@videojs/react/video";
import { useEffect, useRef } from "react";
import "@videojs/react/video/skin.css";
import { cn } from "@workspace/ui/lib/utils";
import "./video-js-player-overrides.css";
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
  onTimeUpdate?: (currentTime: number) => void;
  onWaiting?: () => void;
  playsInline?: boolean;
  poster?: string;
  preload?: "auto" | "metadata" | "none";
  src: string;
}

const Player = createPlayer({ features: videoFeatures });

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
  const playerRef = useRef<HTMLVideoElement>(null);

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

  return (
    <div className={rootClassName}>
      <Player.Provider>
        <VideoSkin>
          <Video
            autoPlay={autoPlay}
            controls={controls}
            onEnded={onEnded}
            onError={(error: unknown) => {
              const err =
                error instanceof Error
                  ? error
                  : new Error(String(error || "Unknown error"));
              console.error("Playback error:", err);
              onError?.(err);
            }}
            onLoadStart={onLoadStart}
            onPlaying={onPlaying}
            onTimeUpdate={(e: React.SyntheticEvent<HTMLVideoElement>) =>
              onTimeUpdate?.((e.target as HTMLVideoElement).currentTime)
            }
            onWaiting={onWaiting}
            playsInline={playsInline}
            poster={poster}
            preload={preload}
            ref={playerRef}
            src={src}
            {...({ type: mimeType } as React.ComponentProps<typeof Video>)}
          />
        </VideoSkin>
      </Player.Provider>
    </div>
  );
}

export default VideoJsStreamPlayer;
