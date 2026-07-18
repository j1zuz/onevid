"use client";
import { Button } from "@workspace/ui/components/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@workspace/ui/components/drawer";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import {
  ArrowLeftIcon,
  Bookmark,
  CheckIcon,
  ChevronDownIcon,
  Film,
  Heart,
  Play,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useOneVidProfiles } from "@/components/stream/onevid-profile-context";
import { WatchProvidersNotice } from "@/components/watch-providers-notice";
import type { MediaMeta } from "@/lib/tmdb";
import type { StreamWithAddon } from "@/types/stream";

interface EpisodeItem {
  description?: string;
  id: string;
  name: string;
  number: number;
  released?: string;
  season: number;
  thumbnail?: string;
}

interface ExploreMovieDialogProps {
  children?: React.ReactNode;
  defaultOpen?: boolean;
  movie: MediaMeta;
  onPlay?: () => void;
}

function getGenresArray(movie: MediaMeta): string[] {
  if (Array.isArray(movie.genres)) {
    return movie.genres;
  }
  return [];
}

function formatDate(dateStr?: string): string {
  if (!dateStr) {
    return "";
  }
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function getStreamLines(source: StreamWithAddon): string[] {
  const behaviors = Array.isArray(source.behaviors) ? source.behaviors : [];
  return [
    source.title,
    source.description,
    source.name,
    ...behaviors,
  ].filter((line): line is string => Boolean(line?.trim()));
}

function SourceOption({
  source,
  onPlay,
}: {
  onPlay: (source: StreamWithAddon) => void;
  source: StreamWithAddon;
}) {
  const lines = getStreamLines(source);

  return (
    // biome-ignore lint/a11y/useSemanticElements: clickable list item needs div for layout
    <div
      className={cn(
        "group/source relative cursor-pointer rounded-lg border p-2.5 text-left outline-none transition-[border-color,box-shadow,filter]",
        "border-border/50 bg-background"
      )}
      data-dpad-focusable
      onClick={() => onPlay(source)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPlay(source);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          {lines.map((line, index) => (
            <p
              className={cn(
                "whitespace-pre-line text-xs leading-relaxed",
                index === 0
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              )}
              // biome-ignore lint/suspicious/noArrayIndexKey: stream metadata is static text from addon
              key={index}
            >
              {line}
            </p>
          ))}
        </div>
        <div className="shrink-0 opacity-0 transition-opacity duration-200 group-hover/source:opacity-100 group-focus/source:opacity-100">
          <div className="flex size-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
            <Play className="size-3.5 fill-current" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Lightweight shell: owns only open/close state and the Drawer chrome. The
// catalog grid mounts one of these per poster (dozens at once), so keeping
// it cheap matters — every fetch, effect, and piece of state for the
// drawer's actual content lives in `MovieDialogContent` below, which is
// only ever mounted once the drawer has been opened at least once. Before
// that, a closed card costs React nothing beyond this shell's single
// `isOpen`/`hasOpened` state.
export function ExploreMovieDialog({
  movie,
  onPlay,
  children,
  defaultOpen = false,
}: ExploreMovieDialogProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [hasOpened, setHasOpened] = useState(defaultOpen);

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
    if (open) {
      setHasOpened(true);
    }
  }, []);

  return (
    <div className={cn("group relative", children && "h-full w-full")}>
      {children && (
        // biome-ignore lint/a11y/useSemanticElements: clickable card wrapper needs div for layout
        <div
          className="h-full w-full cursor-pointer rounded-(--radius)"
          data-dpad-focusable
          onClick={() => handleOpenChange(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleOpenChange(true);
            }
          }}
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") {
              e.currentTarget.focus({ preventScroll: true });
            }
          }}
          role="button"
          tabIndex={0}
        >
          {children}
        </div>
      )}

      <Drawer onOpenChange={handleOpenChange} open={isOpen} swipeDirection="right">
        <DrawerContent>
          {hasOpened && (
            <MovieDialogContent isOpen={isOpen} movie={movie} onPlay={onPlay} />
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex dialog with source fetching and state management
function MovieDialogContent({
  movie,
  onPlay,
  isOpen,
}: {
  isOpen: boolean;
  movie: MediaMeta;
  onPlay?: () => void;
}) {
  const { push } = useRouter();
  const { activeProfileId } = useOneVidProfiles();

  // Series state
  const [seasons, setSeasons] = useState<number[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeItem[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesLoaded, setSeriesLoaded] = useState(false);

  // Logo state
  const [logo, setLogo] = useState<string | undefined>(movie.logo);
  const [logoLoaded, setLogoLoaded] = useState(Boolean(movie.logo));

  // Trailer state (YouTube key from TMDB, cargado al abrir)
  const [trailerKey, setTrailerKey] = useState<string | null>(null);
  const [trailerLoaded, setTrailerLoaded] = useState(false);
  const [showTrailer, setShowTrailer] = useState(false);

  // Favorite / watchlist state (per active profile, stored in hackw)
  const [favorite, setFavorite] = useState(false);
  const [watchlist, setWatchlist] = useState(false);
  const [savingFavorite, setSavingFavorite] = useState(false);
  const [savingWatchlist, setSavingWatchlist] = useState(false);

  // Sources state
  const [sources, setSources] = useState<StreamWithAddon[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const sourcesAbortRef = useRef<AbortController | null>(null);

  // Episode selected state — show sources inline
  const [selectedEpisode, setSelectedEpisode] = useState<EpisodeItem | null>(
    null
  );
  const [seasonDropdownOpen, setSeasonDropdownOpen] = useState(false);
  const seasonDropdownRef = useRef<HTMLDivElement>(null);

  const isSeries = movie.type === "series";
  const genres = getGenresArray(movie);

  const filteredEpisodes =
    selectedSeason === null
      ? []
      : episodes.filter((ep) => ep.season === selectedSeason);

  // Fetch logo when dialog opens (if not already loaded)
  useEffect(() => {
    if (!isOpen || logoLoaded) {
      return;
    }
    const controller = new AbortController();
    fetch(
      `/api/tmdb-logo?id=${encodeURIComponent(movie.id)}&type=${movie.type}`,
      {
        signal: controller.signal,
      }
    )
      .then((res) => (res.ok ? res.json() : { logo: null }))
      .then((data: { logo: string | null }) => {
        if (data.logo) {
          setLogo(data.logo);
        }
        setLogoLoaded(true);
      })
      .catch((err: unknown) => {
        // An aborted fetch (StrictMode's dev-only mount→cleanup→remount, or a
        // real unmount) must NOT mark this loaded — a fresh, un-aborted fetch
        // is about to run right after and needs the chance to actually
        // resolve. Locking logoLoaded=true here permanently blanks the logo,
        // since the effect bails out early on every future run once it's set.
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setLogoLoaded(true);
      });
    return () => controller.abort();
  }, [isOpen, logoLoaded, movie.id, movie.type]);

  // Fetch trailer key when dialog opens.
  useEffect(() => {
    if (!isOpen || trailerLoaded) {
      return;
    }
    const controller = new AbortController();
    fetch(
      `/api/tmdb-trailer?id=${encodeURIComponent(movie.id)}&type=${movie.type}`,
      { signal: controller.signal }
    )
      .then((res) => (res.ok ? res.json() : { trailer: null }))
      .then((data: { trailer: string | null }) => {
        setTrailerKey(data.trailer);
        setTrailerLoaded(true);
      })
      .catch((err: unknown) => {
        // Same abort-race as the logo fetch above: an aborted request (dev
        // StrictMode mount→cleanup→remount) must not lock trailerLoaded, or
        // the real follow-up fetch never gets to show its result.
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setTrailerLoaded(true);
      });
    return () => controller.abort();
  }, [isOpen, trailerLoaded, movie.id, movie.type]);

  // Al cerrar el diálogo, ocultar el tráiler (desmonta el iframe y corta el
  // audio/vídeo).
  useEffect(() => {
    if (!isOpen) {
      setShowTrailer(false);
    }
  }, [isOpen]);

  // Cerrar el overlay del tráiler con Escape.
  useEffect(() => {
    if (!showTrailer) {
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setShowTrailer(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showTrailer]);

  // Load favorite / watchlist state for the active profile when opened.
  useEffect(() => {
    if (!(isOpen && activeProfileId)) {
      return;
    }
    const controller = new AbortController();
    fetch(
      `/api/onevid-saved-status?mediaType=${movie.type}&mediaId=${encodeURIComponent(movie.id)}`,
      {
        signal: controller.signal,
        headers: { "X-Profile-Id": activeProfileId },
      }
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { favorite?: boolean; watchlist?: boolean } | null) => {
        if (data) {
          setFavorite(Boolean(data.favorite));
          setWatchlist(Boolean(data.watchlist));
        }
      })
      .catch(() => {
        // no profile / network — leave defaults
      });
    return () => controller.abort();
  }, [isOpen, activeProfileId, movie.id, movie.type]);

  const toggleFavorite = useCallback(async () => {
    if (!activeProfileId) {
      toast.error("Selecciona o crea un perfil");
      return;
    }
    const next = !favorite;
    setFavorite(next);
    setSavingFavorite(true);
    try {
      const res = await fetch("/api/onevid-favorite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Profile-Id": activeProfileId,
        },
        body: JSON.stringify({
          mediaId: movie.id,
          mediaType: movie.type,
          value: next,
          name: movie.name,
          poster: movie.poster,
          background: movie.background,
          year: movie.year,
        }),
      });
      if (!res.ok) {
        setFavorite(!next);
      }
    } catch {
      setFavorite(!next);
    } finally {
      setSavingFavorite(false);
    }
  }, [activeProfileId, favorite, movie]);

  const toggleWatchlist = useCallback(async () => {
    if (!activeProfileId) {
      toast.error("Selecciona o crea un perfil");
      return;
    }
    const next = !watchlist;
    setWatchlist(next);
    setSavingWatchlist(true);
    try {
      const res = await fetch("/api/onevid-watchlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Profile-Id": activeProfileId,
        },
        body: JSON.stringify({
          mediaId: movie.id,
          mediaType: movie.type,
          value: next,
          name: movie.name,
          poster: movie.poster,
          background: movie.background,
          year: movie.year,
        }),
      });
      if (!res.ok) {
        setWatchlist(!next);
      }
    } catch {
      setWatchlist(!next);
    } finally {
      setSavingWatchlist(false);
    }
  }, [activeProfileId, watchlist, movie]);

  // Load series metadata
  const loadSeriesMeta = useCallback(async () => {
    if (seriesLoaded || seriesLoading) {
      return;
    }
    setSeriesLoading(true);
    try {
      const res = await fetch(
        `/api/series-meta?id=${encodeURIComponent(movie.id)}`
      );
      if (res.ok) {
        const data = (await res.json()) as {
          seasons: number[];
          episodes: EpisodeItem[];
        };
        setSeasons(data.seasons);
        setEpisodes(data.episodes);
        if (data.seasons.length > 0) {
          setSelectedSeason(data.seasons[0]);
        }
        setSeriesLoaded(true);
      }
    } catch {
      // ignore
    } finally {
      setSeriesLoading(false);
    }
  }, [movie.id, seriesLoaded, seriesLoading]);

  // Load streams for a given ID
  const loadSources = useCallback(
    async (streamId: string) => {
      sourcesAbortRef.current?.abort();
      const controller = new AbortController();
      sourcesAbortRef.current = controller;

      setSources([]);
      setSourcesLoaded(false);
      setSourcesLoading(true);
      try {
        const res = await fetch("/api/stream/sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: streamId, type: movie.type }),
          signal: controller.signal,
        });

        if (res.ok) {
          const data = (await res.json()) as {
            sources?: StreamWithAddon[];
          };
          setSources(data.sources ?? []);
          setSourcesLoaded(true);
        }
      } catch {
        // Ignore abort or network errors
      } finally {
        if (!controller.signal.aborted) {
          setSourcesLoading(false);
        }
      }
    },
    [movie.type]
  );

  useEffect(
    () => () => {
      sourcesAbortRef.current?.abort();
    },
    []
  );

  // Close season dropdown on outside click
  useEffect(() => {
    if (!seasonDropdownOpen) {
      return;
    }
    function handleClickOutside(e: MouseEvent) {
      if (
        seasonDropdownRef.current &&
        !seasonDropdownRef.current.contains(e.target as Node)
      ) {
        setSeasonDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [seasonDropdownOpen]);

  const handlePlay = (source: StreamWithAddon) => {
    const playId = selectedEpisode?.id ?? movie.id;
    const key = `stream-source-${movie.type}-${playId}`;
    sessionStorage.setItem(key, JSON.stringify(source));
    if (selectedEpisode) {
      const title = `${movie.name} - S${selectedEpisode.season}E${selectedEpisode.number} ${selectedEpisode.name}`;
      try {
        sessionStorage.setItem(
          `stream-episode-title-${selectedEpisode.id}`,
          title
        );
      } catch {
        // ignore
      }
    }
    push(`/home/detail/${movie.type}/${playId}`);
    onPlay?.();
  };

  const handleEpisodeClick = (episode: EpisodeItem) => {
    setSelectedEpisode(episode);
    setSources([]);
    setSourcesLoaded(false);
    loadSources(episode.id);
  };

  // Auto-load series metadata when drawer opens
  useEffect(() => {
    if (isOpen && isSeries && !seriesLoaded && !seriesLoading) {
      loadSeriesMeta();
    }
  }, [isOpen, isSeries, seriesLoaded, seriesLoading, loadSeriesMeta]);

  // Auto-load movie sources when drawer opens
  useEffect(() => {
    if (isOpen && !isSeries && !sourcesLoaded && !sourcesLoading) {
      loadSources(movie.id);
    }
  }, [isOpen, isSeries, sourcesLoaded, sourcesLoading, loadSources, movie.id]);

  return (
    <>
      <div
        className="mx-auto flex w-full max-w-sm flex-col overflow-hidden"
        style={{ height: "min(80vh, 100dvh - 3rem)" }}
      >
        <DrawerHeader className="shrink-0">
          {/* Fixed h-12 box for both the skeleton and the loaded logo: the
              logo's own aspect ratio (unknown until decoded) must not
              resize this box, or the header jumps once the image loads. */}
          <div className="mx-auto mb-1 flex h-12 items-center justify-center">
            {!logoLoaded && (
              <div className="h-full w-40 animate-pulse rounded bg-muted" />
            )}
            {logoLoaded && logo && (
              // biome-ignore lint/performance/noImgElement: external CDN logo
              <img
                alt={movie.name}
                className="h-full w-auto object-contain"
                src={logo}
              />
            )}
          </div>
          <DrawerTitle className={logo ? "sr-only" : ""}>
            {movie.name}
          </DrawerTitle>
          <DrawerDescription>
            <span className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
              {movie.year && <span>{movie.year}</span>}
              {movie.imdbRating && (
                <>
                  <span>•</span>
                  <span className="font-medium text-yellow-500/80">
                    ★ {movie.imdbRating}
                  </span>
                </>
              )}
              {movie.type && (
                <>
                  <span>•</span>
                  <span className="capitalize">
                    {movie.type === "series" ? "Series" : "Movie"}
                  </span>
                </>
              )}
            </span>
          </DrawerDescription>
          <div className="mt-2 flex items-center justify-center gap-2">
            <Button
              data-dpad-focusable
              disabled={savingFavorite}
              onClick={toggleFavorite}
              size="sm"
              variant="outline"
            >
              <Heart
                className={cn(
                  "size-3.5",
                  favorite && "fill-red-500 text-red-500"
                )}
              />
              Favorito
            </Button>
            <Button
              className={cn(watchlist && "btn-primary")}
              data-dpad-focusable
              disabled={savingWatchlist}
              onClick={toggleWatchlist}
              size="sm"
              variant={watchlist ? "default" : "outline"}
            >
              <Bookmark
                className={cn("size-3.5", watchlist && "fill-current")}
              />
              Ver después
            </Button>
            {!trailerLoaded && <Skeleton className="h-6 w-20 rounded-md" />}
            {trailerLoaded && trailerKey && (
              <Button
                data-dpad-focusable
                onClick={() => setShowTrailer((v) => !v)}
                size="sm"
                variant={showTrailer ? "default" : "outline"}
              >
                <Film className="size-3.5" />
                Tráiler
              </Button>
            )}
          </div>
        </DrawerHeader>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4">
          <div className="space-y-4">
            {/* Genres */}
            {genres.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {genres.slice(0, 3).map((genre) => (
                  <span
                    className={cn(
                      "inline-flex items-center",
                      "rounded-full px-2 py-1",
                      "bg-muted text-muted-foreground",
                      "font-medium text-xs"
                    )}
                    key={genre}
                  >
                    {genre}
                  </span>
                ))}
                {genres.length > 3 && (
                  <span className="inline-flex items-center px-2 py-1 text-muted-foreground text-xs">
                    +{genres.length - 3}
                  </span>
                )}
              </div>
            )}

            {/* Description */}
            {movie.description && (
              <p className="line-clamp-2 text-muted-foreground text-xs leading-relaxed">
                {movie.description}
              </p>
            )}

            {/* === SERIES === */}
            {isSeries && (
              <div className="space-y-3">
                {selectedEpisode ? (
                  <>
                    {/* Episode selected — show back button + episode title + sources */}
                    <div className="flex items-center gap-2">
                      <button
                        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        onClick={() => {
                          setSelectedEpisode(null);
                          setSources([]);
                          setSourcesLoaded(false);
                        }}
                        type="button"
                      >
                        <ArrowLeftIcon className="size-4" />
                      </button>
                      <p className="min-w-0 truncate font-medium text-foreground text-sm">
                        S{selectedEpisode.season}E{selectedEpisode.number} -{" "}
                        {selectedEpisode.name}
                      </p>
                    </div>

                    <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                      Medios disponibles
                    </p>

                    {sourcesLoading && (
                      <div className="space-y-1.5">
                        {["a", "b", "c"].map((key) => (
                          <div
                            className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background p-2.5"
                            key={key}
                          >
                            <Skeleton className="h-3 w-3/4" />
                            <Skeleton className="size-6 shrink-0 rounded-full" />
                          </div>
                        ))}
                      </div>
                    )}

                    {!sourcesLoading &&
                      sourcesLoaded &&
                      sources.length === 0 && (
                        <WatchProvidersNotice
                          fallback={
                            <div className="rounded-lg border border-border/50 bg-muted/50 p-3">
                              <p className="text-muted-foreground text-xs">
                                No hay fuentes disponibles para este episodio.
                              </p>
                            </div>
                          }
                          id={movie.id}
                          title={movie.name}
                          type={movie.type}
                          year={movie.year}
                        />
                      )}

                    {!sourcesLoading &&
                      sourcesLoaded &&
                      sources.length > 0 && (
                        <div className="space-y-1.5">
                          {sources.map((source) => (
                            <SourceOption
                              key={`${source.addonId}-${source.sourceIndex}`}
                              onPlay={handlePlay}
                              source={source}
                            />
                          ))}
                        </div>
                      )}
                  </>
                ) : (
                  <>
                    {/* Temporadas y episodios - visible when no episode selected */}
                    <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                      Temporadas y episodios
                    </p>

                    {seriesLoading && (
                      <div className="space-y-2">
                        <Skeleton className="h-9 w-full rounded-lg" />
                        {["a", "b", "c", "d"].map((key) => (
                          <div className="flex gap-3" key={key}>
                            <Skeleton className="h-16 w-28 shrink-0 rounded" />
                            <div className="flex-1 space-y-1.5 py-1">
                              <Skeleton className="h-3 w-3/4" />
                              <Skeleton className="h-3 w-1/2" />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {!seriesLoading &&
                      seriesLoaded &&
                      seasons.length === 0 && (
                        <div className="rounded-lg border border-border/50 bg-muted/50 p-3">
                          <p className="text-muted-foreground text-xs">
                            No se encontraron episodios.
                          </p>
                        </div>
                      )}

                    {!seriesLoading &&
                      seriesLoaded &&
                      seasons.length > 0 && (
                        <>
                          {/* Season dropdown */}
                          <div className="relative" ref={seasonDropdownRef}>
                            <button
                              className="flex w-full items-center justify-between gap-1.5 rounded-md border border-input bg-input/20 px-2 py-1.5 text-foreground text-xs/relaxed outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
                              onClick={() =>
                                setSeasonDropdownOpen(!seasonDropdownOpen)
                              }
                              type="button"
                            >
                              <span>
                                Temporada {selectedSeason ?? seasons[0]}
                              </span>
                              <ChevronDownIcon className="pointer-events-none size-3.5 text-muted-foreground" />
                            </button>
                            {seasonDropdownOpen && (
                              <div className="absolute top-full left-0 z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-md ring-1 ring-foreground/10">
                                {seasons.map((s) => {
                                  const isActive =
                                    s === (selectedSeason ?? seasons[0]);
                                  return (
                                    <button
                                      className={`flex w-full items-center gap-2 px-2 py-1.5 text-xs outline-none hover:bg-accent ${isActive ? "bg-accent text-accent-foreground" : "text-foreground"}`}
                                      key={s}
                                      onClick={() => {
                                        setSelectedSeason(s);
                                        setSeasonDropdownOpen(false);
                                      }}
                                      type="button"
                                    >
                                      <span className="flex-1 text-left">
                                        Temporada {s}
                                      </span>
                                      {isActive && (
                                        <CheckIcon className="size-3.5" />
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* Episode list */}
                          <div className="space-y-2">
                            {filteredEpisodes.map((ep) => (
                              <button
                                className="flex w-full items-center gap-3 rounded-lg border border-border/50 bg-background p-2 text-left transition-colors hover:border-primary/50 hover:bg-accent"
                                key={ep.id}
                                onClick={() => handleEpisodeClick(ep)}
                                type="button"
                              >
                                {ep.thumbnail ? (
                                  // biome-ignore lint/performance/noImgElement: external CDN thumbnail
                                  <img
                                    alt={ep.name}
                                    className="h-16 w-28 shrink-0 rounded object-cover"
                                    height={64}
                                    loading="lazy"
                                    src={ep.thumbnail}
                                    width={112}
                                  />
                                ) : (
                                  <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground text-xs">
                                    E{ep.number}
                                  </div>
                                )}
                                <div className="min-w-0 flex-1 py-0.5">
                                  <p className="truncate font-medium text-foreground text-xs">
                                    {ep.number}. {ep.name}
                                  </p>
                                  {ep.released && (
                                    <p className="text-[10px] text-muted-foreground">
                                      {formatDate(ep.released)}
                                    </p>
                                  )}
                                  {ep.description && (
                                    <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">
                                      {ep.description}
                                    </p>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                  </>
                )}
              </div>
            )}

            {/* === Streaming Sources (for movies) === */}
            {!isSeries && (
              <div className="space-y-2">
                <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  Medios disponibles
                </p>

                {sourcesLoading && (
                  <div className="space-y-1.5">
                    {["a", "b", "c"].map((key) => (
                      <div
                        className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background p-2.5"
                        key={key}
                      >
                        <Skeleton className="h-3 w-3/4" />
                        <Skeleton className="size-6 shrink-0 rounded-full" />
                      </div>
                    ))}
                  </div>
                )}

                {!sourcesLoading && sourcesLoaded && sources.length === 0 && (
                  <WatchProvidersNotice
                    fallback={
                      <div className="rounded-lg border border-border/50 bg-muted/50 p-3">
                        <p className="text-muted-foreground text-xs">
                          No hay fuentes de streaming disponibles.
                        </p>
                      </div>
                    }
                    id={movie.id}
                    title={movie.name}
                    type={movie.type}
                    year={movie.year}
                  />
                )}

                {!sourcesLoading && sourcesLoaded && sources.length > 0 && (
                  <div className="space-y-1.5">
                    {sources.map((source) => (
                      <SourceOption
                        key={`${source.addonId}-${source.sourceIndex}`}
                        onPlay={handlePlay}
                        source={source}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tráiler al frente: overlay a nivel de <body> (createPortal) para quedar
          por encima del Drawer sin chocar con su gestor de foco/portal. */}
      {showTrailer &&
        trailerKey &&
        typeof document !== "undefined" &&
        createPortal(
          // biome-ignore lint/a11y/noStaticElementInteractions: backdrop cierra al click
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
            onClick={() => setShowTrailer(false)}
          >
            <button
              aria-label="Cerrar tráiler"
              className="absolute top-4 right-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
              onClick={() => setShowTrailer(false)}
              type="button"
            >
              <X className="size-5" />
            </button>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: evita que el click en el vídeo cierre */}
            <div
              className="aspect-video w-full max-w-4xl overflow-hidden rounded-lg bg-black shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <iframe
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="h-full w-full"
                src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1&rel=0`}
                title="Tráiler"
              />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
