"use client";

import { Button } from "@workspace/ui/components/button";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  type NextEpisodeRef,
  StreamNextEpisode,
} from "@/components/stream/stream-next-episode";
import { StreamSourcePicker } from "@/components/stream/stream-source-picker";
import { StreamTrackPicker } from "@/components/stream/stream-track-picker";
import {
  type SubtitleTrackSource,
  VideoJsStreamPlayer,
} from "@/components/stream/video-js-stream-player";
import { trackLabel, useMediaTracks } from "@/hooks/use-media-tracks";
import { useMediaBunny } from "@/hooks/use-mediabunny";
import { useNextEpisode } from "@/hooks/use-next-episode";
import { useWatchProgress } from "@/hooks/use-video-progress";
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
  sourcePicker,
  trackPicker,
}: {
  backHref: string;
  contentTitle: string;
  handleBack: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  sourcePicker?: React.ReactNode;
  trackPicker?: React.ReactNode;
}) {
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 py-3 opacity-0 transition-opacity duration-300 group-hover/player:opacity-100">
      <Link
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
        href={backHref}
        onClick={handleBack}
      >
        <ArrowLeftIcon className="size-5" />
      </Link>
      <h1 className="min-w-0 flex-1 truncate font-medium text-base text-white">
        {contentTitle}
      </h1>
      {trackPicker}
      {sourcePicker}
    </div>
  );
});

// Antelación con la que aparece el botón de "siguiente episodio". En un
// episodio corto 75 s serían casi el final entero, así que se recorta a una
// fracción de su duración real.
const NEXT_EPISODE_LEAD_SEC = 75;

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
  const backHref = "/home";
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
  const shouldUseMediaBunny = Boolean(
    sourceUrl && needsMediaBunny(sourceFilename, sourceCodecHint)
  );
  const mediaBunny = useMediaBunny(
    shouldUseMediaBunny ? sourceUrl : null,
    sourceFilename,
    sourceCodecHint
  );
  let activeSrc = sourceUrl ?? "";
  if (shouldUseMediaBunny) {
    // `streaming` = reproducción progresiva ya en curso (MediaSource); `done`
    // = transcode completo listo (blob). Ambos traen una `src` reproducible.
    activeSrc =
      mediaBunny.status === "streaming" || mediaBunny.status === "done"
        ? mediaBunny.src
        : "";
  }
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
  const R = 16;
  const C = 2 * Math.PI * R;
  const mbProgress =
    mediaBunny.status === "processing" ? mediaBunny.progress : 0;
  const mbOffset = C - mbProgress * C;

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
          contentBackground
            ? { backgroundImage: `url(${contentBackground})` }
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
        handleBack={handleBack}
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
            {contentBackground && (
              // biome-ignore lint/performance/noImgElement: external CDN background
              <img
                alt=""
                className="absolute inset-0 size-full object-cover opacity-40"
                height={1080}
                src={contentBackground}
                width={1920}
              />
            )}
            <div className="relative z-10 flex items-center gap-4">
              {renderLogoCenter({ logo, contentTitle })}
              {mediaBunny.status === "processing" && (
                <svg className="shrink-0 drop-shadow-lg" height="44" width="44">
                  <title>Progreso de transcodificación</title>
                  <circle
                    cx="22"
                    cy="22"
                    fill="rgba(0,0,0,0.5)"
                    r={R}
                    stroke="rgba(255,255,255,0.2)"
                    strokeWidth="3"
                  />
                  <circle
                    className="transition-all duration-300"
                    cx="22"
                    cy="22"
                    fill="none"
                    r={R}
                    stroke="white"
                    strokeDasharray={C}
                    strokeDashoffset={mbOffset}
                    strokeLinecap="round"
                    strokeWidth="3"
                    transform="rotate(-90 22 22)"
                  />
                  <text
                    fill="white"
                    fontFamily="sans-serif"
                    fontSize="9"
                    fontWeight="600"
                    textAnchor="middle"
                    x="22"
                    y="26"
                  >
                    {Math.round(mbProgress * 100)}%
                  </text>
                </svg>
              )}
            </div>
          </div>
        )}

        {mediaBunny.status === "error" && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/80">
            <p className="px-6 text-center text-destructive text-sm">
              {mediaBunny.message}
            </p>
          </div>
        )}
        {activeSrc && (
          <VideoJsStreamPlayer
            // Al cambiar de medio el <video> debe desmontarse y volver a
            // montarse: sin `key` React reutiliza el elemento y el arranque
            // del nuevo src queda a merced de cómo lo propague videojs.
            key={activeSrc}
            autoPlay={true}
            controls={false}
            isPlayMode={true}
            mimeType={
              shouldUseMediaBunny ? "video/mp4" : selectedMimeType
            }
            onEnded={onEnded}
            onLoadStart={() => setIsBuffering(true)}
            onMediaRef={handleMediaRef}
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
