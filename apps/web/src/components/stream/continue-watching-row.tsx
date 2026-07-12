"use client";

import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { ExploreMovieDialog } from "@/components/explore-movie-dialog";
import { useOneVidProfiles } from "@/components/stream/onevid-profile-context";
import { useTranslation } from "@/lib/onevid-i18n-context";
import type { MediaMeta } from "@/lib/tmdb";

interface ContinueWatchingItem extends MediaMeta {
  durationSec: number;
  positionSec: number;
}

/**
 * "Continue watching" row: the profile's in-progress titles with a resume
 * progress bar over each poster. Hidden entirely when there's nothing to resume.
 */
export function ContinueWatchingRow() {
  const { t, language } = useTranslation();
  const { activeProfileId } = useOneVidProfiles();
  // `null` = fetch in flight (show a skeleton reserving this row's space so
  // the section below it doesn't render first and then get pushed down once
  // this data arrives); `[]` = loaded, nothing to resume (hide the row).
  const [items, setItems] = useState<ContinueWatchingItem[] | null>(null);

  // Depende también de `language`: al cambiar idioma queremos re-pedir los
  // títulos ya localizados (el endpoint los traduce leyendo la cookie
  // NEXT_LOCALE, que el selector persiste antes del refresh). Sin esto, como es
  // un componente cliente, sus datos quedaban en el idioma anterior hasta un
  // recargado manual, aunque el catálogo (server) sí cambiaba.
  useEffect(() => {
    if (!activeProfileId) {
      setItems([]);
      return;
    }
    setItems(null);
    const controller = new AbortController();
    fetch("/api/onevid-progress", {
      headers: { "X-Profile-Id": activeProfileId },
      signal: controller.signal,
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ results: ContinueWatchingItem[] }>) : null))
      .then((data) => {
        setItems(data?.results ?? []);
      })
      .catch(() => {
        /* no profile / offline — just don't show the row */
        setItems([]);
      });
    return () => controller.abort();
  }, [activeProfileId, language]);

  if (items === null) {
    return (
      <section className="container mx-auto flex flex-col gap-3 px-2">
        <h2 className="px-1 font-semibold text-lg md:text-xl">
          {t("Continuar viendo")}
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {["a", "b", "c", "d", "e"].map((key) => (
            <div className="space-y-1" key={key}>
              <div className="aspect-video w-full animate-pulse rounded-(--radius) bg-muted/40" />
              <div className="mx-auto h-4 w-3/4 animate-pulse rounded bg-muted/40" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="container mx-auto flex flex-col gap-3 px-2">
      <h2 className="px-1 font-semibold text-lg md:text-xl">
        {t("Continuar viendo")}
      </h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {items.map((item) => {
          const pct =
            item.durationSec > 0
              ? Math.min(
                  100,
                  Math.round((item.positionSec / item.durationSec) * 100)
                )
              : 0;
          // Preferimos el backdrop horizontal (16:9); si no hay, caemos al
          // póster para no dejar la tarjeta vacía.
          const art = item.background ?? item.poster;
          return (
            <ExploreMovieDialog
              key={`${item.type}-${item.id}`}
              movie={item}
              onPlay={() => {
                /* no-op */
              }}
            >
              <article className="group block h-full">
                <div className="relative aspect-video w-full rounded-(--radius) border border-border/70 bg-muted/40 p-1 transition-all duration-200 hover:border-primary/50 hover:shadow-sm">
                  <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-[calc(var(--radius)-4px)] border border-border/60 bg-card">
                    {art ? (
                      // biome-ignore lint/performance/noImgElement: external CDN art
                      <img
                        alt={item.name}
                        className="h-full w-full object-cover"
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

                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
                    <div className="flex size-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
                      <Play className="size-5 fill-current" />
                    </div>
                  </div>

                  {pct > 0 && (
                    <div className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-black/50">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${pct}%` }}
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
            </ExploreMovieDialog>
          );
        })}
      </div>
    </section>
  );
}
