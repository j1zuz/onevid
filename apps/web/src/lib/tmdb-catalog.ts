import {
  catalogToSortBy,
  discoverMovies,
  discoverTv,
  type MediaMeta,
  type NetworkOption,
  trendingMovies,
  trendingTv,
} from "@/lib/tmdb";

/**
 * Resuelve los resultados de UNA fila de catálogo: 'trending' sin cadena usa
 * el endpoint /trending de TMDB (semanal); el resto (y 'trending' CON cadena,
 * ya que /trending no acepta with_watch_providers/with_networks) usa discover
 * con sort_by. Lo comparten `/api/onevid-catalog` (que sirve a la app mobile),
 * la vista "Ver todo" de /home y cada fila del feed de inicio.
 */
export function fetchCatalogResults(opts: {
  // Acepta también el legacy "top" que sigue mandando la app mobile.
  catalog: string;
  network?: NetworkOption;
  page?: number;
  tmdbLocale: string;
  tmdbRegion: string;
  token: string;
  type: "movie" | "series";
}): Promise<MediaMeta[]> {
  const { catalog, network, tmdbLocale, tmdbRegion, token, type } = opts;
  const page = opts.page ?? 1;

  if (catalog === "trending" && !network) {
    return type === "movie"
      ? trendingMovies(token, page, tmdbLocale)
      : trendingTv(token, page, tmdbLocale);
  }

  const sortBy = catalogToSortBy(catalog);
  return type === "movie"
    ? discoverMovies(
        token,
        sortBy,
        page,
        tmdbLocale,
        network?.providerId,
        tmdbRegion,
        network?.companyIds
      )
    : discoverTv(token, network?.id, sortBy, page, tmdbLocale);
}

// TMDB devuelve un tamaño de página fijo de 20 resultados en discover/trending.
const TMDB_PAGE_SIZE = 20;

/** Mínimo de resultados que debe traer la vista "Ver todo" de una fila. */
export const VIEW_ALL_MIN_ITEMS = 100;

/**
 * Igual que `fetchCatalogResults`, pero trae suficientes páginas para reunir
 * al menos `minCount` resultados (la vista "Ver todo" no debe quedarse con
 * los ~20 de una sola página de TMDB). La primera página deja propagar sus
 * errores (auth/red) tal cual, ya que sin ella no hay nada que mostrar; las
 * páginas extra son best-effort — si una falla, se descartan sus resultados
 * en vez de tirar toda la vista.
 */
export async function fetchCatalogResultsAtLeast(
  opts: Omit<Parameters<typeof fetchCatalogResults>[0], "page">,
  minCount: number
): Promise<MediaMeta[]> {
  const pagesNeeded = Math.max(1, Math.ceil(minCount / TMDB_PAGE_SIZE));
  const firstPage = await fetchCatalogResults({ ...opts, page: 1 });

  if (pagesNeeded <= 1 || firstPage.length < TMDB_PAGE_SIZE) {
    // TMDB ya no tiene más resultados que ofrecer (o con la primera alcanza).
    return firstPage;
  }

  const extraPages = await Promise.allSettled(
    Array.from({ length: pagesNeeded - 1 }, (_, i) =>
      fetchCatalogResults({ ...opts, page: i + 2 })
    )
  );
  const rest = extraPages.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );

  // El ranking de TMDB (popularidad, etc.) puede reordenarse entre requests de
  // páginas distintas, así que un mismo título a veces aparece en dos páginas
  // a la vez — sin deduplicar, React se queja de keys repetidas en la grilla.
  const seen = new Set<string>();
  return [...firstPage, ...rest].filter((item) => {
    const key = `${item.type}-${item.id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
