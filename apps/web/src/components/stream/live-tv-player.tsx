"use client";

import { I18nProvider } from "@videojs/react/i18n";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { AlertCircleIcon, RefreshCwIcon } from "lucide-react";
import posthog from "posthog-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveTvPlayback } from "@/hooks/use-live-tv-playback";
import { useMediaTracks } from "@/hooks/use-media-tracks";
import type { LiveTvChannel } from "@/lib/live-tv";
import { useTranslation } from "@/lib/onevid-i18n-context";
import { StreamTrackPicker } from "./stream-track-picker";
import { VideoJsStreamPlayer } from "./video-js-stream-player";
import "./live-tv-player.css";

interface LiveTvPlayerProps {
  channel: LiveTvChannel;
}

/**
 * Un canal en directo debe empezar a pintar imagen en este plazo. El proveedor
 * puede tardar (hemos visto arranques de 40–50 s), pero si no hay `canplay` ni
 * un error fatal, hls.js reintenta para siempre y el logo de carga nunca se
 * retira. Pasado este tiempo mostramos el error con el botón de reintentar.
 */
export const LIVE_TV_STARTUP_TIMEOUT_MS = 60_000;

/**
 * Un canal que ya estaba reproduciendo y deja de recibir segmentos debe
 * avisar antes que uno que nunca arrancó: si en este plazo no vuelve la
 * imagen, mostramos el error con reintento.
 */
export const LIVE_TV_BUFFERING_TIMEOUT_MS = 30_000;

/** Un reintento automático antes de enseñar la alerta; el botón queda después. */
const MAX_AUTO_RETRIES = 1;
const LIVE_AUTO_RETRY_DELAY_MS = 700;

