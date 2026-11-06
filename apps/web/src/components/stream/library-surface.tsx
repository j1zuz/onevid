"use client";

import { Button, buttonVariants } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import { TransitionLink } from "glimm/next";
import { BookmarkIcon, ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ExploreMovieGrid } from "@/components/explore-movie-grid";
import { OneVidHeader } from "./onevid-header";
import { useOneVidProfiles } from "./onevid-profile-context";
import { PosterCard, VIEW_ALL_GRID_CLASS } from "./poster-card";
import { ScrollTopFade } from "./scroll-top-fade";
import { FEED_ROW_ITEM_LIMIT } from "@/lib/onevid-feed";
import { useTranslation } from "@/lib/onevid-i18n-context";
import { parseLiveSavedId } from "@/lib/live-tv-saved";
import type { MediaMeta } from "@/lib/tmdb";

type HeaderProps = Omit<ComponentProps<typeof OneVidHeader>, "surface">;

type SavedKind = "favorites" | "watchlist";

/**
 * La biblioteca muestra dos filas de pósters por sección (4 por fila en
 * escritorio). "Ver todo" solo aparece cuando hay más que eso.
 */
const LIBRARY_PREVIEW_LIMIT = FEED_ROW_ITEM_LIMIT * 2;

const LIBRARY_GRID_CLASS =
  "grid grid-cols-2 gap-4 sm:grid-cols-4";

const LIBRARY_VIEW_ALL_HREF = (kind: SavedKind) =>
  `/home?surface=library&view=${kind}`;

interface LibraryData {
  favorites: MediaMeta[];
  watchlist: MediaMeta[];
}

/** Intercala las listas para que la fila no quede agrupada por tipo. */
function interleaveMany<T>(lists: T[][]): T[] {
  const result: T[] = [];
  const length = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < length; index += 1) {
    for (const list of lists) {
      const item = list[index];
      if (item) result.push(item);
    }
  }
  return result;
}

async function fetchSaved(
  kind: SavedKind,
  mediaType: "movie" | "series",
  profileId: string,
  signal: AbortSignal,
): Promise<MediaMeta[]> {
  const endpoint =
    kind === "favorites"
      ? "/api/onevid-favorites"
      : "/api/onevid-watchlist-items";
  const response = await fetch(`${endpoint}?type=${mediaType}`, {
    cache: "no-store",
    headers: { Accept: "application/json", "X-Profile-Id": profileId },
    signal,
  });
  if (!response.ok) throw new Error("Library unavailable");
  const data = (await response.json()) as { results?: MediaMeta[] };
  return Array.isArray(data.results) ? data.results : [];
}

/** Canales de Live TV guardados: se abren en la superficie de Live TV. */
async function fetchLiveSaved(
  kind: SavedKind,
  profileId: string,
  signal: AbortSignal,
): Promise<MediaMeta[]> {
  const endpoint =
    kind === "favorites"
      ? "/api/onevid-favorites"
      : "/api/onevid-watchlist-items";
  const response = await fetch(`${endpoint}?type=live`, {
    cache: "no-store",
    headers: { Accept: "application/json", "X-Profile-Id": profileId },
    signal,
  });
  if (!response.ok) throw new Error("Library unavailable");
  const data = (await response.json()) as {
    results?: Array<{
      background?: string;
      id: string;
      name: string;
      poster?: string;
    }>;
  };
  return (data.results ?? []).flatMap((item) => {
    const parsed = parseLiveSavedId(item.id);
    if (!parsed) return [];
    return [
      {
        // La tarjeta solo necesita un id único y el playHref para abrir el canal;
        // no es una media de TMDB, por eso no pasa por el detalle.
        id: item.id,
        type: "movie" as const,
        name: item.name,
        poster: item.poster,
        background: item.background ?? item.poster,
        savedLive: true,
        playHref: `/home?surface=live&source=${encodeURIComponent(
          parsed.sourceId
        )}&channel=${encodeURIComponent(parsed.channelId)}`,
      },
    ];
  });
}

async function fetchKind(
  kind: SavedKind,
  profileId: string,
  signal: AbortSignal,
): Promise<MediaMeta[]> {
  const [movies, series, live] = await Promise.all([
    fetchSaved(kind, "movie", profileId, signal),
    fetchSaved(kind, "series", profileId, signal),
    fetchLiveSaved(kind, profileId, signal),
  ]);
  return interleaveMany([movies, series, live]);
}

function RowSkeleton() {
  return (
    <div className={LIBRARY_GRID_CLASS}>
      {Array.from({ length: LIBRARY_PREVIEW_LIMIT }, (_, index) => (
        <Skeleton className="aspect-video w-full rounded-(--radius)" key={index} />
      ))}
    </div>
  );
}

function GridSkeleton() {
  return (
    <section className={VIEW_ALL_GRID_CLASS}>
      {Array.from({ length: 8 }, (_, index) => (
        <Skeleton className="aspect-video w-full rounded-(--radius)" key={index} />
      ))}
    </section>
  );
}

/**
 * Sección de la biblioteca: dos filas de pósters (4 por fila en escritorio) y
 * "Ver todo" solo cuando hay más de dos filas.
 */
