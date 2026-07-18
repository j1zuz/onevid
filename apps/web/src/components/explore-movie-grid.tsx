"use client";

import { Play } from "lucide-react";
import { ExploreMovieDialog } from "@/components/explore-movie-dialog";
import type { MediaMeta } from "@/lib/tmdb";

interface ExploreMovieGridProps {
  posters: MediaMeta[];
}

export function ExploreMovieGrid({ posters }: ExploreMovieGridProps) {
  return (
    <div className="container mx-auto flex flex-col gap-8 px-2">
      <section
        className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5"
        data-dpad-poster-grid
      >
        {posters.map((item) => (
          <ExploreMovieDialog
            key={`${item.type}-${item.id}`}
            movie={item}
            onPlay={() => {
              /* no-op */
            }}
          >
            <article className="group block h-full">
              <div
                className="relative aspect-2/3 w-full rounded-(--radius) border border-border/70 bg-muted/40 p-1 transition-[border-color,box-shadow,filter] duration-200"
                data-dpad-card-frame
              >
                <div
                  className="flex h-full w-full items-center justify-center overflow-hidden rounded-[calc(var(--radius)-4px)] border border-border/60 bg-card transition-[filter]"
                  data-dpad-card-art
                >
                  {item.poster ? (
                    // biome-ignore lint/performance/noImgElement: external CDN poster
                    <img
                      alt={item.name}
                      className="h-full w-full object-cover"
                      height={0}
                      loading="lazy"
                      src={item.poster}
                      width={0}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center px-3 text-center text-muted-foreground text-xs">
                      Sin poster
                    </div>
                  )}
                </div>

                <div
                  className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100"
                  data-dpad-card-overlay
                >
                  <div className="flex size-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
                    <Play className="size-5 fill-current" />
                  </div>
                </div>
              </div>

              <div className="space-y-1 px-1 pt-2 pb-1 text-center">
                <p className="line-clamp-2 font-medium text-sm leading-tight md:text-base">
                  {item.name}
                </p>
              </div>
            </article>
          </ExploreMovieDialog>
        ))}
      </section>
    </div>
  );
}