export function describeLiveFailure(details: string | null): string {
  if (!details) {
    return "El canal puede estar desconectado o el proveedor no respondió. Reintenta o elige otro canal.";
  }
  if (/stalled|hole/i.test(details)) {
    return "La señal se cortó. Reintenta o elige otro canal.";
  }
  // `fragParsingError` suele ser contenedor/códec del segmento; los errores de
  // manifiesto/playlist son del proveedor y no deben culpar al navegador.
  if (/Codec|Append|mediaDecode|fragParsing/i.test(details)) {
    return "El canal usa un formato de vídeo o audio que este navegador no puede decodificar. Prueba con otro navegador o pide una fuente compatible.";
  }
  if (/Parsing|Load|TimeOut|timeout/i.test(details)) {
    return "El proveedor no respondió a tiempo o la lista de reproducción no es válida. Reintenta o elige otro canal.";
  }
  return "El canal puede estar desconectado o el proveedor no respondió. Reintenta o elige otro canal.";
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

/**
 * Logo del canal centrado mientras el stream arranca. En cuanto hay imagen el
 * reproductor pinta su propio loader de buffering, así que este overlay se
 * retira y no vuelve a aparecer en los cortes posteriores.
 */
function ChannelLoadingLogo({ channel }: { channel: LiveTvChannel }) {
  const [failed, setFailed] = useState(false);
  let logo: string | undefined;
  try {
    const url = new URL(channel.logo ?? "");
    if (url.protocol === "https:" && !url.username && !url.password)
      logo = url.href;
  } catch {
    /* Sin logo válido mostramos la inicial del canal. */
  }
  if (logo && !failed) {
    return (
      // Provider logos are remote and must not pass through the image optimizer.
      // biome-ignore lint/performance/noImgElement: provider logos are remote and bypass the Next.js image optimizer.
      <img
        alt=""
        className="max-h-20 w-auto max-w-[45%] object-contain drop-shadow-lg"
        onError={() => setFailed(true)}
        referrerPolicy="no-referrer"
        src={logo}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex size-16 items-center justify-center rounded-2xl border border-white/15 bg-white/5 text-2xl font-semibold text-white/80 uppercase"
    >
      {channel.name.trim().charAt(0) || "TV"}
    </span>
  );
}

function LiveTvSession({
  channel,
  attempt,
  lastFailureDetails,
  onPlayed,
  onRetry,
}: LiveTvPlayerProps & {
  attempt: number;
  lastFailureDetails: string | null;
  onPlayed: () => void;
  onRetry: (details?: string) => void;
}) {
  const { t: rawT } = useTranslation();
  const t = (key: string, options?: Record<string, unknown>) =>
    rawT(key as never, options as never) as unknown as string;
  const root = useRef<HTMLDivElement>(null);
  // `error` = fallo fatal reportado por hls.js; `timeout` = el canal no arrancó
  // dentro del plazo; `stalled` = ya estaba reproduciendo y dejó de hacerlo.
  const [failure, setFailure] = useState<
    "error" | "stalled" | "timeout" | null
  >(null);
  // Detalle de hls.js (`bufferAppendError`, `manifestLoadError`…) para explicar
  // el fallo sin culpar siempre a HTTP/HTTPS.
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const [loadingChannel, setLoadingChannel] = useState(true);
  // hls.js puede dejar de recibir segmentos sin emitir un error fatal; el skin
  // mostraría su propio spinner para siempre. Con esto usamos el loader del
  // canal y el watchdog también cubre los cortes posteriores al arranque.
  const [buffering, setBuffering] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [playerRefs, setPlayerRefs] = useState<{
    media: unknown;
    video: HTMLVideoElement | null;
  }>({ media: null, video: null });
  const handleMediaRef = useCallback(
    (refs: { media: unknown; video: HTMLVideoElement | null }) =>
      setPlayerRefs(refs),
    [],
  );
  const handleError = useCallback(
    (error?: Error) => {
      // El primer error suele traer el detalle real (`bufferAppendError`,
      // `manifestLoadError`…). Al remontar se perdería, así que lo pasamos al
      // padre y lo recuperamos en el siguiente intento si este no lo trae.
      const details =
        (error as { details?: string } | undefined)?.details ??
        lastFailureDetails ??
        null;
      // Primer fallo: en vez de rendirnos, remontamos la sesión una vez. Un
      // segmento corrupto o un corte de red se suele resolver al reconectar.
      if (attempt < MAX_AUTO_RETRIES) {
        try {
          posthog.capture("live_playback_retry", {
            attempt,
            auto: true,
            channel_group: channel.group,
            channel_name: channel.name,
            content_type: "live",
            details,
          });
        } catch {
          // La analítica nunca debe romper la reproducción.
        }
        setLoadingChannel(true);
        setBuffering(false);
        if (retryTimerRef.current !== null) {
          window.clearTimeout(retryTimerRef.current);
        }
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          onRetry(details ?? undefined);
        }, LIVE_AUTO_RETRY_DELAY_MS);
        return;
      }
      setFailureReason(details);
      setFailure((current) => current ?? "error");
    },
    [
      attempt,
      channel.group,
      channel.name,
      lastFailureDetails,
      onRetry,
    ],
  );

  const handleManualRetry = useCallback(() => {
    try {
      posthog.capture("live_playback_retry", {
        attempt,
        auto: false,
        channel_group: channel.group,
        channel_name: channel.name,
        content_type: "live",
        details: failureReason,
      });
    } catch {
      // La analítica nunca debe romper la reproducción.
    }
    onRetry(failureReason ?? undefined);
  }, [attempt, channel.group, channel.name, failureReason, onRetry]);

  useEffect(
    () => () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
      }
    },
    [],
  );
  // El skin muestra su propio spinner de buffering si el proveedor deja de
  // enviar segmentos; en Live TV preferimos el loader con el logo del canal y
  // un plazo máximo antes de avisar del fallo.
  const handleWaiting = useCallback(() => setBuffering(true), []);
  const handlePlaying = useCallback(() => {
    setBuffering(false);
    setLoadingChannel(false);
    onPlayed();
  }, [onPlayed]);
  const tracks = useMediaTracks(playerRefs.video, playerRefs.media);
  const validSource = isLiveTvPlaybackUrl(channel.url);
  // Canales con audio que MSE no soporta (AC-3/DTS/TrueHD) van por MediaBunny:
  // hls.js solo pinta el vídeo y el audio se queda mudo. Al fallar o agotarse
  // el plazo se corta el sondeo/pipeline (`null`) para no dejarlo en segundo plano.
  const live = useLiveTvPlayback(validSource && !failure ? channel.url : null);
  const playbackSrc = live.src ?? channel.url;
  const playbackMimeType = live.src ? "video/mp4" : "application/x-mpegURL";
  const showTrackPicker =
    tracks.audioTracks.length > 1 || tracks.subtitleTracks.length > 0;

  // `playing` cubre el arranque normal; `canplay` evita que el logo tape los
  // controles si el navegador bloquea el autoplay.
  useEffect(() => {
    const video = playerRefs.video;
    if (!video) return;
    const stopLoading = () => {
      setLoadingChannel(false);
      setBuffering(false);
    };
    video.addEventListener("playing", stopLoading);
    video.addEventListener("canplay", stopLoading);
    if (video.readyState >= 3) stopLoading();
    return () => {
      video.removeEventListener("playing", stopLoading);
      video.removeEventListener("canplay", stopLoading);
    };
  }, [playerRefs.video]);

  // Ni el sondeo de audio ni hls.js tienen un límite propio cuando el
  // proveedor deja una petición colgada: sin este plazo el canal se queda en
  // "Cargando..." indefinidamente. Cubre también los cortes a mitad de
  // reproducción (`buffering`) y el pipeline de MediaBunny, que solo avisa al
  // arrancar (`onStart`) o fallar (`onError`).
  useEffect(() => {
    if (failure || !(loadingChannel || buffering)) return;
    const timeout = window.setTimeout(
      () => {
        setFailure(
          (current) =>
            current ?? (loadingChannel ? "timeout" : "stalled"),
        );
      },
      loadingChannel
        ? LIVE_TV_STARTUP_TIMEOUT_MS
        : LIVE_TV_BUFFERING_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [buffering, failure, loadingChannel]);

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
        <p className="truncate text-sm font-medium">{channel.name}</p>
      </div>
      {showTrackPicker ? (
        <StreamTrackPicker
          activeAudioId={tracks.activeAudioId}
          activeSubtitleId={tracks.activeSubtitleId}
          audioTracks={tracks.audioTracks}
          onSelectAudio={tracks.selectAudio}
          onSelectSubtitle={tracks.selectSubtitle}
          subtitleTracks={tracks.subtitleTracks}
        />
      ) : null}
    </div>
  );

  return (
    <section
      aria-label={t("Reproductor de Live TV: {{name}}", {
        name: channel.name,
      })}
      className="onevid-live-player relative aspect-video w-full overflow-hidden bg-black text-white"
      ref={root}
    >
      {validSource && !failure && (live.probing || loadingChannel || buffering) ? (
        <div
          className="pointer-events-none absolute inset-0 z-20 flex animate-pulse items-center justify-center motion-reduce:animate-none"
          role="status"
        >
          <span className="sr-only">
            {t("Cargando {{name}}...", { name: channel.name })}
          </span>
          <ChannelLoadingLogo channel={channel} />
        </div>
      ) : null}
      {!validSource || failure ? (
        <div className="flex h-full items-center justify-center overflow-y-auto p-3 sm:p-6">
          <Alert className="max-w-lg border-white/10 bg-black text-white">
            <AlertCircleIcon aria-hidden="true" />
            <AlertTitle>
              {!validSource
                ? t("Este canal necesita una fuente HTTPS")
                : failure === "stalled"
                  ? t("El canal se quedó sin señal")
                  : failure === "timeout"
                    ? t("El canal está tardando demasiado")
                    : t("No se pudo reproducir el canal")}
            </AlertTitle>
            <AlertDescription className="text-white/60">
              {!validSource ? (
                <p>
                  {t(
                    "Solo se aceptan canales HTTPS sin credenciales incrustadas. Solicita una fuente compatible a tu proveedor.",
                  )}
                </p>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="min-w-0 text-sm">
                    {failure === "stalled"
                      ? t(
                          "La reproducción se detuvo. Puedes reintentar o elegir otro canal.",
                        )
                      : failure === "timeout"
                        ? t(
                            "No empezó a reproducir a tiempo. El proveedor puede estar saturado o el canal desconectado. Reintenta o elige otro canal.",
                          )
                        : t(describeLiveFailure(failureReason))}
                  </p>
                  {process.env.NODE_ENV === "development" && failureReason ? (
                    <p className="basis-full font-mono text-[10px] text-white/30">
                      {failureReason}
                    </p>
                  ) : null}
                  <Button
                    className="shrink-0"
                    data-dpad-focusable
                    onClick={handleManualRetry}
                    size="sm"
                    variant="secondary"
                  >
                    <RefreshCwIcon aria-hidden="true" className="size-4" />
                    {t("Reintentar reproducción")}
                  </Button>
                </div>
              )}
            </AlertDescription>
          </Alert>
        </div>
      ) : live.probing ? null : (
        <I18nProvider locale="es">
          <VideoJsStreamPlayer
            autoPlay
            className="h-full"
            isPlayMode
            liveControls={toolbar}
            liveMode
            mimeType={playbackMimeType}
            onControlsVisibility={setControlsVisible}
            onError={handleError}
            onMediaRef={handleMediaRef}
            onPlaying={handlePlaying}
            onWaiting={handleWaiting}
            preload="auto"
            src={playbackSrc}
            ttffProperties={{
              attempt,
              channel_group: channel.group,
              channel_name: channel.name,
              content_type: "live",
            }}
          />
        </I18nProvider>
      )}
    </section>
  );
}

/** Key the entire session, not just the video, to release adapters and track subscriptions. */
export function LiveTvPlayer({ channel }: LiveTvPlayerProps) {
  const [attempt, setAttempt] = useState(0);
  const [lastFailureDetails, setLastFailureDetails] = useState<string | null>(
    null
  );
  useEffect(() => {
    setAttempt(0);
    setLastFailureDetails(null);
  }, [channel.id]);
  const retry = useCallback((details?: string) => {
    if (details) {
      setLastFailureDetails(details);
    }
    setAttempt((value) => value + 1);
  }, []);
  const handlePlayed = useCallback(() => setLastFailureDetails(null), []);
  return (
    <LiveTvSession
      attempt={attempt}
      channel={channel}
      key={`${channel.id}:${attempt}`}
      lastFailureDetails={lastFailureDetails}
      onPlayed={handlePlayed}
      onRetry={retry}
    />
  );
}
