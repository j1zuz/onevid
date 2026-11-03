"use client";

import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  type NextEpisodeRef,
  StreamNextEpisode,
} from "@/components/stream/stream-next-episode";
import { StreamEpisodePicker } from "@/components/stream/stream-episode-picker";
import { PlayerDownloadButton } from "@/components/stream/player-download-button";
import { StreamSourcePicker } from "@/components/stream/stream-source-picker";
import { StreamTrackPicker } from "@/components/stream/stream-track-picker";
import {
  type SubtitleTrackSource,
  VideoJsStreamPlayer,
} from "@/components/stream/video-js-stream-player";
import { useIsTv } from "@/hooks/use-is-tv";
import { trackLabel, useMediaTracks } from "@/hooks/use-media-tracks";
import {
  deleteOfflineMediaFile,
  getOfflineMediaFile,
  offlineStorageKey,
  useMediaBunny,
} from "@/hooks/use-mediabunny";
import { useNextEpisode } from "@/hooks/use-next-episode";
import { useWatchProgress } from "@/hooks/use-video-progress";
import { tmdbImage } from "@/lib/tmdb";
import { getTmdbLogo } from "@/lib/tmdb-logo-client";
import type { MimeType, StreamWithAddon } from "@/types/stream";
import { getMimeType, needsMediaBunny } from "@/utils/stream-codec";

function renderLogoCenter({
  logo,
  contentTitle,
}: {
  logo: string | undefined;
  contentTitle: string;
}) {
  if (logo) {
    return (
      // biome-ignore lint/performance/noImgElement: external CDN logo
      <img
        alt={contentTitle}
        className="h-auto max-h-[20vh] w-auto max-w-[60vw] animate-pulse object-contain drop-shadow-2xl"
        height={0}
        src={logo}
        width={0}
      />
    );
  }
  return (
    <h2 className="max-w-[80vw] animate-pulse text-center font-semibold text-3xl text-white drop-shadow-2xl md:text-5xl">
      {contentTitle}
    </h2>
  );
}

// Isolated so the back button/title don't re-render on every mediabunny
// transcoding progress tick (StreamOnevid re-renders hundreds of times during
// a transcode; without this the whole header re-rendered along with it).
const PlayerTopBar = memo(function PlayerTopBar({
  backHref,
  contentTitle,
  handleBack,
  downloadButton,
  episodePicker,
  sourcePicker,
  trackPicker,
  visible,
}: {
  backHref: string;
  contentTitle: string;
  handleBack: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  downloadButton?: React.ReactNode;
  episodePicker?: React.ReactNode;
  sourcePicker?: React.ReactNode;
  trackPicker?: React.ReactNode;
  visible: boolean;
}) {
  return (
    <TooltipProvider>
      <div
        className={cn(
          // La visibilidad la marca el propio player (controles de video.js).
          // Antes los `md:` la ocultaban en pantallas anchas y solo aparecía
          // con hover: en un móvil girado a landscape (ancho > 768px) no hay
          // hover, así que la barra superior nunca se veía.
          "absolute inset-x-0 top-0 z-10 flex items-center gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 py-3 transition-opacity duration-300",
          visible
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        )}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
                href={backHref}
                onClick={handleBack}
                aria-label="Volver"
              >
                <ArrowLeftIcon className="size-5" />
              </Link>
            }
          />
          <TooltipContent>Volver</TooltipContent>
        </Tooltip>
      <h1 className="min-w-0 flex-1 truncate font-medium text-base text-white">
        {contentTitle}
      </h1>
      {trackPicker}
      {episodePicker}
      {downloadButton}
      {sourcePicker}
      </div>
    </TooltipProvider>
  );
});

// Antelación con la que aparece el botón de "siguiente episodio". En un
// episodio corto 75 s serían casi el final entero, así que se recorta a una
// fracción de su duración real.
const NEXT_EPISODE_LEAD_SEC = 75;
const MAX_PLAYBACK_RETRIES = 2;

function nextEpisodeLead(durationSec: number): number {
  return Math.min(NEXT_EPISODE_LEAD_SEC, durationSec * 0.15);
}

interface StreamOnevidProps {
  contentBackground?: string;
  contentId: string;
  contentLogo?: string;
  contentPoster?: string;
  contentTitle: string;
  contentType: "movie" | "series";
  rawId: string;
}

