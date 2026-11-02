import type { QueryClient } from '@tanstack/react-query';
import { getFavorites, getWatchlistItems } from './saved';

/**
 * Favoritos + "Ver después" del perfil activo, intercalando películas y series.
 * Vive aquí (y no dentro de la pantalla) para poder precargarla desde el
 * selector de perfiles con exactamente la misma queryKey.
 */
export const libraryQuery = () => ({
  queryKey: ['library'] as const,
  queryFn: async () => {
    const [favM, favS, watM, watS] = await Promise.all([
      getFavorites('movie').catch(() => []),
      getFavorites('series').catch(() => []),
      getWatchlistItems('movie').catch(() => []),
      getWatchlistItems('series').catch(() => []),
    ]);
    return {
      favorites: interleave(favM, favS),
      watchlist: interleave(watM, watS),
    };
  },
});

/**
 * Precalienta la Biblioteca para que al abrir la pestaña no aparezca el
 * skeleton. Debe llamarse DESPUÉS de activar el perfil: los datos dependen del
 * header X-Profile-Id. Best-effort: cualquier fallo se ignora.
 */
export function prefetchLibrary(qc: QueryClient): void {
  void qc.prefetchQuery(libraryQuery()).catch(() => undefined);
}

function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
}
