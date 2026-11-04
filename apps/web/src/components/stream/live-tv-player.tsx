"use client";

import { I18nProvider } from "@videojs/react/i18n";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { AlertCircleIcon, RadioIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaTracks } from "@/hooks/use-media-tracks";
import type { LiveTvChannel } from "@/lib/live-tv";
import { StreamTrackPicker } from "./stream-track-picker";
import { VideoJsStreamPlayer } from "./video-js-stream-player";
import "./live-tv-player.css";

interface LiveTvPlayerProps {
  channel: LiveTvChannel;
}

export function isLiveTvPlaybackUrl(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function getLiveEdge(
  video: Pick<HTMLVideoElement, "seekable"> | null,
): number | null {
  try {
    const ranges = video?.seekable;
    if (!ranges?.length) return null;
    const index = ranges.length - 1;
    const start = ranges.start(index);
    const end = ranges.end(index);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      return null;
    // Seeking just inside the last range avoids landing beyond the buffered live window.
    return Math.max(start, end - 0.5);
  } catch {
    return null;
  }
}

export function returnToLive(video: HTMLVideoElement | null): boolean {
  const edge = getLiveEdge(video);
  if (!video || edge === null) return false;
  try {
    video.currentTime = edge;
    video.playbackRate = 1;
    // A blocked play request leaves the skin's play button available; never log the rejection.
    void video.play().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

function LiveTvSession({
  channel,
  onRetry,
}: LiveTvPlayerProps & { onRetry: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [canGoLive, setCanGoLive] = useState(false);
  const [playerRefs, setPlayerRefs] = useState<{
    media: unknown;
    video: HTMLVideoElement | null;
  }>({ media: null, video: null });
  const handleMediaRef = useCallback(
    (refs: { media: unknown; video: HTMLVideoElement | null }) =>
      setPlayerRefs(refs),
    [],
  );
  const handleError = useCallback(() => setFailed(true), []);
  const tracks = useMediaTracks(playerRefs.video, playerRefs.media);
  const validSource = isLiveTvPlaybackUrl(channel.url);

  useEffect(() => {
    const video = playerRefs.video;
    if (!video) return;
    const update = () => setCanGoLive(getLiveEdge(video) !== null);
    update();
    const controller = new AbortController();
    for (const event of [
      "loadedmetadata",
      "durationchange",
      "progress",
      "timeupdate",
      "emptied",
    ]) {
      video.addEventListener(event, update, { signal: controller.signal });
    }
    return () => controller.abort();
  }, [playerRefs.video]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const markControls = () => {
      for (const control of element.querySelectorAll<HTMLElement>(
        "button, [role='slider'], [role='menuitemradio']",
      )) {
        control.setAttribute("data-dpad-focusable", "");
      }
    };
    markControls();
    const observer = new MutationObserver(markControls);
    observer.observe(element, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const toolbar = (
    <div
      className={cn(
        "live-tv-player-toolbar absolute inset-x-0 top-0 z-30 flex items-center gap-2 bg-linear-to-b from-black/80 to-transparent p-3 pb-8 text-white transition-opacity",
        !controlsVisible && "live-tv-player-toolbar-hidden",
      )}
    >
      <div className="mr-auto min-w-0">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/60">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-red-400"
          />
          Live TV
        </p>
        <p className="truncate text-sm font-medium">{channel.name}</p>
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="Volver al directo"
              className="shrink-0 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20"
              data-dpad-focusable
              disabled={!canGoLive}
              onClick={() => returnToLive(playerRefs.video)}
              size="sm"
              variant="ghost"
            />
          }
        >
          <RadioIcon aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">En directo</span>
        </TooltipTrigger>
        <TooltipContent>Volver al directo</TooltipContent>
      </Tooltip>
      <StreamTrackPicker
        activeAudioId={tracks.activeAudioId}
        activeSubtitleId={tracks.activeSubtitleId}
        audioTracks={tracks.audioTracks}
        onSelectAudio={tracks.selectAudio}
        onSelectSubtitle={tracks.selectSubtitle}
        subtitleTracks={tracks.subtitleTracks}
      />
    </div>
  );

  return (
    <section
      aria-label={`Reproductor de Live TV: ${channel.name}`}
      className="onevid-live-player relative aspect-video w-full overflow-hidden bg-black text-white"
      ref={root}
    >
      {!validSource || failed ? (
        <div className="flex h-full items-center justify-center overflow-y-auto p-3 sm:p-6">
          <Alert className="max-w-lg border-white/10 bg-black text-white">
            <AlertCircleIcon aria-hidden="true" />
            <AlertTitle>
              {!validSource
                ? "Este canal necesita una fuente HTTPS"
                : "No se pudo reproducir el canal"}
            </AlertTitle>
            <AlertDescription className="space-y-3 text-white/60">
              <p>
                {!validSource
                  ? "Solo se aceptan canales HTTPS sin credenciales incrustadas. Solicita una fuente compatible a tu proveedor."
                  : "El canal puede estar desconectado, bloquear el acceso desde el navegador (CORS) o usar un formato o códec no compatible."}
              </p>
              {validSource ? (
                <Button
                  data-dpad-focusable
                  onClick={onRetry}
                  size="sm"
                  variant="secondary"
                >
                  <RefreshCwIcon aria-hidden="true" className="size-4" />
                  Reintentar reproducción
                </Button>
              ) : null}
              <p className="text-xs">
                También puedes seleccionar otro canal de la lista.
              </p>
            </AlertDescription>
          </Alert>
        </div>
      ) : (
        <I18nProvider locale="es">
          <VideoJsStreamPlayer
            autoPlay
            className="h-full"
            isPlayMode
            liveControls={toolbar}
            liveMode
            mimeType="application/x-mpegURL"
            onControlsVisibility={setControlsVisible}
            onError={handleError}
            onMediaRef={handleMediaRef}
            preload="auto"
            src={channel.url}
          />
        </I18nProvider>
      )}
    </section>
  );
}

/** Key the entire session, not just the video, to release adapters and track subscriptions. */
export function LiveTvPlayer({ channel }: LiveTvPlayerProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <LiveTvSession
      channel={channel}
      key={`${channel.id}:${attempt}`}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}