export function StreamOnevid({
  contentId,
  contentType,
  contentTitle,
  contentPoster: _contentPoster,
  contentBackground,
  contentLogo,
  rawId,
}: StreamOnevidProps) {
  // For series rawId is "seriesId:season:episode"; movies have no suffix.
  const rawParts = rawId.split(":");
  const season = rawParts.length >= 3 ? Number(rawParts[1]) || 0 : 0;
  const episode = rawParts.length >= 3 ? Number(rawParts[2]) || 0 : 0;
  const router = useRouter();
  // Volver al título reproducido, no al Inicio. En series usamos el id base sin
  // temporada/episodio, pero pasamos la temporada actual para que el detalle
  // abra la misma que se estaba viendo (antes volvía siempre a la 1).
  const backHref =
    contentType === "series" && season > 0
      ? `/home/detail/series/${encodeURIComponent(contentId)}?season=${season}`
      : `/home/detail/${contentType}/${encodeURIComponent(contentId)}`;
  const handleBack = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      router.replace(backHref);
    },
    [router, backHref]
  );
  const [selectedSource, setSelectedSource] = useState<StreamWithAddon | null>(
    null
  );
  const [selectedMimeType, setSelectedMimeType] =
    useState<MimeType>("video/mp4");
  const triedSessionStorage = useRef(false);

  // Logo: start from server prop, fetch client-side as fallback
  const [logo, setLogo] = useState<string | undefined>(contentLogo);
  // Arranca en false: el fondo oscuro de "cargando" solo debe aparecer si el
  // video REALMENTE bufferea o si el medio se está transcodificando, no al
  // montar. Antes arrancaba en true y el loader se veía siempre de primero,
  // aunque el medio fuera nativo y arrancara al instante.
  const [isBuffering, setIsBuffering] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [playbackRetry, setPlaybackRetry] = useState(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [mediaBunnyRetry, setMediaBunnyRetry] = useState(0);
  const [offlineMediaUrl, setOfflineMediaUrl] = useState<string | null>(null);
  const offlineKey = offlineStorageKey(contentType, rawId);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [arePlayerControlsVisible, setArePlayerControlsVisible] =
    useState(false);
  const handleControlsVisibility = useCallback((visible: boolean) => {
    setArePlayerControlsVisible(visible);
  }, []);

  // Extract filename from source URL for MediaBunny detection.
  const sourceUrl =
    typeof selectedSource?.url === "string" ? selectedSource.url : null;
  const sourceFilename = sourceUrl
    ? (() => {
        try {
          return new URL(sourceUrl).pathname.split("/").pop() || "";
        } catch {
          return "";
        }
      })()
    : "";
  const sourceCodecHint =
    typeof selectedSource?.title === "string" ? selectedSource.title : "";
  const loadOfflineMedia = useCallback(async () => {
    const file = await getOfflineMediaFile(offlineKey);
    setOfflineMediaUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return file ? URL.createObjectURL(file) : null;
    });
  }, [offlineKey]);
  useEffect(() => {
    let active = true;
    getOfflineMediaFile(offlineKey)
      .then((file) => {
        if (active) {
          setOfflineMediaUrl(file ? URL.createObjectURL(file) : null);
        }
      })
      .catch(() => {
        if (active) {
          setOfflineMediaUrl(null);
        }
      });
    return () => {
      active = false;
      setOfflineMediaUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return null;
      });
    };
  }, [offlineKey]);
  // En TV NO se transcodifica en el navegador (mediabunny usa WebCodecs, inviable
  // en el procesador del TV): el <video> nativo de la TV decoda MKV/HEVC/AC-3
  // directo, así que le pasamos la URL cruda. mediabunny queda solo para el
  // navegador de escritorio, que no sabe abrir esos formatos.
  const isTv = useIsTv();
  const shouldUseMediaBunny = Boolean(
    !offlineMediaUrl &&
      !isTv &&
      sourceUrl &&
      needsMediaBunny(sourceFilename, sourceCodecHint)
  );
  const mediaBunny = useMediaBunny(
    shouldUseMediaBunny ? sourceUrl : null,
    sourceFilename,
    sourceCodecHint,
    mediaBunnyRetry
  );
  let activeSrc = offlineMediaUrl ?? sourceUrl ?? "";
  if (shouldUseMediaBunny) {
    activeSrc =
      mediaBunny.status === "streaming" || mediaBunny.status === "done"
        ? mediaBunny.src
        : "";
  }
  const mediaBunnyError =
    mediaBunny.status === "error" ? mediaBunny.message : null;
  useEffect(() => {
    setPlaybackRetry(0);
    setPlaybackError(null);
    setMediaBunnyRetry(0);
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, [activeSrc, sourceCodecHint, sourceUrl]);
  useEffect(
    () => () => {
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
      }
    },
    []
  );
  useEffect(() => {
    if (!mediaBunnyError) {
      return;
    }
    posthog.capture("mediabunny_playback_error", {
      content_id: contentId,
      content_type: contentType,
      error: mediaBunnyError,
      filename: sourceFilename,
      codec_hint: sourceCodecHint,
      retry: mediaBunnyRetry,
    });
    if (mediaBunnyRetry < MAX_PLAYBACK_RETRIES) {
      retryTimerRef.current = setTimeout(() => {
        setMediaBunnyRetry((current) => current + 1);
        retryTimerRef.current = null;
      }, 300);
    }
  }, [
    contentId,
    contentType,
    mediaBunnyError,
    mediaBunnyRetry,
    sourceCodecHint,
    sourceFilename,
  ]);
  const handlePlaybackError = useCallback(
    (error: Error) => {
      // An interrupted download can leave an unreadable cached blob. Do not
      // retry that same blob forever: discard it and resume from the source.
      if (offlineMediaUrl) {
        const invalidOfflineUrl = offlineMediaUrl;
        setOfflineMediaUrl(null);
        URL.revokeObjectURL(invalidOfflineUrl);
        void deleteOfflineMediaFile(offlineKey).catch((cleanupError) => {
          console.error("Could not remove invalid offline media:", cleanupError);
        });
        setPlaybackRetry(0);
        setPlaybackError(null);
        return;
      }
      posthog.capture("playback_error", {
        content_id: contentId,
        content_type: contentType,
        error: error.message,
        filename: sourceFilename,
        codec_hint: sourceCodecHint,
        retry: playbackRetry,
      });
      if (playbackRetry < MAX_PLAYBACK_RETRIES) {
        setIsBuffering(true);
        setPlaybackError(null);
        retryTimerRef.current = setTimeout(() => {
          setPlaybackRetry((current) => current + 1);
          retryTimerRef.current = null;
        }, 300);
        return;
      }
      setIsBuffering(false);
      setPlaybackError(error.message);
    },
    [
      contentId,
      contentType,
      offlineKey,
      offlineMediaUrl,
      playbackRetry,
      sourceCodecHint,
      sourceFilename,
    ]
  );
  // El <video> real y el objeto media del skin, que publica el player: los
  // selectores viven en la barra superior, fuera del contexto de `<Player>`.
  const [playerRefs, setPlayerRefs] = useState<{
    media: unknown;
    video: HTMLVideoElement | null;
  }>({ media: null, video: null });
  const handleMediaRef = useCallback(
    (refs: { media: unknown; video: HTMLVideoElement | null }) =>
      setPlayerRefs(refs),
    []
  );
  const browserTracks = useMediaTracks(playerRefs.video, playerRefs.media);
  // Subtítulos de los addons. Se piden aparte de los medios porque mediabunny
  // no expone las pistas incrustadas del archivo (su API solo lee vídeo y
  // audio), así que en la ruta MSE no habría ninguna. Montados como `<track>`
  // aparecen en `video.textTracks` y el selector los recoge igual que los
  // nativos, sin distinguir de dónde vienen.
  const [subtitles, setSubtitles] = useState<SubtitleTrackSource[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/stream/subtitles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rawId, type: contentType }),
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then((data: { subtitles?: { id: string; lang: string; url: string }[] }) => {
        const seenLabels = new Map<string, number>();
        setSubtitles(
          (data.subtitles ?? []).map((track) => {
            // Varias pistas del mismo idioma son lo normal; sin numerarlas el
            // menú muestra varias filas idénticas y no se sabe cuál se eligió.
            const base = trackLabel(undefined, track.lang, 0, "Subtítulos");
            const seen = (seenLabels.get(base) ?? 0) + 1;
            seenLabels.set(base, seen);
            return {
              id: track.id,
              label: seen > 1 ? `${base} (${seen})` : base,
              srcLang: track.lang,
              url: track.url,
            };
          })
        );
      })
      .catch(() => {
        /* sin subtítulos externos: quedan los que traiga el medio */
      });
    return () => controller.abort();
  }, [rawId, contentType]);
  // Las pistas de audio de mediabunny se nombran con el mismo formateador que
  // las nativas y las de HLS, para que el menú se lea igual venga de donde venga.
  const mediaBunnyAudioTracks = mediaBunny.audioTracks.map((track) => ({
    id: String(track.index),
    label: trackLabel(track.name ?? undefined, track.language, track.index, "Audio"),
  }));
  // En la ruta MSE el audio lo sirve mediabunny y el navegador no expone lista
  // alguna; en HLS y en reproducción nativa manda la del navegador.
  const usesMediaBunnyAudio = mediaBunnyAudioTracks.length > 0;
  const audioTracks = usesMediaBunnyAudio
    ? mediaBunnyAudioTracks
    : browserTracks.audioTracks;
  const activeAudioId = usesMediaBunnyAudio
    ? String(mediaBunny.activeAudioTrack)
    : browserTracks.activeAudioId;
  const handleSelectAudio = useCallback(
    (id: string) => {
      if (usesMediaBunnyAudio) {
        mediaBunny.selectAudioTrack(Number(id));
        return;
      }
      browserTracks.selectAudio(id);
    },
    [usesMediaBunnyAudio, mediaBunny.selectAudioTrack, browserTracks.selectAudio]
  );
  // El fondo se pinta a pantalla completa (1920+), así que pedimos la versión
  // grande a TMDB. El `contentBackground` original se mantiene para el progreso
  // guardado (tarjetas de Continuar viendo), que no necesita tanta resolución.
  const backgroundArt =
    tmdbImage(contentBackground, "original") ?? contentBackground;

  const { onTimeUpdate, onEnded, initialResume } = useWatchProgress({
    mediaId: contentId,
    mediaType: contentType,
    season,
    episode,
    name: contentTitle,
    poster: _contentPoster,
    background: contentBackground,
  });

  const isSeries = contentType === "series";
  const nextEpisode = useNextEpisode(contentId, season, episode, isSeries);
  // Booleano y no el tiempo restante: el `timeupdate` llega ~4 veces por
  // segundo y guardar los segundos aquí re-renderizaría el player entero en
  // cada tick. Así solo hay render al cruzar el umbral.
  const [nearEnd, setNearEnd] = useState(false);
  const handleTimeUpdate = useCallback(
    (currentSec: number, durationSec: number) => {
      onTimeUpdate(currentSec, durationSec);
      const remaining = durationSec - currentSec;
      setNearEnd(
        durationSec > 0 && remaining > 0 && remaining <= nextEpisodeLead(durationSec)
      );
    },
    // `onTimeUpdate` viene de useWatchProgress y es estable (useCallback).
    [onTimeUpdate]
  );
  const handlePlayNext = useCallback(
    (next: NextEpisodeRef, source: StreamWithAddon) => {
      // El player de destino lee su medio de `sessionStorage` (misma clave que
      // usa el botón Reproducir del detalle), así que hay que dejarlo puesto
      // antes de navegar.
      try {
        sessionStorage.setItem(
          `stream-source-series-${next.playId}`,
          JSON.stringify(source)
        );
      } catch {
        /* sessionStorage lleno o bloqueado: la página lo dirá al montar */
      }
      router.push(`/home/player/series/${next.playId}`);
    },
    [router]
  );
  const handleEpisodeSelect = useCallback(
    (next: NextEpisodeRef, source: StreamWithAddon) => {
      try {
        sessionStorage.setItem(
          `stream-source-series-${next.playId}`,
          JSON.stringify(source)
        );
      } catch {
        /* sessionStorage lleno o bloqueado: la página lo dirá al montar */
      }
      router.push(`/home/player/series/${next.playId}`);
    },
    [router]
  );

  // Posición a la que saltar cuando arranque un medio recién elegido desde el
  // selector (cambio de medio en caliente): se guarda el currentTime justo
  // antes de cambiar la fuente y se aplica una vez, en el primer `playing`.
  const pendingSeekSec = useRef<number | null>(null);
  const handleSourceChange = useCallback((source: StreamWithAddon) => {
    const vid = document.querySelector<HTMLVideoElement>(
      ".stream-video-player-root video"
    );
    pendingSeekSec.current =
      vid && Number.isFinite(vid.currentTime) && vid.currentTime > 0
        ? vid.currentTime
        : null;
    setSelectedSource(source);
  }, []);
  // Resume seek is async (position comes from the server), so apply it in an
  // effect once both the saved position and the <video> element are ready,
  // guarded so we only seek once and don't fight the user scrubbing.
  const hasResumed = useRef(false);
  useEffect(() => {
    if (hasResumed.current || !hasPlayed || !initialResume) {
      return;
    }
    // Un cambio de medio en caliente ya dejó su propio seek pendiente; el
    // resume del arranque no debe pisarlo.
    if (pendingSeekSec.current !== null) {
      hasResumed.current = true;
      return;
    }
    if (initialResume.positionSec > 10) {
      const vid = document.querySelector<HTMLVideoElement>(
        ".stream-video-player-root video"
      );
      if (vid) {
        vid.currentTime = initialResume.positionSec;
      }
    }
    hasResumed.current = true;
  }, [hasPlayed, initialResume]);

  // Seek en la ruta MSE: mediabunny transcodifica de forma secuencial, así que el
  // <video> no puede saltar más allá de lo ya transcodificado (se quedaría
  // esperando para siempre). Cuando el usuario salta FUERA del buffer, se reinicia
  // la transcodificación en esa posición; si el destino ya está buffereado, el
  // <video> lo resuelve solo. Esto arregla también el resume a posición tardía y
  // el seek tras un cambio de medio en caliente, que pasan por el mismo camino.
  useEffect(() => {
    const video = playerRefs.video;
    if (!(video && shouldUseMediaBunny)) {
      return;
    }
    const onSeeking = () => {
      const target = video.currentTime;
      if (!Number.isFinite(target)) {
        return;
      }
      const ranges = video.buffered;
      for (let i = 0; i < ranges.length; i++) {
        if (target >= ranges.start(i) - 0.5 && target <= ranges.end(i) + 0.5) {
          return; // ya buffereado: lo maneja el <video> nativo
        }
      }
      mediaBunny.seekTo(target);
    };
    video.addEventListener("seeking", onSeeking);
    return () => video.removeEventListener("seeking", onSeeking);
  }, [playerRefs.video, shouldUseMediaBunny, mediaBunny.seekTo]);
  // Fetch logo client-side if not provided by server
  useEffect(() => {
    if (logo) {
      return;
    }

    getTmdbLogo(contentType, contentId)
      .then((logoResult) => {
        if (logoResult) {
          setLogo(logoResult);
        }
      })
      .catch(() => {
        /* logo fetch failed, fall back to title */
      });
  }, [logo, contentId, contentType]);

  // On mount, try to read from sessionStorage
  useEffect(() => {
    if (triedSessionStorage.current) {
      return;
    }
    triedSessionStorage.current = true;

    if (selectedSource) {
      return;
    }

    try {
      const key = `stream-source-${contentType}-${rawId}`;
      const raw = sessionStorage.getItem(key);
      if (raw) {
        sessionStorage.removeItem(key);
        const source = JSON.parse(raw) as StreamWithAddon;
        setSelectedSource(source);
        setSelectedMimeType(
          getMimeType(typeof source.url === "string" ? source.url : "")
        );
      }
    } catch {
      // ignore
    }
  }, [contentType, rawId, selectedSource]);

  // Sync mimeType when selectedSource changes
  useEffect(() => {
    if (selectedSource) {
      setSelectedMimeType(
        getMimeType(
          typeof selectedSource.url === "string" ? selectedSource.url : ""
        )
      );
    }
  }, [selectedSource]);

  // No source found
  if (!selectedSource) {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-center bg-cover bg-no-repeat"
        style={
          backgroundArt
            ? { backgroundImage: `url(${backgroundArt})` }
            : { backgroundColor: "#000" }
        }
      >
        <div className="flex flex-col items-center gap-4 rounded-lg bg-black/60 p-6 backdrop-blur-sm">
          <p className="text-sm text-white">
            No se pudo cargar la fuente de reproduccion.
          </p>
          <Link href={backHref} onClick={handleBack}>
            <Button size="sm" variant="outline">
              <ArrowLeftIcon className="mr-2 size-4" />
              Volver al catalogo
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Player
  return (
    <div className="group/player fixed inset-0 z-50 flex flex-col bg-gray-950">
      <PlayerTopBar
        backHref={backHref}
        contentTitle={contentTitle}
        downloadButton={
          !isTv && sourceUrl ? (
            <PlayerDownloadButton
              codecHint={sourceCodecHint}
              filename={sourceFilename}
              onSaved={loadOfflineMedia}
              storageKey={offlineKey}
              url={sourceUrl}
            />
          ) : null
        }
        handleBack={handleBack}
        visible={arePlayerControlsVisible}
        trackPicker={
          <StreamTrackPicker
            activeAudioId={activeAudioId}
            activeSubtitleId={browserTracks.activeSubtitleId}
            audioTracks={audioTracks}
            onSelectAudio={handleSelectAudio}
            onSelectSubtitle={browserTracks.selectSubtitle}
            subtitleTracks={browserTracks.subtitleTracks}
          />
        }
        episodePicker={
          isSeries ? (
            <StreamEpisodePicker
              episode={episode}
              onSelect={handleEpisodeSelect}
              poster={_contentPoster}
              season={season}
              seriesId={contentId}
            />
          ) : null
        }
        sourcePicker={
          <StreamSourcePicker
            activeSource={selectedSource}
            contentId={rawId}
            contentType={contentType}
            onSelect={handleSourceChange}
          />
        }
      />

      <div className="relative min-h-0 w-full flex-1">
        {/* Fondo oscuro de carga: solo cuando hay trabajo real pendiente —
            transcodificación en curso o buffering activo — no al montar el
            player (si el medio es nativo y arranca al instante, no se muestra). */}
        {(isBuffering || mediaBunny.status === "processing") && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/30">
            {backgroundArt && (
              // biome-ignore lint/performance/noImgElement: external CDN background
              <img
                alt=""
                className="absolute inset-0 size-full object-cover opacity-40"
                height={1080}
                src={backgroundArt}
                width={1920}
              />
            )}
            <div className="relative z-10 flex items-center gap-4">
              {renderLogoCenter({ logo, contentTitle })}
            </div>
          </div>
        )}

        {(mediaBunny.status === "error" || playbackError) && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/80">
            <p className="px-6 text-center text-destructive text-sm">
              {playbackError ??
                (mediaBunny.status === "error" ? mediaBunny.message : "")}
            </p>
          </div>
        )}
        {activeSrc && (
          <VideoJsStreamPlayer
            // Al cambiar de medio el <video> debe desmontarse y volver a
            // montarse: sin `key` React reutiliza el elemento y el arranque
            // del nuevo src queda a merced de cómo lo propague videojs.
            key={`${activeSrc}:${playbackRetry}`}
            autoPlay={true}
            controls={false}
            isPlayMode={true}
            mimeType={
              shouldUseMediaBunny ? "video/mp4" : selectedMimeType
            }
            onEnded={onEnded}
            onLoadStart={() => setIsBuffering(true)}
            onMediaRef={handleMediaRef}
            onError={handlePlaybackError}
            onPlaying={() => {
              setIsBuffering(false);
              setHasPlayed(true);
              if (pendingSeekSec.current !== null) {
                const vid = document.querySelector<HTMLVideoElement>(
                  ".stream-video-player-root video"
                );
                if (vid) {
                  vid.currentTime = pendingSeekSec.current;
                }
                pendingSeekSec.current = null;
              }
            }}
            onTimeUpdate={handleTimeUpdate}
            onControlsVisibility={handleControlsVisibility}
            onWaiting={() => setIsBuffering(true)}
            src={activeSrc}
            subtitles={subtitles}
          />
        )}
        {nearEnd && nextEpisode && (
          <StreamNextEpisode next={nextEpisode} onPlay={handlePlayNext} />
        )}
      </div>
    </div>
  );
}
