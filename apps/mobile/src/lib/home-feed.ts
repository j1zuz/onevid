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

function prefetchFeedImages(feed: FeedSectionsResponse): void {
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

/**
 * Precalienta SOLO el catálogo del Inicio (JSON del feed + primeros backdrops).
 * No toca datos por-perfil ("Continuar viendo"), así que es seguro llamarlo de
 * forma especulativa mientras se muestra el selector de perfiles, antes de que el
 * usuario elija. Best-effort: cualquier fallo (p. ej. setup incompleto → 4xx) se
 * ignora en silencio.
 */
export async function prefetchFeed(qc: QueryClient, lang: string): Promise<void> {
  const feed = await qc.fetchQuery(feedSectionsQuery(lang)).catch(() => null);
  if (!feed) return;
  prefetchFeedImages(feed);
}

/**
 * Precalienta el catálogo de un perfil que aún está bloqueado por PIN sin
 * convertirlo en el perfil activo. Sólo carga el feed y sus imágenes públicas;
 * nunca pide datos privados por perfil como "Continuar viendo".
 *
 * La respuesta se devuelve para sembrar la cache normal después de validar el
 * PIN. Esto evita que `setActiveProfile` limpie el trabajo especulativo junto con
 * la cache del perfil anterior.
 */
export async function warmProfileFeed(
  profileId: string,
): Promise<FeedSectionsResponse | null> {
  const feed = await apiFetch<FeedSectionsResponse>('/api/onevid-feed/sections', {
    headers: { 'X-Profile-Id': profileId },
  }).catch(() => null);
  if (!feed) return null;
  prefetchFeedImages(feed);
  return feed;
}

/**
 * Precalienta el Inicio completo (catálogo + "Continuar viendo") para que, al
 * entrar desde la selección de perfil, todo esté listo y no se vea el fallback
 * gris. Debe llamarse DESPUÉS de fijar el perfil activo, porque "Continuar
 * viendo" va con el header X-Profile-Id del perfil elegido.
 */
export async function prefetchHome(qc: QueryClient, lang: string): Promise<void> {
  // Disparamos el historial al mismo tiempo, pero el feed es el requisito para
  // navegar: si falla dejamos que el error llegue al selector de perfiles en vez
  // de entrar a Inicio sin datos y mostrar el skeleton mientras React Query
  // vuelve a intentarlo. "Continuar viendo" puede terminar en segundo plano sin
  // bloquear el hero ni las filas ya precargadas.
  qc.prefetchQuery(continueWatchingQuery(lang)).catch(() => undefined);
  const feed = await qc.fetchQuery(feedSectionsQuery(lang));
  prefetchFeedImages(feed);
}
