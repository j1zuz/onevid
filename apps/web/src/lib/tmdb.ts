import { fetchJustWatchLinks } from "@/lib/justwatch";

const TMDB_BASE = "https://api.themoviedb.org";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

// El backend mapea poster/background a tamaños chicos (w500/w780), pensados
// para tarjetas. Para piezas grandes (el hero de /home) hace falta pedir una
// versión de mayor resolución — mismo approach que apps/mobile/src/lib/api.ts.
const TMDB_IMAGE_SIZE_RE =
  /image\.tmdb\.org\/t\/p\/(w92|w154|w185|w300|w342|w500|w780|w1280|original)\//;

export function tmdbImage(
  url: string | undefined,
  targetSize: "w185" | "w300" | "w500" | "w780" | "w1280" | "original"
): string | undefined {
  if (!url) {
    return url;
  }
  return url.replace(TMDB_IMAGE_SIZE_RE, `image.tmdb.org/t/p/${targetSize}/`);
}

const LOCALE_MAP: Record<string, string> = {
  "es-419": "es-MX",
  "es-ES": "es-ES",
  "en-US": "en-US",
  "fr-FR": "fr-FR",
  "de-DE": "de-DE",
  "hi-IN": "hi-IN",
  "id-ID": "id-ID",
  "it-IT": "it-IT",
  "ja-JP": "ja-JP",
  "ko-KR": "ko-KR",
  "pt-BR": "pt-BR",
  "nl-NL": "nl-NL",
  "ru-RU": "ru-RU",
  "tr-TR": "tr-TR",
};

export function getTmdbLocale(appLocale: string): string {
  return LOCALE_MAP[appLocale] ?? "es-MX";
}

const REGION_MAP: Record<string, string> = {
  "es-419": "MX",
  "es-ES": "ES",
  "en-US": "US",
  "fr-FR": "FR",
  "de-DE": "DE",
  "hi-IN": "IN",
  "id-ID": "ID",
  "it-IT": "IT",
  "ja-JP": "JP",
  "ko-KR": "KR",
  "pt-BR": "BR",
  "nl-NL": "NL",
  "ru-RU": "RU",
  "tr-TR": "TR",
};

export function getTmdbRegion(appLocale: string): string {
  return REGION_MAP[appLocale] ?? "MX";
}

// ─── Types ───────────────────────────────────────────────────────────

export interface CastMember {
  character?: string;
  id: string;
  name: string;
  profile?: string;
}

export interface NetworkRef {
  id: number;
  logo?: string;
  name: string;
}

export interface WatchProvider {
  id: number;
  /** Deep-link directo a la ficha del título en la plataforma (vía JustWatch). */
  link?: string;
  logo?: string;
  name: string;
}

export interface WatchProviders {
  // Compra (categoría `buy`).
  buy: WatchProvider[];
  // Plataformas de streaming por suscripción (categoría `flatrate`).
  flatrate: WatchProvider[];
  // Enlace a la página de TMDB/JustWatch de esa región.
  link?: string;
  region: string;
  // Alquiler (categoría `rent`).
  rent: WatchProvider[];
}

export interface MediaMeta {
  background?: string;
  cast?: CastMember[];
  creators?: string[];
  description?: string;
  director?: string[];
  episodeRunTime?: number;
  genres?: string[];
  id: string;
  imdbId?: string;
  imdbRating?: string;
  logo?: string;
  name: string;
  networks?: NetworkRef[];
  poster?: string;
  related?: MediaMeta[];
  releaseDate?: string;
  runtime?: number;
  status?: string;
  type: "movie" | "series";
  year?: string;
}

export interface EpisodeItem {
  description?: string;
  id: string;
  name: string;
  number: number;
  released?: string;
  season: number;
  thumbnail?: string;
}

export interface SeriesMetaResponse {
  background?: string;
  cast?: CastMember[];
  creators?: string[];
  description?: string;
  episodeRunTime?: number;
  episodes: EpisodeItem[];
  genres?: string[];
  imdbRating?: string;
  logo?: string;
  name: string;
  networks?: NetworkRef[];
  poster?: string;
  related?: MediaMeta[];
  releaseDate?: string;
  seasons: number[];
  status?: string;
  year?: string;
}

// Las listas estáticas de catálogos y cadenas viven en `onevid-feed.ts` (módulo
// puro, importable desde el cliente) y se re-exportan aquí para no romper a los
// consumidores que ya las importaban desde tmdb.
export {
  type CatalogOption,
  getCatalogOptions,
  type NetworkOption,
  getNetworkOptions,
} from "@/lib/onevid-feed";

// ─── Caches ──────────────────────────────────────────────────────────

let cachedImageBaseUrl: string | null = null;
let cachedMovieGenres: Map<number, string> | null = null;
let cachedTvGenres: Map<number, string> | null = null;

// ─── Core fetch ──────────────────────────────────────────────────────

interface TmdbErrorResponse {
  status_code?: number;
  status_message?: string;
}

export class TmdbAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TmdbAuthError";
  }
}

export class TmdbNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TmdbNetworkError";
  }
}

