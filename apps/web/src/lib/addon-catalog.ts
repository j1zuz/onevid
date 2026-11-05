/**
 * Resuelve el catálogo propio de UN addon: pega a su
 * `/catalog/:type/:id.json` (formato Stremio: `manifest.catalogs` + esa
 * ruta). Los ids que son IMDb (`tt…`) se hidratan contra TMDB para conservar
 * pósters/metadatos ricos; los ids propios del addon se mapean
 * directamente desde los `metas` del catálogo.
 */

import { encodeAddonMediaId } from "@/lib/addon-media";
import {
  fetchMovieMeta,
  fetchTvMeta,
  findTmdbIdByImdbId,
  type MediaMeta,
  TmdbAuthError,
} from "@/lib/tmdb";
import { safeFetch } from "@/utils/ssrf-guard";

// Tope por defecto (mismo que usa TMDB por página en discover/trending): de
// sobra para una fila del feed, que solo llega a mostrar 4 items (ver
// FEED_ROW_ITEM_LIMIT). La vista "Ver todo" en /home (ver isAddonView en
// home/page.tsx) pide explícitamente más vía `opts.limit`, ya que el addon
// devuelve su catálogo completo en una sola respuesta (no pagina con `skip`
// de forma confiable), y truncar antes de hidratar tira contenido real que el
// usuario nunca llega a ver.
export const CATALOG_ITEM_LIMIT = 20;

// Tope superior para "Ver todo": ninguna respuesta de addon debería traer más
// que esto, pero por si acaso no hidratamos un catálogo arbitrariamente
// grande (cada id extra es 1-2 requests más a TMDB).
export const CATALOG_VIEW_ALL_ITEM_LIMIT = 100;

interface StremioCatalogResponse {
  metas?: unknown;
}

// El catálogo de un addon puede tardar bastante (proveedores IPTV: ~20 s):
// se cachea en memoria para que el feed, "Ver todo" y la app no repitan la
// misma descarga seguida.
const CATALOG_CACHE_TTL_MS = 5 * 60_000;
/** Proveedores IPTV lentos tardan ~20 s; 10 s los hacía desaparecer del feed. */
const CATALOG_FETCH_TIMEOUT_MS = 30_000;
const catalogCache = new Map<
  string,
  { expiresAt: number; metas: StremioMetaPreview[] }
>();

