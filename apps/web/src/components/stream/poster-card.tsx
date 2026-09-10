"use client";

import { cn } from "@workspace/ui/lib/utils";
import { CircleCheckIcon, Play } from "lucide-react";
import Link from "next/link";
import { useWatchState } from "@/hooks/use-watch-state";
import { useTranslation } from "@/lib/onevid-i18n-context";
import type { MediaMeta } from "@/lib/tmdb";
import { useOptionalOneVidProfiles } from "./onevid-profile-context";

interface PosterCardProps {
  item: MediaMeta;
  /** "vertical" (2:3, póster) por defecto; "horizontal" (16:9, backdrop). */
  orientation?: "horizontal" | "vertical";
  /** 0-100: franja de progreso sobre el arte (usada por Continuar viendo). */
  progressPct?: number;
  /** Posición dentro de una lista Top 10. */
  rank?: number;
}

/**
 * Grilla para tarjetas horizontales (16:9): menos columnas que la de pósters
 * verticales para que se vean más grandes, aunque entren menos por fila. La
 * comparten `FeedRow` y `ContinueWatchingRow` (incluido su skeleton de carga).
 */
export const HORIZONTAL_POSTER_GRID_CLASS =
  "grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4";

/**
 * Tarjeta de póster con overlay de play. La comparten la grilla de "Ver todo"
 * (`ExploreMovieGrid`, vertical), cada fila del feed de inicio (`FeedRow`,
 * horizontal) y Continuar viendo (`ContinueWatchingRow`, horizontal + progreso).
 */
export function PosterCard({
  item,
  orientation = "vertical",
  progressPct,
  rank,
}: PosterCardProps) {
  const { t } = useTranslation();
  // Opcional a propósito: la tarjeta también se monta fuera del árbol con
  // provider de perfiles, y sin perfil simplemente no hay marca de visto.
  const activeProfileId =
    useOptionalOneVidProfiles()?.activeProfileId ?? null;
  const watchState = useWatchState(activeProfileId);
  const watched = watchState.isWatched(item.type, item.id);
  const horizontal = orientation === "horizontal";
  const detailHref = `/home/detail/${item.type}/${encodeURIComponent(item.id)}`;
  // En horizontal preferimos el backdrop (16:9); si no hay, caemos al póster
  // para no dejar la tarjeta vacía.
  const art = horizontal ? (item.background ?? item.poster) : item.poster;

  return (
    <Link data-dpad-focusable href={detailHref}>
      <article className="group block h-full">
        <div
          className={cn(
            "relative w-full rounded-(--radius) border border-border/70 bg-muted/40 p-1 transition-[border-color,box-shadow,filter] duration-200",
            horizontal ? "aspect-video" : "aspect-2/3"
          )}
          data-dpad-card-frame
        >
          <div
            className="flex h-full w-full items-center justify-center overflow-hidden rounded-[calc(var(--radius)-4px)] border border-border/60 bg-card transition-[filter]"
            data-dpad-card-art
          >
            {art ? (
              // biome-ignore lint/performance/noImgElement: external CDN art
              <img
                alt={item.name}
                className="h-full w-full object-cover transition-[filter] duration-200 group-hover:brightness-125"
                height={0}
                loading="lazy"
                src={art}
                width={0}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center px-3 text-center text-muted-foreground text-xs">
                {t("Sin poster")}
              </div>
            )}
          </div>

          {/* Ya visto: check en la esquina opuesta al badge de Top 10, para que
              un título pueda llevar los dos sin pisarse. */}
          {watched && (
            <span
              aria-label={t("Visto")}
              className="absolute top-1.5 right-1.5 z-10 flex size-6 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm"
            >
              <CircleCheckIcon className="size-4" />
            </span>
          )}

          {rank != null && rank >= 1 && rank <= 10 && (
            <span
              aria-label={`Top ${rank}`}
              className="absolute top-1 left-1 z-10 h-7 w-11 overflow-hidden rounded-tl-[calc(var(--radius)-2px)] text-base text-white [clip-path:polygon(0_0,100%_0,82%_100%,0_100%)]"
            >
              {art && (
                <span
                  aria-hidden
                  className="absolute -inset-3 bg-cover bg-no-repeat blur-[7px] saturate-150"
                  style={{ backgroundImage: `url("${art}")` }}
                />
              )}
              <span className="absolute inset-0 bg-black/20" />
              <span className="relative z-10 block pt-0.5 pl-1.5 font-medium">
              #{rank}
              </span>
            </span>
          )}

          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100"
            data-dpad-card-overlay
          >
            <div className="flex size-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
              <Play className="size-5 fill-current" />
            </div>
          </div>

          {typeof progressPct === "number" && progressPct > 0 && (
            <div className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-black/50">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}
        </div>

        <div className="space-y-1 px-1 pt-2 pb-1 text-center">
          <p className="line-clamp-2 font-medium text-sm leading-tight md:text-base">
            {item.name}
          </p>
        </div>
      </article>
    </Link>
  );
}
