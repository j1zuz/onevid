"use client";

import { useEffect, useState } from "react";
import type { NextEpisodeRef } from "@/components/stream/stream-next-episode";

interface SeriesMeta {
  episodes?: { name?: string; number?: number; season?: number }[];
  seasons?: number[];
}

async function fetchSeasonMeta(
  seriesId: string,
  season: number,
  signal: AbortSignal
): Promise<SeriesMeta | null> {
  const res = await fetch(
    `/api/series-meta?id=${encodeURIComponent(seriesId)}&season=${season}`,
    { signal }
  );
  return res.ok ? ((await res.json()) as SeriesMeta) : null;
}

/**
 * Resuelve el episodio que sigue al que se está viendo, o `null` si es el
 * último de la serie. Salta de temporada cuando hace falta: al terminar el
 * final de temporada, el siguiente es el primer episodio de la siguiente.
 *
 * Devuelve el `playId` con el TMDB id de la serie (`<tmdbId>:<t>:<e>`), que es
 * el formato que espera la ruta `/home/player/series/[id]` — el id compuesto
 * con IMDb que usan los addons se resuelve luego, en el servidor.
 */
export function useNextEpisode(
  seriesId: string,
  season: number,
  episode: number,
  enabled: boolean
): NextEpisodeRef | null {
  const [next, setNext] = useState<NextEpisodeRef | null>(null);

  useEffect(() => {
    if (!(enabled && seriesId && season > 0 && episode > 0)) {
      setNext(null);
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;

    (async () => {
      try {
        const current = await fetchSeasonMeta(seriesId, season, signal);
        if (!current) {
          return;
        }
        const inSameSeason = (current.episodes ?? []).find(
          (ep) => ep.season === season && ep.number === episode + 1
        );
        if (inSameSeason?.number) {
          setNext({
            playId: `${seriesId}:${season}:${inSameSeason.number}`,
            episode: inSameSeason.number,
            name: inSameSeason.name ?? "",
            season,
          });
          return;
        }

        // Fin de temporada: el siguiente es el primero de la próxima, si la hay.
        const seasons = current.seasons ?? [];
        const following = seasons.find((s) => s > season);
        if (!following) {
          return;
        }
        const nextSeason = await fetchSeasonMeta(seriesId, following, signal);
        const first = (nextSeason?.episodes ?? [])
          .filter((ep) => typeof ep.number === "number" && ep.number > 0)
          .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))[0];
        if (first?.number) {
          setNext({
            playId: `${seriesId}:${following}:${first.number}`,
            episode: first.number,
            name: first.name ?? "",
            season: following,
          });
        }
      } catch {
        /* sin siguiente episodio: el botón simplemente no aparece */
      }
    })();

    return () => controller.abort();
  }, [seriesId, season, episode, enabled]);

  return next;
}
