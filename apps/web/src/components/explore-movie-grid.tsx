"use client";

import {
  HORIZONTAL_POSTER_GRID_CLASS,
  PosterCard,
} from "@/components/stream/poster-card";
import type { MediaMeta } from "@/lib/tmdb";

interface ExploreMovieGridProps {
  posters: MediaMeta[];
  topTen?: boolean;
  topTenRanks?: Record<string, number>;
}

/** Grilla de la vista "Ver todo" de una fila del catálogo: mismas tarjetas
 * horizontales que su fila de origen en /home. */
export function ExploreMovieGrid({
  posters,
  topTen = false,
  topTenRanks = {},
}: ExploreMovieGridProps) {
  return (
    <div className="container mx-auto flex flex-col gap-8 px-2">
      <section className={HORIZONTAL_POSTER_GRID_CLASS} data-dpad-poster-grid>
        {posters.map((item, index) => (
          <PosterCard
            item={item}
            key={`${item.type}-${item.id}`}
            orientation="horizontal"
            rank={
              topTen ? topTenRanks[`${item.type}-${item.id}`] : undefined
            }
          />
        ))}
      </section>
    </div>
  );
}
