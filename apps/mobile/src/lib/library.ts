import type { QueryClient } from '@tanstack/react-query';
import type { MediaMeta } from './api';
import { parseLiveSavedId } from './live-tv';
import {
  getFavorites,
  getSavedLive,
  getWatchlistItems,
  type SavedLiveChannel,
} from './saved';

/**
 * Favoritos + "Ver después" del perfil activo, intercalando películas, series y
 * canales de Live TV guardados. Vive aquí (y no dentro de la pantalla) para
 * poder precargarla desde el selector de perfiles con la misma queryKey.
 */
export const libraryQuery = () => ({
  queryKey: ['library'] as const,
  queryFn: async () => {
    const [favM, favS, favL, watM, watS, watL] = await Promise.all([
      getFavorites('movie').catch(() => []),
      getFavorites('series').catch(() => []),
      getSavedLive('favorite').catch(() => []),
      getWatchlistItems('movie').catch(() => []),
      getWatchlistItems('series').catch(() => []),
      getSavedLive('watchlist').catch(() => []),
    ]);
    return {
      favorites: interleaveMany([
        favM,
        favS,
        liveToMedia(favL),
      ]),
      watchlist: interleaveMany([
        watM,
        watS,
        liveToMedia(watL),
      ]),
    };
  },
});

function liveToMedia(items: SavedLiveChannel[]): MediaMeta[] {
  return items.flatMap((item) => {
    const parsed = parseLiveSavedId(item.id);
    if (!parsed) return [];
    return [
      {
        // No es una media de TMDB: `savedLive` hace que la Biblioteca
        // reproduzca el canal en vez de abrir el detalle.
        id: item.id,
        type: 'movie' as const,
        name: item.name,
        poster: item.poster,
        background: item.background ?? item.poster,
        savedLive: true,
        sourceId: parsed.sourceId,
        channelId: parsed.channelId,
      },
    ];
  });
}

/**
 * Precalienta la Biblioteca para que al abrir la pestaña no aparezca el
 * skeleton. Debe llamarse DESPUÉS de activar el perfil: los datos dependen del
 * header X-Profile-Id. Best-effort: cualquier fallo se ignora.
 */
export function prefetchLibrary(qc: QueryClient): void {
  void qc.prefetchQuery(libraryQuery()).catch(() => undefined);
}

function interleaveMany<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const len = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < len; i += 1) {
    for (const list of lists) {
      if (list[i]) out.push(list[i]);
    }
  }
  return out;
}
