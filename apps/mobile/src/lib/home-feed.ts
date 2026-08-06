import type { QueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import type { ContinueWatchingItem } from '@/components/home/continue-watching-row';
import { apiFetch, type FeedSectionsResponse, tmdbImage } from './api';

// Fuente única de las queries del Inicio: `home.tsx` las usa en sus `useQuery` y
// la selección de perfil las prefetchea con la MISMA queryKey, así React Query
// deduplica (no hay doble fetch) y el catálogo ya está en cache al montar Inicio.

export const feedSectionsQuery = (lang: string) => ({
  queryKey: ['feed-sections', lang] as const,
  queryFn: () => apiFetch<FeedSectionsResponse>('/api/onevid-feed/sections'),
});

export const continueWatchingQuery = (lang: string) => ({
  queryKey: ['continue-watching', lang] as const,
  queryFn: () =>
    apiFetch<{ results: ContinueWatchingItem[] }>('/api/onevid-progress').then(
      (r) => r.results ?? [],
    ),
});

/**
 * Precalienta el feed del Inicio (JSON + primeros backdrops) para que, al entrar
 * desde la selección de perfil, las carátulas ya estén listas y no se vea el
 * fallback gris. Best-effort: cualquier fallo (p. ej. setup incompleto → 4xx) se
 * ignora en silencio. Debe llamarse DESPUÉS de fijar el perfil activo, porque el
 * feed va con el header X-Profile-Id.
 */
export async function prefetchHome(qc: QueryClient, lang: string): Promise<void> {
  const feed = await qc.fetchQuery(feedSectionsQuery(lang)).catch(() => null);
  qc.prefetchQuery(continueWatchingQuery(lang)).catch(() => undefined);
  if (!feed) return;
  const items = [
    ...(feed.hero ?? []),
    ...(feed.sections ?? []).flatMap((s) => s.items.slice(0, 6)),
  ];
  const urls = items
    .map((it) => tmdbImage(it.background ?? it.poster, 'w780'))
    .filter((u): u is string => Boolean(u))
    .slice(0, 16);
  if (urls.length > 0) {
    Image.prefetch(urls, { cachePolicy: 'memory-disk' }).catch(() => undefined);
  }
}
