/**
 * Resuelve el catálogo propio de UN addon: pega a su
 * `/catalog/:type/:id.json` (formato Stremio: `manifest.catalogs` + esa
 * ruta), toma los ids IMDb que trae, y los hidrata a `MediaMeta` vía TMDB
 * (find IMDb → TMDB, luego detalle liviano). Es la contraparte de
 * `fetchCatalogResults` (que resuelve filas de TMDB), usada por
 * `resolveFeed` cuando `row.catalog === "addon"`.
 */

import {
  fetchMovieMeta,
  fetchTvMeta,
  findTmdbIdByImdbId,
  type MediaMeta,
} from "@/lib/tmdb";
import { safeFetch } from "@/utils/ssrf-guard";

// Mismo tope que usa TMDB por página (discover/trending): ni un addon ni TMDB
// necesitan servir más de lo que ninguna fila del feed llega a mostrar.
const CATALOG_ITEM_LIMIT = 20;

interface StremioCatalogResponse {
  metas?: unknown;
}

function extractImdbIds(rawMetas: unknown): string[] {
  if (!Array.isArray(rawMetas)) {
    return [];
  }
  const imdbIds: string[] = [];
  for (const raw of rawMetas) {
    if (imdbIds.length >= CATALOG_ITEM_LIMIT) {
      break;
    }
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const id = (raw as Record<string, unknown>).id;
    if (typeof id === "string" && id.startsWith("tt")) {
      imdbIds.push(id);
    }
  }
  return imdbIds;
}

export async function fetchAddonCatalogResults(opts: {
  addonBaseUrl: string;
  catalogId: string;
  tmdbLocale: string;
  token: string;
  type: "movie" | "series";
}): Promise<MediaMeta[]> {
  const { addonBaseUrl, catalogId, tmdbLocale, token, type } = opts;

  const res = await safeFetch(
    `${addonBaseUrl}/catalog/${type}/${encodeURIComponent(catalogId)}.json`,
    { method: "GET", headers: { accept: "application/json" } }
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = (await res.json()) as StremioCatalogResponse;
  const [firstImdbId, ...restImdbIds] = extractImdbIds(data.metas);
  if (!firstImdbId) {
    return [];
  }

  async function resolveOne(imdbId: string): Promise<MediaMeta | null> {
    const tmdbId = await findTmdbIdByImdbId(token, imdbId, type);
    if (!tmdbId) {
      return null;
    }
    return type === "movie"
      ? fetchMovieMeta(token, tmdbId, tmdbLocale)
      : fetchTvMeta(token, tmdbId, tmdbLocale);
  }

  // El primero deja propagar auth/red tal cual (si el token TMDB murió, toda
  // la fila debe fallar para que resolveFeed detecte el TmdbAuthError); el
  // resto es best-effort, igual que las páginas extra de
  // fetchCatalogResultsAtLeast: un item que no resuelve simplemente no
  // aparece, en vez de tumbar toda la fila.
  const first = await resolveOne(firstImdbId);

  const rest = await Promise.allSettled(restImdbIds.map(resolveOne));
  const restResolved = rest.flatMap((r) =>
    r.status === "fulfilled" && r.value ? [r.value] : []
  );

  return first ? [first, ...restResolved] : restResolved;
}
