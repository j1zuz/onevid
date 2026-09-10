import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

export interface WatchStateItem {
  durationSec: number;
  episode: number;
  finished: boolean;
  mediaId: string;
  mediaType: 'movie' | 'series';
  positionSec: number;
  season: number;
}

/**
 * Estado de visionado del perfil activo: qué títulos están terminados y en qué
 * minuto quedó cada episodio. Va aparte de `continueWatchingQuery` porque aquella
 * colapsa por título y descarta lo terminado — justo lo que hace falta aquí para
 * pintar la marca de "visto".
 *
 * `staleTime` alto a propósito: es un adorno de la carátula, no vale la pena
 * repedirlo en cada navegación. El reproductor lo invalida al terminar algo.
 */
export const watchStateQuery = () => ({
  queryKey: ['watch-state'] as const,
  queryFn: () =>
    apiFetch<{ items: WatchStateItem[] }>(
      '/api/onevid-progress?state=1',
    ).then((r) => r.items ?? []),
  staleTime: 5 * 60_000,
});

export interface WatchState {
  /** Estado de un episodio concreto, para las listas de capítulos. */
  episode: (
    id: string,
    season: number,
    episode: number,
  ) => { finished: boolean; progress: number } | null;
  /** true si el título se terminó de ver. Solo aplica a películas: ver un
   *  capítulo no deja "vista" la serie entera, y no sabemos cuántos tiene. La
   *  marca de las series va por capítulo, con `episode()`. */
  isWatched: (type: string, id: string) => boolean;
}

export function useWatchState(): WatchState {
  // Sin `enabled`: `apiFetch` ya manda el perfil activo y un 409 sin perfil se
  // traga como error de query. Que falle solo significa quedarse sin la marca.
  const query = useQuery({ ...watchStateQuery(), retry: false });
  const items = query.data ?? [];

  return {
    isWatched: (type, id) =>
      items.some(
        (item) =>
          item.finished &&
          item.mediaType === type &&
          item.mediaId === id &&
          // Solo la fila "sin temporada ni episodio", que es como se guardan las
          // películas: una serie con un capítulo terminado NO está vista.
          item.season === 0 &&
          item.episode === 0,
      ),
    episode: (id, season, episode) => {
      const item = items.find(
        (entry) =>
          entry.mediaId === id &&
          entry.season === season &&
          entry.episode === episode,
      );
      if (!item) return null;
      return {
        finished: item.finished,
        progress:
          item.durationSec > 0 ? item.positionSec / item.durationSec : 0,
      };
    },
  };
}
