"use client";

import { Button } from "@workspace/ui/components/button";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { VideoJsStreamPlayer } from "@/components/stream/video-js-stream-player";
import { useMediaBunny } from "@/hooks/use-mediabunny";
import { useWatchProgress } from "@/hooks/use-video-progress";
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
        className="relative z-10 h-auto max-h-[20vh] w-auto max-w-[60vw] animate-pulse object-contain drop-shadow-2xl"
        height={0}
        src={logo}
        width={0}
      />
    );
  }
  return (
    <h2 className="relative z-10 max-w-[80vw] animate-pulse text-center font-semibold text-3xl text-white drop-shadow-2xl md:text-5xl">
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
}: {
  backHref: string;
  contentTitle: string;
  handleBack: (e: React.MouseEvent<HTMLAnchorElement>) => void;
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
      <h1 className="truncate font-medium text-base text-white">
        {contentTitle}
      </h1>
    </div>
  );
});

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
  const backHref = `/home?movie=${encodeURIComponent(contentId)}&movieType=${contentType}`;
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
  const [isBuffering, setIsBuffering] = useState(true);
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
  const mediaBunny = useMediaBunny(
    sourceUrl && needsMediaBunny(sourceFilename) ? sourceUrl : null,
    sourceFilename
  );
  let activeSrc = sourceUrl ?? "";
  if (sourceUrl && needsMediaBunny(sourceFilename)) {
    // `streaming` = reproducción progresiva ya en curso (MediaSource); `done`
    // = transcode completo listo (blob). Ambos traen una `src` reproducible.
    activeSrc =
      mediaBunny.status === "streaming" || mediaBunny.status === "done"
        ? mediaBunny.src
        : "";
  }
  const { onTimeUpdate, onEnded, initialResume } = useWatchProgress({
    mediaId: contentId,
    mediaType: contentType,
    season,
    episode,
    name: contentTitle,
    poster: _contentPoster,
    background: contentBackground,
  });
  // Resume seek is async (position comes from the server), so apply it in an
  // effect once both the saved position and the <video> element are ready,
  // guarded so we only seek once and don't fight the user scrubbing.
  const hasResumed = useRef(false);
  useEffect(() => {
    if (hasResumed.current || !hasPlayed || !initialResume) {
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

    fetch(
      `/api/tmdb-logo?id=${encodeURIComponent(contentId)}&type=${contentType}`
    )
      .then((res) => (res.ok ? res.json() : { logo: null }))
      .then((data: { logo: string | null }) => {
        if (data.logo) {
          setLogo(data.logo);
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
        className="fixed inset-x-0 top-0 z-50 flex h-dvh flex-col items-center justify-center gap-4 bg-center bg-cover bg-no-repeat"
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
    <div className="group/player fixed inset-x-0 top-0 z-50 flex h-dvh flex-col bg-gray-950">
      <PlayerTopBar
        backHref={backHref}
        contentTitle={contentTitle}
        handleBack={handleBack}
      />

      <div className="relative min-h-0 w-full flex-1">
        {/* Logo overlay shown until the video actually plays */}
        {(!hasPlayed || isBuffering) && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/30">
            {contentBackground && (
              // biome-ignore lint/performance/noImgElement: external CDN background
              <img
                alt=""
                className="absolute inset-0 size-full object-cover opacity-40 blur-xl"
                height={1080}
                src={contentBackground}
                width={1920}
              />
            )}
            {renderLogoCenter({ logo, contentTitle })}
          </div>
        )}

        {mediaBunny.status === "error" && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/80">
            <p className="px-6 text-center text-destructive text-sm">
              {mediaBunny.message}
            </p>
          </div>
        )}
        {mediaBunny.status === "processing" && (
          <div className="absolute top-4 right-4 z-20 flex items-center justify-center">
            <svg className="drop-shadow-lg" height="44" width="44">
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
          </div>
        )}
        {activeSrc && (
          <VideoJsStreamPlayer
            autoPlay={true}
            controls={false}
            fullscreenOnPlay={false}
            isPlayMode={true}
            mimeType={
              needsMediaBunny(sourceFilename) ? "video/mp4" : selectedMimeType
            }
            onEnded={onEnded}
            onLoadStart={() => setIsBuffering(true)}
            onPlaying={() => {
              setIsBuffering(false);
              setHasPlayed(true);
            }}
            onTimeUpdate={onTimeUpdate}
            onWaiting={() => setIsBuffering(true)}
            src={activeSrc}
          />
        )}
      </div>
    </div>
  );
}
