import type { QueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import type { ContinueWatchingItem } from '@/components/home/continue-watching-row';
import {
  apiFetch,
  type FeedSection,
  type FeedSectionsResponse,
  type MediaMeta,
  tmdbImage,
} from './api';

// Fuente única de las queries del Inicio: `home.tsx` las usa en sus `useQuery` y
// la selección de perfil las prefetchea con la MISMA queryKey, así React Query
// deduplica (no hay doble fetch) y el catálogo ya está en cache al montar Inicio.

/**
 * Hero del Inicio, en su propia query: es lo primero que se pinta y llega mucho
 * antes que las filas (que resuelven N catálogos de TMDB), así la pantalla carga
 * de forma progresiva en vez de esperar a todo el feed.
 */
export const feedHeroQuery = (lang: string) => ({
  queryKey: ['feed-sections', lang, 'hero'] as const,
  queryFn: () =>
    apiFetch<FeedSectionsResponse>('/api/onevid-feed/sections?only=hero'),
});

/** Filas del Inicio (sin hero). */
export const feedSectionsQuery = (lang: string) => ({
  queryKey: ['feed-sections', lang, 'sections'] as const,
  queryFn: () =>
    apiFetch<FeedSectionsResponse>('/api/onevid-feed/sections?only=sections'),
});

/** Feed de la pestaña Descubrir (misma superficie configurada en la web). */
export const discoverSectionsQuery = (lang: string) => ({
  queryKey: ['feed-sections', 'discover', lang] as const,
  // Descubrir no muestra hero: pedir solo las filas evita resolver el carrusel.
  queryFn: () =>
    apiFetch<FeedSectionsResponse>(
      '/api/onevid-feed/sections?surface=discover&only=sections',
    ),
});

export const continueWatchingQuery = (lang: string) => ({
  queryKey: ['continue-watching', lang] as const,
  queryFn: () =>
    apiFetch<{ results: ContinueWatchingItem[] }>('/api/onevid-progress').then(
      (r) => r.results ?? [],
    ),
});

export function prefetchMediaImages(items: MediaMeta[], limit = 16): void {
  const urls = items
    .map((it) => tmdbImage(it.background ?? it.poster, 'w780'))
    .filter((u): u is string => Boolean(u))
    .slice(0, limit);
  if (urls.length > 0) {
    Image.prefetch(urls, { cachePolicy: 'memory-disk' }).catch(() => undefined);
  }
}

/** Precarga las carátulas del hero (lo primero que se ve al entrar). */
export async function prefetchHeroImages(items: MediaMeta[]): Promise<void> {
  const urls = items
    .map((it) => tmdbImage(it.background ?? it.poster, 'w780'))
    .filter((u): u is string => Boolean(u));
  if (urls.length === 0) return;
  await Image.prefetch(urls, { cachePolicy: 'memory-disk' }).catch(
    () => undefined,
  );
}

/** Precarga las primeras carátulas de cada fila (después del hero). */
export function prefetchRowImages(sections: FeedSection[]): void {
  prefetchMediaImages(sections.flatMap((s) => s.items.slice(0, 6)));
}

/**
 * Precalienta SOLO el catálogo del Inicio (hero + filas + primeras carátulas).
 * No toca datos por-perfil ("Continuar viendo"), así que es seguro llamarlo de
 * forma especulativa mientras se muestra el selector de perfiles, antes de que el
 * usuario elija. Best-effort: cualquier fallo (p. ej. setup incompleto → 4xx) se
 * ignora en silencio.
 */
export async function prefetchFeed(qc: QueryClient, lang: string): Promise<void> {
  const [hero, sections] = await Promise.all([
    qc.fetchQuery(feedHeroQuery(lang)).catch(() => null),
    qc.fetchQuery(feedSectionsQuery(lang)).catch(() => null),
  ]);
  if (hero) void prefetchHeroImages(hero.hero ?? []);
  if (sections) prefetchRowImages(sections.sections ?? []);
}

/**
 * Precalienta la pestaña Descubrir para que su primer render no muestre
 * skeleton. No depende del perfil, así que se puede lanzar en paralelo al
 * precargar el catálogo del Inicio.
 */
export async function prefetchDiscover(
  qc: QueryClient,
  lang: string,
): Promise<void> {
  const feed = await qc.fetchQuery(discoverSectionsQuery(lang)).catch(() => null);
  if (feed) prefetchRowImages(feed.sections ?? []);
}

/**
 * Precalienta el catálogo de un perfil que aún está bloqueado por PIN sin
 * convertirlo en el perfil activo. Sólo carga las filas (públicas) y sus
 * imágenes; nunca pide datos privados por perfil como "Continuar viendo".
 *
 * La respuesta se devuelve para sembrar la cache normal después de validar el
 * PIN, sin esperar a que termine la precarga.
 */
export async function warmProfileFeed(
  profileId: string,
): Promise<FeedSectionsResponse | null> {
  const feed = await apiFetch<FeedSectionsResponse>(
    '/api/onevid-feed/sections?only=sections',
    { headers: { 'X-Profile-Id': profileId } },
  ).catch(() => null);
  if (!feed) return null;
  prefetchRowImages(feed.sections ?? []);
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
  // de entrar a Inicio sin datos y mostrar el skeleton. "Continuar viendo" puede
  // terminar en segundo plano sin bloquear el hero ni las filas ya precargadas.
  qc.prefetchQuery(continueWatchingQuery(lang)).catch(() => undefined);
  // El hero es best-effort (si falla, el Inicio lo pedirá al montar); las filas
  // sí son requisito para navegar sin skeleton.
  const heroPromise = qc
    .fetchQuery(feedHeroQuery(lang))
    .catch(() => null);
  const sections = await qc.fetchQuery(feedSectionsQuery(lang));
  void heroPromise.then((hero) => {
    if (hero) void prefetchHeroImages(hero.hero ?? []);
  });
  prefetchRowImages(sections.sections ?? []);
}