const TMDB_FETCH_TIMEOUT_MS = 8000;

async function tmdbFetch<T>(
  token: string,
  path: string,
  params?: Record<string, string>,
  revalidate?: number
): Promise<T> {
  const url = new URL(path, TMDB_BASE);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      next: revalidate ? { revalidate } : undefined,
      signal: AbortSignal.timeout(TMDB_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new TmdbNetworkError(`No se pudo conectar con TMDB (${path})`, {
      cause: error,
    });
  }

  if (res.status === 401) {
    throw new TmdbAuthError("Token TMDB inválido o expirado");
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as TmdbErrorResponse;
    throw new Error(body.status_message || `TMDB error ${res.status}`);
  }

  return res.json() as Promise<T>;
}

async function tmdbMutate<T>(
  token: string,
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const url = new URL(path, TMDB_BASE);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TMDB_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new TmdbNetworkError(`No se pudo conectar con TMDB (${path})`, {
      cause: error,
    });
  }

  if (res.status === 401) {
    throw new TmdbAuthError("Token TMDB inválido o expirado");
  }

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as TmdbErrorResponse;
    throw new Error(errorBody.status_message || `TMDB error ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ─── Image helpers ───────────────────────────────────────────────────

interface TmdbConfigResponse {
  images?: {
    secure_base_url?: string;
  };
}

export async function getImageBaseUrl(token: string): Promise<string> {
  if (cachedImageBaseUrl) {
    return cachedImageBaseUrl;
  }

  const data = await tmdbFetch<TmdbConfigResponse>(
    token,
    "/3/configuration",
    undefined,
    86_400
  );

  cachedImageBaseUrl = data.images?.secure_base_url || `${TMDB_IMAGE_BASE}/`;
  return cachedImageBaseUrl;
}

export async function buildImageUrl(
  token: string,
  path: string | null | undefined,
  size: string
): Promise<string | undefined> {
  if (!path) {
    return;
  }
  const base = await getImageBaseUrl(token);
  return `${base}${size}${path}`;
}

// ─── Genres ──────────────────────────────────────────────────────────

interface TmdbGenreListResponse {
  genres?: { id: number; name: string }[];
}

export async function fetchMovieGenres(
  token: string,
  locale?: string
): Promise<Map<number, string>> {
  if (cachedMovieGenres) {
    return cachedMovieGenres;
  }

  const data = await tmdbFetch<TmdbGenreListResponse>(
    token,
    "/3/genre/movie/list",
    { language: locale || "es-MX" },
    86_400
  );

  cachedMovieGenres = new Map((data.genres ?? []).map((g) => [g.id, g.name]));
  return cachedMovieGenres;
}

export async function fetchTvGenres(
  token: string,
  locale?: string
): Promise<Map<number, string>> {
  if (cachedTvGenres) {
    return cachedTvGenres;
  }

  const data = await tmdbFetch<TmdbGenreListResponse>(
    token,
    "/3/genre/tv/list",
    { language: locale || "es-MX" },
    86_400
  );

  cachedTvGenres = new Map((data.genres ?? []).map((g) => [g.id, g.name]));
  return cachedTvGenres;
}

// ─── Catalog options (static) ────────────────────────────────────────
// getCatalogOptions() / getNetworkOptions() se re-exportan arriba desde
// `onevid-feed.ts`.

export function catalogToSortBy(catalogId: string): string {
  switch (catalogId) {
    case "top":
      return "popularity.desc";
    case "year":
      return "primary_release_date.desc";
    case "imdbrating":
      return "vote_average.desc";
    default:
      return "popularity.desc";
  }
}

// ─── TMDB response shapes ────────────────────────────────────────────

interface TmdbMovieResult {
  backdrop_path?: string | null;
  first_air_date?: string;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  id: number;
  imdb_id?: string;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  release_date?: string;
  title?: string;
  vote_average?: number;
}

interface TmdbTvResult {
  backdrop_path?: string | null;
  first_air_date?: string;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  id: number;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  vote_average?: number;
}

interface TmdbDiscoverResponse {
  results?: (TmdbMovieResult | TmdbTvResult)[];
}

interface TmdbMovieDetail extends TmdbMovieResult {
  imdb_id?: string;
  runtime?: number;
  status?: string;
  tagline?: string;
}

interface TmdbTvNetwork {
  id?: number;
  logo_path?: string | null;
  name?: string;
}

interface TmdbTvCreator {
  id?: number;
  name?: string;
}

interface TmdbTvDetail extends TmdbTvResult {
  created_by?: TmdbTvCreator[];
  episode_run_time?: number[];
  networks?: TmdbTvNetwork[];
  number_of_seasons?: number;
  seasons?: { season_number: number; name: string }[];
  status?: string;
}

interface TmdbCreditPerson {
  character?: string;
  id: number;
  job?: string;
  name?: string;
  profile_path?: string | null;
}

interface TmdbCreditsResponse {
  cast?: TmdbCreditPerson[];
  crew?: TmdbCreditPerson[];
}

interface TmdbTvExternalIds {
  imdb_id?: string;
}

interface TmdbImageLogo {
  file_path?: string;
  iso_639_1?: string | null;
  width?: number;
}

interface TmdbImagesResponse {
  logos?: TmdbImageLogo[];
}

interface TmdbSeasonResponse {
  episodes?: {
    id: number;
    name?: string;
    episode_number?: number;
    overview?: string;
    still_path?: string | null;
    air_date?: string;
  }[];
  season_number?: number;
}

interface TmdbSearchResponse {
  results?: (TmdbMovieResult | TmdbTvResult)[];
}

// ─── Map helpers ─────────────────────────────────────────────────────

function mapMovieToMeta(
  item: TmdbMovieResult,
  genreMap?: Map<number, string>
): MediaMeta {
  const genreIds = item.genre_ids ?? item.genres?.map((g) => g.id) ?? [];
  const genres = genreMap
    ? genreIds
        .map((id) => genreMap.get(id))
        .filter((g): g is string => Boolean(g))
    : (item.genres?.map((g) => g.name) ?? []);

  return {
    id: String(item.id),
    imdbId: item.imdb_id,
    name: item.title || item.name || "",
    poster: item.poster_path
      ? `${TMDB_IMAGE_BASE}/w500${item.poster_path}`
      : undefined,
    background: item.backdrop_path
      ? `${TMDB_IMAGE_BASE}/w780${item.backdrop_path}`
      : undefined,
    description: item.overview || undefined,
    year: (item.release_date || item.first_air_date)?.slice(0, 4) || undefined,
    imdbRating: item.vote_average
      ? String(Number(item.vote_average).toFixed(1))
      : undefined,
    genres: genres.length > 0 ? genres : undefined,
    type: "movie",
  };
}

function mapTvToMeta(
  item: TmdbTvResult,
  genreMap?: Map<number, string>
): MediaMeta {
  const genreIds = item.genre_ids ?? item.genres?.map((g) => g.id) ?? [];
  const genres = genreMap
    ? genreIds
        .map((id) => genreMap.get(id))
        .filter((g): g is string => Boolean(g))
    : (item.genres?.map((g) => g.name) ?? []);

  return {
    id: String(item.id),
    name: item.name || "",
    poster: item.poster_path
      ? `${TMDB_IMAGE_BASE}/w500${item.poster_path}`
      : undefined,
    background: item.backdrop_path
      ? `${TMDB_IMAGE_BASE}/w780${item.backdrop_path}`
      : undefined,
    description: item.overview || undefined,
    year: (item.first_air_date || undefined)?.slice(0, 4) || undefined,
    imdbRating: item.vote_average
      ? String(Number(item.vote_average).toFixed(1))
      : undefined,
    genres: genres.length > 0 ? genres : undefined,
    type: "series",
  };
}

// ─── Discover ────────────────────────────────────────────────────────

export async function discoverMovies(
  token: string,
  sortBy?: string,
  page?: number,
  locale?: string,
  providerId?: number,
  region?: string,
  companyIds?: number[]
): Promise<MediaMeta[]> {
  const genreMap = await fetchMovieGenres(token, locale);
  const baseParams: Record<string, string> = {
    language: locale || "es-MX",
    sort_by: sortBy || "popularity.desc",
    page: String(page || 1),
    "vote_count.gte": sortBy === "vote_average.desc" ? "200" : "0",
  };

  if (sortBy === "primary_release_date.desc") {
    const year = new Date().getFullYear();
    baseParams["primary_release_date.gte"] = `${year}-01-01`;
    baseParams["primary_release_date.lte"] = `${year}-12-31`;
  }

  const runDiscover = async (
    extraParams: Record<string, string>
  ): Promise<MediaMeta[]> => {
    const data = await tmdbFetch<TmdbDiscoverResponse>(
      token,
      "/3/discover/movie",
      { ...baseParams, ...extraParams },
      300
    );
    return (data.results ?? []).map((item) =>
      mapMovieToMeta(item as TmdbMovieResult, genreMap)
    );
  };

  // No network selected: plain discover.
  if (!providerId) {
    return runDiscover({});
  }

  // Primary: titles actually available on this platform in the region.
  const byProvider = await runDiscover({
    with_watch_providers: String(providerId),
    watch_region: region || "MX",
  });
  if (byProvider.length > 0) {
    return byProvider;
  }

  // Fallback: the platform's original movies (region-independent). Kicks in
  // for chains that don't operate in the region (e.g. Hulu in MX).
  if (companyIds && companyIds.length > 0) {
    return runDiscover({ with_companies: companyIds.join("|") });
  }

  return byProvider;
}

export async function discoverTv(
  token: string,
  networkId?: number,
  sortBy?: string,
  page?: number,
  locale?: string
): Promise<MediaMeta[]> {
  const genreMap = await fetchTvGenres(token, locale);

  let tmdbSortBy = sortBy;
  if (sortBy === "primary_release_date.desc") {
    tmdbSortBy = "first_air_date.desc";
  }

  const params: Record<string, string> = {
    language: locale || "es-MX",
    sort_by: tmdbSortBy || "popularity.desc",
    page: String(page || 1),
    "vote_count.gte": sortBy === "vote_average.desc" ? "200" : "0",
  };

  if (networkId) {
    params.with_networks = String(networkId);
  }

  if (sortBy === "primary_release_date.desc") {
    const year = new Date().getFullYear();
    params["first_air_date.gte"] = `${year}-01-01`;
    params["first_air_date.lte"] = `${year}-12-31`;
  }

  const data = await tmdbFetch<TmdbDiscoverResponse>(
    token,
    "/3/discover/tv",
    params,
    300
  );

  return (data.results ?? []).map((item) =>
    mapTvToMeta(item as TmdbTvResult, genreMap)
  );
}

// ─── Trending ────────────────────────────────────────────────────────

export async function trendingMovies(
  token: string,
  page?: number,
  locale?: string
): Promise<MediaMeta[]> {
  const genreMap = await fetchMovieGenres(token, locale);
  const data = await tmdbFetch<TmdbDiscoverResponse>(
    token,
    "/3/trending/movie/week",
    { language: locale || "es-MX", page: String(page || 1) },
    300
  );
  return (data.results ?? []).map((item) =>
    mapMovieToMeta(item as TmdbMovieResult, genreMap)
  );
}

export async function trendingTv(
  token: string,
  page?: number,
  locale?: string
): Promise<MediaMeta[]> {
  const genreMap = await fetchTvGenres(token, locale);
  const data = await tmdbFetch<TmdbDiscoverResponse>(
    token,
    "/3/trending/tv/week",
    { language: locale || "es-MX", page: String(page || 1) },
    300
  );
  return (data.results ?? []).map((item) =>
    mapTvToMeta(item as TmdbTvResult, genreMap)
  );
}

// ─── Credits / Related ───────────────────────────────────────────────

const CAST_LIMIT = 10;
const RELATED_LIMIT = 8;

function mapCast(items: TmdbCreditPerson[] | undefined): CastMember[] {
  return (items ?? []).slice(0, CAST_LIMIT).map((c) => ({
    id: String(c.id),
    name: c.name || "",
    character: c.character || undefined,
    profile: c.profile_path
      ? `${TMDB_IMAGE_BASE}/w185${c.profile_path}`
      : undefined,
  }));
}

function tmdbApiType(type: "movie" | "series"): "movie" | "tv" {
  return type === "movie" ? "movie" : "tv";
}

export async function fetchCast(
  token: string,
  type: "movie" | "series",
  tmdbId: string,
  locale?: string
): Promise<{ cast: CastMember[]; crew: TmdbCreditPerson[] }> {
  const data = await tmdbFetch<TmdbCreditsResponse>(
    token,
    `/3/${tmdbApiType(type)}/${tmdbId}/credits`,
    { language: locale || "es-MX" },
    600
  );
  return { cast: mapCast(data.cast), crew: data.crew ?? [] };
}

export async function fetchRelated(
  token: string,
  type: "movie" | "series",
  tmdbId: string,
  locale?: string
): Promise<MediaMeta[]> {
  const genreMap =
    type === "movie"
      ? await fetchMovieGenres(token, locale)
      : await fetchTvGenres(token, locale);

  const data = await tmdbFetch<TmdbDiscoverResponse>(
    token,
    `/3/${tmdbApiType(type)}/${tmdbId}/similar`,
    { language: locale || "es-MX", page: "1" },
    600
  );

  return (data.results ?? [])
    .slice(0, RELATED_LIMIT)
    .map((item) =>
      type === "movie"
        ? mapMovieToMeta(item as TmdbMovieResult, genreMap)
        : mapTvToMeta(item as TmdbTvResult, genreMap)
    );
}

function mapNetworks(items: TmdbTvNetwork[] | undefined): NetworkRef[] {
  return (items ?? []).flatMap((n) => {
    if (!(n.id && n.name)) {
      return [];
    }
    const network: NetworkRef = { id: n.id, name: n.name };
    if (n.logo_path) {
      network.logo = `${TMDB_IMAGE_BASE}/w185${n.logo_path}`;
    }
    return [network];
  });
}

// ─── Meta liviano (sin cast/related/logo) ─────────────────────────────

/**
 * Versión liviana de `fetchMovieDetail`/`fetchTvDetail`: solo el detalle base
 * (poster, título, año, rating…), sin cast/related/logo. La usa
 * `addon-catalog.ts` para hidratar cada item de un catálogo de addon — ahí
 * se resuelven varios ids en paralelo y pedir cast+related+logo por cada uno
 * sería mucho más costoso de lo que una fila de feed necesita mostrar.
 */
export async function fetchMovieMeta(
  token: string,
  tmdbId: string,
  locale?: string
): Promise<MediaMeta> {
  const genreMap = await fetchMovieGenres(token, locale);
  const detail = await tmdbFetch<TmdbMovieDetail>(
    token,
    `/3/movie/${tmdbId}`,
    { language: locale || "es-MX" },
    600
  );
  const meta = mapMovieToMeta(detail, genreMap);
  meta.imdbId = detail.imdb_id || undefined;
  return meta;
}

export async function fetchTvMeta(
  token: string,
  tmdbId: string,
  locale?: string
): Promise<MediaMeta> {
  const genreMap = await fetchTvGenres(token, locale);
  const detail = await tmdbFetch<TmdbTvDetail>(
    token,
    `/3/tv/${tmdbId}`,
    { language: locale || "es-MX" },
    600
  );
  return mapTvToMeta(detail, genreMap);
}

// ─── Detail ──────────────────────────────────────────────────────────

const EMPTY_CREDITS: { cast: CastMember[]; crew: TmdbCreditPerson[] } = {
  cast: [],
  crew: [],
};

export async function fetchMovieDetail(
  token: string,
  tmdbId: string,
  locale?: string
): Promise<MediaMeta> {
  const genreMap = await fetchMovieGenres(token, locale);

  const [detail, credits, related, logo] = await Promise.all([
    tmdbFetch<TmdbMovieDetail>(
      token,
      `/3/movie/${tmdbId}`,
      { language: locale || "es-MX" },
      600
    ),
    fetchCast(token, "movie", tmdbId, locale).catch(() => EMPTY_CREDITS),
    fetchRelated(token, "movie", tmdbId, locale).catch(() => [] as MediaMeta[]),
    fetchMovieLogo(token, tmdbId, locale).catch(() => undefined),
  ]);

  const meta = mapMovieToMeta(detail, genreMap);
  meta.imdbId = detail.imdb_id || undefined;
  meta.logo = logo;
  meta.cast = credits.cast.length > 0 ? credits.cast : undefined;

  const directors = credits.crew
    .filter((c) => c.job === "Director")
    .map((c) => c.name || "")
    .filter(Boolean);
  meta.director = directors.length > 0 ? directors : undefined;

  meta.status = detail.status || undefined;
  meta.runtime = detail.runtime || undefined;
  meta.releaseDate = detail.release_date || undefined;
  meta.related = related.length > 0 ? related : undefined;

  return meta;
}

export async function fetchTvDetail(
  token: string,
  tmdbId: string,
  locale?: string
): Promise<MediaMeta> {
  const genreMap = await fetchTvGenres(token, locale);

  const [detail, externalIds, credits, related, logo] = await Promise.all([
    tmdbFetch<TmdbTvDetail>(
      token,
      `/3/tv/${tmdbId}`,
      { language: locale || "es-MX" },
      600
    ),
    tmdbFetch<TmdbTvExternalIds>(
      token,
      `/3/tv/${tmdbId}/external_ids`,
      undefined,
      600
    ).catch(() => ({ imdb_id: undefined })),
    fetchCast(token, "series", tmdbId, locale).catch(() => EMPTY_CREDITS),
    fetchRelated(token, "series", tmdbId, locale).catch(
      () => [] as MediaMeta[]
    ),
    fetchTvLogo(token, tmdbId, locale).catch(() => undefined),
  ]);

  const meta = mapTvToMeta(detail, genreMap);
  meta.imdbId = externalIds.imdb_id || undefined;
  meta.logo = logo;
  meta.cast = credits.cast.length > 0 ? credits.cast : undefined;

  const creators = (detail.created_by ?? [])
    .map((c) => c.name || "")
    .filter(Boolean);
  meta.creators = creators.length > 0 ? creators : undefined;

  const networks = mapNetworks(detail.networks);
  meta.networks = networks.length > 0 ? networks : undefined;

  meta.status = detail.status || undefined;
  meta.episodeRunTime = detail.episode_run_time?.[0] || undefined;
  meta.releaseDate = detail.first_air_date || undefined;
  meta.related = related.length > 0 ? related : undefined;

  return meta;
}

/**
 * Lightweight fetch of ONLY the localized title/name for a title. Used to
 * refresh the "Continue watching" names (stored at watch-time, so frozen in the
 * language used then) to the current locale — much cheaper than a full
 * fetchMovieDetail/fetchTvDetail, which pulls credits, related, logos, etc.
 */
export async function fetchLocalizedTitle(
  token: string,
  type: "movie" | "series",
  tmdbId: string,
  locale?: string
): Promise<string | undefined> {
  const path = type === "series" ? `/3/tv/${tmdbId}` : `/3/movie/${tmdbId}`;
  const data = await tmdbFetch<{ title?: string; name?: string }>(
    token,
    path,
    { language: locale || "es-MX" },
    600
  );
  const title = type === "series" ? data.name : data.title;
  return title?.trim() || undefined;
}

// ─── Images (logos) ──────────────────────────────────────────────────

function localeToLang(locale?: string): string | undefined {
  if (!locale) {
    return;
  }
  const lang = locale.split("-")[0]?.trim().toLowerCase();
  return lang || undefined;
}

interface TmdbWatchProvider {
  display_priority?: number;
  logo_path?: string | null;
  provider_id?: number;
  provider_name?: string;
}

interface TmdbWatchRegion {
  ads?: TmdbWatchProvider[];
  buy?: TmdbWatchProvider[];
  flatrate?: TmdbWatchProvider[];
  free?: TmdbWatchProvider[];
  link?: string;
  rent?: TmdbWatchProvider[];
}

interface TmdbWatchProvidersResponse {
  id?: number;
  results?: Record<string, TmdbWatchRegion>;
}

function mapWatchProviders(
  items: TmdbWatchProvider[] | undefined
): WatchProvider[] {
  return (items ?? [])
    .slice()
    .sort((a, b) => (a.display_priority ?? 0) - (b.display_priority ?? 0))
    .flatMap((p) => {
      if (!(p.provider_id && p.provider_name)) {
        return [];
      }
      const provider: WatchProvider = {
        id: p.provider_id,
        name: p.provider_name,
      };
      if (p.logo_path) {
        provider.logo = `${TMDB_IMAGE_BASE}/w154${p.logo_path}`;
      }
      return [provider];
    });
}

/**
 * Plataformas de streaming (por suscripción) donde está disponible el título.
 * La lista y los logos vienen de TMDB; los deep-links directos a cada
 * plataforma vienen de JustWatch (cruzados por `provider_id == packageId`),
 * porque TMDB solo expone un enlace agregador a su propia página.
 *
 * Se usa como alternativa cuando la app no tiene fuentes propias para
 * reproducir. Con `title` (y opcionalmente `year`) se resuelven los deep-links.
 */
export async function fetchWatchProviders(
  token: string,
  type: "movie" | "series",
  tmdbId: string,
  region: string,
  opts?: { language?: string; title?: string; year?: number }
): Promise<WatchProviders> {
  const path = `/3/${type === "series" ? "tv" : "movie"}/${tmdbId}/watch/providers`;
  const data = await tmdbFetch<TmdbWatchProvidersResponse>(
    token,
    path,
    undefined,
    3600
  );

  const regionData = data.results?.[region];
  const flatrate = mapWatchProviders(regionData?.flatrate);
  const rent = mapWatchProviders(regionData?.rent);
  const buy = mapWatchProviders(regionData?.buy);

  // Enriquecer con los deep-links reales de JustWatch (best-effort).
  if ((flatrate.length || rent.length || buy.length) && opts?.title) {
    const links = await fetchJustWatchLinks({
      title: opts.title,
      year: opts.year,
      type,
      country: region,
      language: opts.language || "en",
    });
    for (const provider of [...flatrate, ...rent, ...buy]) {
      const link = links.get(provider.id);
      if (link) {
        provider.link = link;
      }
    }
  }

  return {
    region,
    link: regionData?.link,
    flatrate,
    rent,
    buy,
  };
}

// ─── Trailer (YouTube vía TMDB) ──────────────────────────────────────

interface TmdbVideo {
  key?: string;
  official?: boolean;
  site?: string;
  type?: string;
}

interface TmdbVideosResponse {
  results?: TmdbVideo[];
}

function pickTrailerKey(results: TmdbVideo[] | undefined): string | undefined {
  const youtube = (results ?? []).filter(
    (v) => v.site === "YouTube" && v.key
  );
  if (youtube.length === 0) {
    return;
  }
  const trailers = youtube.filter((v) => v.type === "Trailer");
  const teasers = youtube.filter((v) => v.type === "Teaser");
  const pool =
    trailers.length > 0 ? trailers : teasers.length > 0 ? teasers : youtube;
  return (pool.find((v) => v.official) ?? pool[0]).key;
}

/**
 * Clave de YouTube del mejor tráiler del título. Prefiere el idioma de la app y
 * cae a `en-US` si no hay tráiler localizado. Devuelve `undefined` si no hay.
 */
export async function fetchTrailerKey(
  token: string,
  type: "movie" | "series",
  tmdbId: string,
  locale?: string
): Promise<string | undefined> {
  const path = `/3/${type === "series" ? "tv" : "movie"}/${tmdbId}/videos`;

  const localized = await tmdbFetch<TmdbVideosResponse>(
    token,
    path,
    { language: locale || "es-MX" },
    3600
  ).catch(() => ({ results: [] }) as TmdbVideosResponse);

  const key = pickTrailerKey(localized.results);
  if (key) {
    return key;
  }

  // Fallback a inglés: muchos títulos solo tienen el tráiler en en-US.
  const english = await tmdbFetch<TmdbVideosResponse>(
    token,
    path,
    { language: "en-US" },
    3600
  ).catch(() => ({ results: [] }) as TmdbVideosResponse);

  return pickTrailerKey(english.results);
}

export async function fetchMovieLogo(
  token: string,
  tmdbId: string,
  locale?: string
): Promise<string | undefined> {
  const lang = localeToLang(locale);
  const data = await tmdbFetch<TmdbImagesResponse>(
    token,
    `/3/movie/${tmdbId}/images`,
    undefined,
    3600
  );

  return pickLogo(data.logos, lang);
}

export async function fetchTvLogo(
  token: string,
  tmdbId: string,
  locale?: string
): Promise<string | undefined> {
  const lang = localeToLang(locale);
  const data = await tmdbFetch<TmdbImagesResponse>(
    token,
    `/3/tv/${tmdbId}/images`,
    undefined,
    3600
  );

  return pickLogo(data.logos, lang);
}

function pickLogo(
  logos: TmdbImageLogo[] | undefined,
  preferredLang?: string
): string | undefined {
  if (!logos || logos.length === 0) {
    return;
  }

  const preferred =
    (preferredLang
      ? logos.find((l) => l.iso_639_1 === preferredLang)
      : undefined) ||
    logos.find((l) => l.iso_639_1 === "en") ||
    logos.find((l) => l.iso_639_1 === null) ||
    logos[0];

  if (!preferred?.file_path) {
    return;
  }
  return `${TMDB_IMAGE_BASE}/w500${preferred.file_path}`;
}

// ─── Season / Episodes ───────────────────────────────────────────────

export async function fetchTvSeason(
  token: string,
  tmdbId: string,
  seasonNumber: number,
  imdbId?: string,
  locale?: string
): Promise<EpisodeItem[]> {
  const data = await tmdbFetch<TmdbSeasonResponse>(
    token,
    `/3/tv/${tmdbId}/season/${seasonNumber}`,
    { language: locale || "es-MX" },
    300
  );

  return (data.episodes ?? []).map((ep) => ({
    id: imdbId
      ? `${imdbId}:${seasonNumber}:${ep.episode_number ?? 0}`
      : `${tmdbId}:${seasonNumber}:${ep.episode_number ?? 0}`,
    name: ep.name || "",
    season: seasonNumber,
    number: ep.episode_number ?? 0,
    description: ep.overview || undefined,
    thumbnail: ep.still_path
      ? `${TMDB_IMAGE_BASE}/w780${ep.still_path}`
      : undefined,
    released: ep.air_date || undefined,
  }));
}

export async function fetchTvSeriesMeta(
  token: string,
  tmdbId: string,
  locale?: string
): Promise<SeriesMetaResponse> {
  const [meta, detail] = await Promise.all([
    fetchTvDetail(token, tmdbId, locale),
    tmdbFetch<TmdbTvDetail>(
      token,
      `/3/tv/${tmdbId}`,
      { language: locale || "es-MX" },
      600
    ),
  ]);

  const imdbId = meta.imdbId;
  const seasonNumbers = (detail.seasons ?? [])
    .map((s) => s.season_number)
    .filter((n) => n > 0);

  // Fetch all seasons in parallel
  const seasonResults = await Promise.allSettled(
    seasonNumbers.map((n) => fetchTvSeason(token, tmdbId, n, imdbId, locale))
  );

  const episodes: EpisodeItem[] = [];
  for (const result of seasonResults) {
    if (result.status === "fulfilled") {
      episodes.push(...result.value);
    }
  }

  return {
    name: meta.name,
    poster: meta.poster,
    background: meta.background,
    logo: meta.logo,
    description: meta.description,
    year: meta.year,
    imdbRating: meta.imdbRating,
    genres: meta.genres,
    cast: meta.cast,
    creators: meta.creators,
    networks: meta.networks,
    status: meta.status,
    episodeRunTime: meta.episodeRunTime,
    releaseDate: meta.releaseDate,
    related: meta.related,
    seasons: seasonNumbers,
    episodes,
  };
}

// ─── Search ──────────────────────────────────────────────────────────

export async function searchMovies(
  token: string,
  query: string,
  page?: number,
  locale?: string
): Promise<MediaMeta[]> {
  // En paralelo, no en serie: la lista de géneros solo queda cacheada a
  // partir de la primera llamada del proceso, así que encadenarla le sumaba
  // un round-trip completo a TMDB a la primera búsqueda. Y si falla, seguimos
  // con los resultados sin géneros en vez de dejar la búsqueda vacía.
  const [genreMap, data] = await Promise.all([
    fetchMovieGenres(token, locale).catch(() => undefined),
    tmdbFetch<TmdbSearchResponse>(token, "/3/search/movie", {
      query,
      language: locale || "es-MX",
      page: String(page || 1),
    }),
  ]);

  return (data.results ?? []).map((item) =>
    mapMovieToMeta(item as TmdbMovieResult, genreMap)
  );
}

export async function searchTv(
  token: string,
  query: string,
  page?: number,
  locale?: string
): Promise<MediaMeta[]> {
  // Igual que searchMovies: géneros y búsqueda en paralelo, y un fallo de
  // géneros no invalida los resultados.
  const [genreMap, data] = await Promise.all([
    fetchTvGenres(token, locale).catch(() => undefined),
    tmdbFetch<TmdbSearchResponse>(token, "/3/search/tv", {
      query,
      language: locale || "es-MX",
      page: String(page || 1),
    }),
  ]);

  return (data.results ?? []).map((item) =>
    mapTvToMeta(item as TmdbTvResult, genreMap)
  );
}

// ─── IMDb ID resolution ─────────────────────────────────────────────

export async function findImdbId(
  token: string,
  tmdbId: string,
  type: "movie" | "series"
): Promise<string | undefined> {
  if (type === "movie") {
    const data = await tmdbFetch<TmdbMovieDetail>(
      token,
      `/3/movie/${tmdbId}`,
      undefined,
      3600
    );
    return data.imdb_id || undefined;
  }

  const data = await tmdbFetch<TmdbTvExternalIds>(
    token,
    `/3/tv/${tmdbId}/external_ids`,
    undefined,
    3600
  );
  return data.imdb_id || undefined;
}

interface TmdbFindResponse {
  movie_results?: TmdbMovieResult[];
  tv_results?: TmdbTvResult[];
}

/**
 * La dirección inversa de `findImdbId`: dado un IMDb id (el formato que
 * devuelven los catálogos estilo Stremio, p. ej. los de un addon OneVLP),
 * resuelve el TMDB id equivalente. Sin esto no se puede hidratar poster,
 * título ni el resto de `MediaMeta` para esos items.
 */
export async function findTmdbIdByImdbId(
  token: string,
  imdbId: string,
  type: "movie" | "series"
): Promise<string | undefined> {
  const data = await tmdbFetch<TmdbFindResponse>(
    token,
    `/3/find/${imdbId}`,
    { external_source: "imdb_id" },
    3600
  );
  const results = type === "movie" ? data.movie_results : data.tv_results;
  const first = results?.[0];
  return first ? String(first.id) : undefined;
}

// ─── OAuth v4 (user authentication) ──────────────────────────────────

interface TmdbRequestTokenResponse {
  request_token?: string;
  success?: boolean;
}

interface TmdbAccessTokenResponse {
  access_token?: string;
  account_id?: string;
  success?: boolean;
}

/**
 * Step 1 of the v4 user auth flow. Uses the hackw app token (not a user token)
 * to mint a request_token the user then approves on themoviedb.org.
 */
export async function tmdbCreateRequestToken(
  appToken: string,
  redirectTo: string
): Promise<string> {
  const data = await tmdbMutate<TmdbRequestTokenResponse>(
    appToken,
    "/4/auth/request_token",
    { redirect_to: redirectTo }
  );
  if (!data.request_token) {
    throw new Error("TMDB no devolvió un request_token");
  }
  return data.request_token;
}

/**
 * Step 2 of the v4 user auth flow. Exchanges an approved request_token for a
 * non-expiring user access token + account id.
 */
export async function tmdbCreateAccessToken(
  appToken: string,
  requestToken: string
): Promise<{ accessToken: string; accountId: string }> {
  const data = await tmdbMutate<TmdbAccessTokenResponse>(
    appToken,
    "/4/auth/access_token",
    { request_token: requestToken }
  );
  if (!(data.access_token && data.account_id)) {
    throw new Error("TMDB no devolvió un access_token");
  }
  return { accessToken: data.access_token, accountId: data.account_id };
}

// ─── Favorites / Watchlist ───────────────────────────────────────────

interface TmdbAccountStatesResponse {
  favorite?: boolean;
  watchlist?: boolean;
}

/** Per-title favorite/watchlist state for the authenticated user. */
export async function fetchAccountStates(
  token: string,
  type: "movie" | "series",
  tmdbId: string
): Promise<{ favorite: boolean; watchlist: boolean }> {
  const data = await tmdbFetch<TmdbAccountStatesResponse>(
    token,
    `/3/${tmdbApiType(type)}/${tmdbId}/account_states`
  );
  return {
    favorite: Boolean(data.favorite),
    watchlist: Boolean(data.watchlist),
  };
}

/** Toggle a title's favorite flag on the user's TMDB account. */
export async function tmdbSetFavorite(
  token: string,
  accountId: string,
  type: "movie" | "series",
  tmdbId: string,
  favorite: boolean
): Promise<void> {
  await tmdbMutate(token, `/3/account/${accountId}/favorite`, {
    media_type: tmdbApiType(type),
    media_id: Number(tmdbId),
    favorite,
  });
}

/** Toggle a title's watchlist flag on the user's TMDB account. */
export async function tmdbSetWatchlist(
  token: string,
  accountId: string,
  type: "movie" | "series",
  tmdbId: string,
  watchlist: boolean
): Promise<void> {
  await tmdbMutate(token, `/3/account/${accountId}/watchlist`, {
    media_type: tmdbApiType(type),
    media_id: Number(tmdbId),
    watchlist,
  });
}

/** Read the user's favorites or watchlist (v4 account lists). */
export async function fetchAccountList(
  token: string,
  accountId: string,
  kind: "favorites" | "watchlist",
  type: "movie" | "series",
  locale?: string,
  page?: number
): Promise<MediaMeta[]> {
  const genreMap =
    type === "movie"
      ? await fetchMovieGenres(token, locale)
      : await fetchTvGenres(token, locale);

  const data = await tmdbFetch<TmdbDiscoverResponse>(
    token,
    `/4/account/${accountId}/${tmdbApiType(type)}/${kind}`,
    { language: locale || "es-MX", page: String(page || 1) }
  );

  return (data.results ?? []).map((item) =>
    type === "movie"
      ? mapMovieToMeta(item as TmdbMovieResult, genreMap)
      : mapTvToMeta(item as TmdbTvResult, genreMap)
  );
}
