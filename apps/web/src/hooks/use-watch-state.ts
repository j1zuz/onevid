"use client";

import { useEffect, useState } from "react";

export interface WatchStateItem {
  durationSec: number;
  episode: number;
  finished: boolean;
  mediaId: string;
  mediaType: "movie" | "series";
  positionSec: number;
  season: number;
}

export interface WatchState {
  /** true si el título se terminó de ver. Solo aplica a películas: ver un
   *  capítulo no deja "vista" la serie entera, y no sabemos cuántos tiene. La
   *  marca de las series va por capítulo, con `episode()`. */
  isWatched: (type: string, id: string) => boolean;
  /** Estado de un episodio concreto, para las listas de capítulos. */
  episode: (
    id: string,
    season: number,
    episode: number
  ) => { finished: boolean; progress: number } | null;
}

interface Snapshot {
  byEpisode: Map<string, WatchStateItem>;
  watchedTitles: Set<string>;
}

const EMPTY: Snapshot = { byEpisode: new Map(), watchedTitles: new Set() };

// Store de módulo y no un contexto: `PosterCard` se usa en muchos árboles
// distintos (feed, grilla de "Ver todo", diálogo de detalle) y envolverlos todos
// en un provider obligaría a tocar cada uno. Así el fetch se hace UNA vez por
// perfil y lo comparten todas las tarjetas montadas.
let cacheProfileId: string | null = null;
let cacheSnapshot: Snapshot = EMPTY;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function buildSnapshot(items: WatchStateItem[]): Snapshot {
  const byEpisode = new Map<string, WatchStateItem>();
  const watchedTitles = new Set<string>();
  for (const item of items) {
    byEpisode.set(
      `${item.mediaId}:${item.season}:${item.episode}`,
      item
    );
    // Solo la fila "sin temporada ni episodio", que es como se guardan las
    // películas: una serie con un capítulo terminado NO está vista.
    if (item.finished && item.season === 0 && item.episode === 0) {
      watchedTitles.add(`${item.mediaType}-${item.mediaId}`);
    }
  }
  return { byEpisode, watchedTitles };
}

function load(profileId: string): Promise<void> {
  if (cacheProfileId === profileId && inFlight) {
    return inFlight;
  }
  cacheProfileId = profileId;
  inFlight = fetch("/api/onevid-progress?state=1", {
    headers: { "X-Profile-Id": profileId },
  })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
    .then((data: { items?: WatchStateItem[] }) => {
      cacheSnapshot = buildSnapshot(data.items ?? []);
    })
    .catch(() => {
      // Sin perfil / sin red: no hay marca de visto, que es un adorno. No se
      // rompe nada por no tenerla.
      cacheSnapshot = EMPTY;
    })
    .finally(() => {
      for (const listener of listeners) {
        listener();
      }
    });
  return inFlight;
}

/** Invalida el estado para que la próxima tarjeta que monte lo vuelva a pedir. */
export function invalidateWatchState() {
  cacheProfileId = null;
  cacheSnapshot = EMPTY;
  inFlight = null;
}

export function useWatchState(profileId: string | null): WatchState {
  const [snapshot, setSnapshot] = useState<Snapshot>(cacheSnapshot);

  useEffect(() => {
    if (!profileId) {
      setSnapshot(EMPTY);
      return;
    }
    const listener = () => setSnapshot(cacheSnapshot);
    listeners.add(listener);
    load(profileId).then(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [profileId]);

  return {
    isWatched: (type, id) => snapshot.watchedTitles.has(`${type}-${id}`),
    episode: (id, season, episode) => {
      const item = snapshot.byEpisode.get(`${id}:${season}:${episode}`);
      if (!item) {
        return null;
      }
      return {
        finished: item.finished,
        progress:
          item.durationSec > 0 ? item.positionSec / item.durationSec : 0,
      };
    },
  };
}