interface StremioMetaPreview {
  background?: unknown;
  description?: unknown;
  genres?: unknown;
  id?: unknown;
  imdbRating?: unknown;
  logo?: unknown;
  name?: unknown;
  poster?: unknown;
  releaseInfo?: unknown;
  type?: unknown;
  videos?: unknown;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Solo arte HTTPS sin credenciales; el resto se descarta. */
function httpsUrl(value: unknown): string | undefined {
  const raw = str(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** Item de un addon sin hidratación TMDB (ids propios). */
function mapAddonMeta(
  raw: StremioMetaPreview,
  fallbackType: "movie" | "series",
  addonId: string
): MediaMeta | null {
  const id = str(raw.id);
  const name = str(raw.name);
  if (!id || !name) {
    return null;
  }
  const type =
    raw.type === "series"
      ? "series"
      : raw.type === "movie"
        ? "movie"
        : fallbackType;
  const encodedId = encodeAddonMediaId(addonId, id);
  // Si el catálogo ya trae el primer episodio, el player puede abrirlo sin
  // esperar a un selector de temporadas (que no existe para addons aún).
  let playId = encodedId;
  if (type === "series" && Array.isArray(raw.videos)) {
    const first = raw.videos.find(
      (video): video is Record<string, unknown> =>
        Boolean(video) && typeof video === "object"
    );
    const season = Number(first?.season);
    const episode = Number(first?.episode);
    if (Number.isInteger(season) && Number.isInteger(episode)) {
      playId = `${encodedId}:${season}:${episode}`;
    }
  }
  const poster = httpsUrl(raw.poster);
  const background = httpsUrl(raw.background);
  const params = new URLSearchParams({ title: name });
  const art = poster ?? background;
  if (art) {
    params.set("poster", art);
  }
  const genres = Array.isArray(raw.genres)
    ? raw.genres.filter((genre): genre is string => typeof genre === "string")
    : undefined;
  return {
    background,
    description: str(raw.description),
    genres,
    id: encodedId,
    imdbRating: str(raw.imdbRating),
    logo: httpsUrl(raw.logo),
    name,
    playHref: `/home/player/${type}/${encodeURIComponent(playId)}?${params.toString()}`,
    poster,
    releaseDate: str(raw.releaseInfo),
    type,
  };
}

async function resolveOne(
  raw: StremioMetaPreview,
  fallbackType: "movie" | "series",
  addonId: string,
  token: string,
  tmdbLocale: string,
  hydrateTmdb: boolean
): Promise<MediaMeta | null> {
  const id = str(raw.id);
  if (!id) {
    return null;
  }
  // Solo los ids IMDb pasan por TMDB; el resto usa los datos del addon.
  if (hydrateTmdb && id.startsWith("tt")) {
    try {
      const tmdbId = await findTmdbIdByImdbId(token, id, fallbackType);
      if (tmdbId) {
        const meta =
          fallbackType === "movie"
            ? await fetchMovieMeta(token, tmdbId, tmdbLocale)
            : await fetchTvMeta(token, tmdbId, tmdbLocale);
        if (meta) {
          return meta;
        }
      }
    } catch (error) {
      // Un token muerto sí debe propagarse (el setup vuelve a mostrarse).
      if (error instanceof TmdbAuthError) {
        throw error;
      }
      // Otro fallo (red/TMDB sin ese IMDb) cae al item del addon.
    }
  }
  return mapAddonMeta(raw, fallbackType, addonId);
}

export async function fetchAddonCatalogResults(opts: {
  addonBaseUrl: string;
  addonId: string;
  catalogId: string;
  hydrateTmdb?: boolean;
  limit?: number;
  tmdbLocale: string;
  token: string;
  type: "movie" | "series";
}): Promise<MediaMeta[]> {
  const {
    addonBaseUrl,
    addonId,
    catalogId,
    hydrateTmdb = true,
    limit = CATALOG_ITEM_LIMIT,
    tmdbLocale,
    token,
    type,
  } = opts;

  const cacheKey = `${addonBaseUrl}|${type}|${catalogId}`;
  const cached = catalogCache.get(cacheKey);
  let allMetas: StremioMetaPreview[];
  if (cached && cached.expiresAt > Date.now()) {
    allMetas = cached.metas;
  } else {
    try {
      const res = await safeFetch(
        `${addonBaseUrl}/catalog/${type}/${encodeURIComponent(catalogId)}.json`,
        { method: "GET", headers: { accept: "application/json" } },
        { timeoutMs: CATALOG_FETCH_TIMEOUT_MS },
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as StremioCatalogResponse;
      allMetas = Array.isArray(data.metas)
        ? (data.metas as StremioMetaPreview[]).slice(
            0,
            CATALOG_VIEW_ALL_ITEM_LIMIT
          )
        : [];
      catalogCache.set(cacheKey, {
        expiresAt: Date.now() + CATALOG_CACHE_TTL_MS,
        metas: allMetas,
      });
    } catch (error) {
      // Si el addon falla ahora pero tenemos una copia anterior, mostramos esa
      // en vez de hacer desaparecer la fila del feed.
      if (!cached) {
        throw error;
      }
      allMetas = cached.metas;
    }
  }

  const metas = allMetas.slice(0, limit);
  const [first, ...rest] = metas;
  if (!first) {
    return [];
  }

  // El primero deja propagar auth/red tal cual (si el token TMDB murió, toda
  // la fila debe fallar para que resolveFeed detecte el TmdbAuthError); el
  // resto es best-effort, igual que las páginas extra de TMDB.
  const firstItem = await resolveOne(
    first,
    type,
    addonId,
    token,
    tmdbLocale,
    hydrateTmdb
  );
  const resolvedRest = await Promise.allSettled(
    rest.map((meta) =>
      resolveOne(meta, type, addonId, token, tmdbLocale, hydrateTmdb)
    )
  );
  const restItems = resolvedRest.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : []
  );
  const seen = new Set<string>();
  return (firstItem ? [firstItem, ...restItems] : restItems).filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}