function LibraryRow({
  emptyText,
  href,
  items,
  loading,
  title,
}: {
  emptyText: string;
  href: string;
  items: MediaMeta[];
  loading: boolean;
  title: string;
}) {
  const { t: rawT } = useTranslation();
  const t = (key: string) => rawT(key as never) as unknown as string;
  const visible = items.slice(0, LIBRARY_PREVIEW_LIMIT);
  const hasMore = items.length > LIBRARY_PREVIEW_LIMIT;

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 className="font-semibold text-lg md:text-xl">{title}</h2>
        {hasMore ? (
          <TransitionLink
            className={cn(
              buttonVariants({ size: "xs" }),
              "btn-primary shrink-0",
            )}
            data-dpad-focusable
            href={href}
          >
            <ChevronRightIcon data-icon="inline-start" />
            {t("Ver todo")}
          </TransitionLink>
        ) : null}
      </div>
      {loading ? (
        <RowSkeleton />
      ) : items.length === 0 ? (
        <p className="px-1 text-muted-foreground text-sm">{emptyText}</p>
      ) : (
        <div className={LIBRARY_GRID_CLASS}>
          {visible.map((item) => (
            <PosterCard
              item={item}
              key={`${item.type}:${item.id}`}
              orientation="horizontal"
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** Cabecera de la vista "Ver todo" de una sección de la biblioteca. */
function BackToLibraryHeader({ title }: { title: string }) {
  const { t: rawT } = useTranslation();
  const t = (key: string) => rawT(key as never) as unknown as string;
  return (
    <div className="flex items-baseline justify-between gap-2 px-1">
      <h1 className="font-semibold text-lg md:text-xl">{title}</h1>
      <TransitionLink
        className={cn(buttonVariants({ size: "xs" }), "btn-primary shrink-0")}
        data-dpad-focusable
        href="/home?surface=library"
      >
        <ChevronRightIcon data-icon="inline-start" />
        {t("Volver a la biblioteca")}
      </TransitionLink>
    </div>
  );
}

function LibraryContent() {
  const { t: rawT } = useTranslation();
  const t = (key: string) => rawT(key as never) as unknown as string;
  const searchParams = useSearchParams();
  const { activeProfileId } = useOneVidProfiles();
  const [data, setData] = useState<LibraryData | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const view = searchParams.get("view");
  const section: SavedKind | null =
    view === "favorites" || view === "watchlist" ? view : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is a retry trigger, not read inside the effect.
  useEffect(() => {
    if (!activeProfileId) {
      setData({ favorites: [], watchlist: [] });
      setFailed(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setData(null);
    setFailed(false);
    Promise.all([
      fetchKind("favorites", activeProfileId, controller.signal),
      fetchKind("watchlist", activeProfileId, controller.signal),
    ])
      .then(([favorites, watchlist]) => {
        if (active) setData({ favorites, watchlist });
      })
      .catch(() => {
        if (active && !controller.signal.aborted) {
          setData({ favorites: [], watchlist: [] });
          setFailed(true);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [activeProfileId, attempt]);

  const loading = data === null;
  const favorites = data?.favorites ?? [];
  const watchlist = data?.watchlist ?? [];

  if (failed) {
    return (
      <div className="flex min-w-0 flex-col gap-6 px-2">
        <section className="flex flex-col items-start gap-3 rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-sm">
            <BookmarkIcon aria-hidden="true" className="size-4 text-primary" />
            <span>{t("No se pudo cargar tu biblioteca.")}</span>
          </div>
          <Button
            data-dpad-focusable
            onClick={retry}
            size="sm"
            variant="outline"
          >
            <RefreshCwIcon aria-hidden="true" className="size-3.5" />
            {t("Reintentar")}
          </Button>
        </section>
      </div>
    );
  }

  if (section) {
    const items = section === "favorites" ? favorites : watchlist;
    return (
      <div className="flex min-w-0 flex-col gap-6">
        <div className="px-2">
          <BackToLibraryHeader
            title={
              section === "favorites" ? t("Favoritos") : t("Ver después")
            }
          />
        </div>
        {loading ? (
          <div className="px-2">
            <GridSkeleton />
          </div>
        ) : items.length === 0 ? (
          <p className="px-2 text-muted-foreground text-sm">
            {section === "favorites"
              ? t("Aún no tienes favoritos.")
              : t("Tu lista de ver después está vacía.")}
          </p>
        ) : (
          <ExploreMovieGrid posters={items} />
        )}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-2">
      <header className="space-y-1 px-1">
        <h1 className="font-semibold text-2xl md:text-3xl">
          {t("Biblioteca")}
        </h1>
        <p className="text-muted-foreground text-sm">
          {t("Tus títulos guardados")}
        </p>
      </header>

      <LibraryRow
        emptyText={t("Aún no tienes favoritos.")}
        href={LIBRARY_VIEW_ALL_HREF("favorites")}
        items={favorites}
        loading={loading}
        title={t("Favoritos")}
      />
      <LibraryRow
        emptyText={t("Tu lista de ver después está vacía.")}
        href={LIBRARY_VIEW_ALL_HREF("watchlist")}
        items={watchlist}
        loading={loading}
        title={t("Ver después")}
      />
    </div>
  );
}

/** Biblioteca del perfil activo: favoritos y "Ver después", como en la app. */
export function LibrarySurface({ headerProps }: { headerProps: HeaderProps }) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <OneVidHeader {...headerProps} surface="library" />
      <div className="relative min-h-0 flex-1">
        <ScrollTopFade scrollAreaRef={scrollAreaRef} />
        {/* `data-dpad-poster-grid` en el contenedor de todas las filas para que
            el mando de TV pueda bajar de una fila a la siguiente. */}
        <div
          className="no-scrollbar flex h-full flex-col gap-8 overflow-y-auto pt-4"
          data-dpad-poster-grid
          ref={scrollAreaRef}
        >
          <LibraryContent />
        </div>
      </div>
    </div>
  );
}
