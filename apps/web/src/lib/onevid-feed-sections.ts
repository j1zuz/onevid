/**
 * Resolución del feed de inicio: filas configuradas → filas con sus items de
 * TMDB, más el carrusel destacado.
 *
 * Vive aparte de `onevid-feed.ts` (que es puro y lo importa también el cliente)
 * porque esto sí toca TMDB. Lo comparten el Server Component de `/home` y
 * `/api/onevid-feed/sections`, que es por donde la app mobile pinta el mismo
 * inicio que el usuario configuró en la web: si la orquestación viviera dentro
 * de la página, las dos plataformas se desincronizarían en cuanto una cambiara.
 */

import { fetchAddonCatalogResults } from "@/lib/addon-catalog";
import {
  type AddonCatalogRef,
  buildFeedRowHref,
  buildFeedRowId,
  getFeedRowTitle,
  type NetworkOption,
  type OneVidFeedRow,
} from "@/lib/onevid-feed";
import { type MediaMeta, TmdbAuthError } from "@/lib/tmdb";
import { fetchCatalogResults } from "@/lib/tmdb-catalog";

/** Un addon tal cual lo necesita `resolveFeed` para las filas "addon". */
export interface FeedAddonRef {
  baseUrl: string;
  catalogs: AddonCatalogRef[];
  manifestName: string;
}

/** Items del carrusel destacado (trending película/serie intercalados). */
export const HERO_TAKE = 8;

export interface FeedSection {
  /** Vista "Ver todo": /home?type=…&catalog=…&network=… */
  href: string;
  id: string;
  items: MediaMeta[];
  title: string;
}

export interface ResolvedFeed {
  /**
   * `auth` = el token TMDB murió y hay que reconfigurar (no es un feed a
   * medias); `network` = todas las filas fallaron. Sin filas caídas es null y
   * un feed vacío simplemente significa que TMDB no devolvió nada.
   */
  error: "auth" | "network" | null;
  hero: MediaMeta[];
  sections: FeedSection[];
}

interface ResolveFeedOptions {
  /** Addons del usuario, por id — solo hace falta para las filas "addon". */
  addonsById: Map<string, FeedAddonRef>;
  /**
   * Pósters por fila. /home recorta a 4 (una sola fila de la grilla) y la app
   * usa la página completa de TMDB porque sus filas hacen scroll horizontal.
   */
  itemsPerRow?: number;
  networksById: Map<number, NetworkOption>;
  rows: OneVidFeedRow[];
  t: (key: string) => string;
  tmdbLocale: string;
  tmdbRegion: string;
  token: string;
}

/** Resuelve UNA fila, sea de TMDB o del catálogo propio de un addon. */
function resolveRow(
  row: OneVidFeedRow,
  addonsById: Map<string, FeedAddonRef>,
  networksById: Map<number, NetworkOption>,
  tmdbLocale: string,
  tmdbRegion: string,
  token: string
): Promise<MediaMeta[]> {
  if (row.catalog === "addon") {
    const addon = row.addonId ? addonsById.get(row.addonId) : undefined;
    if (!addon) {
      // Addon quitado/desconocido: la fila desaparece del feed, igual que
      // cualquier otra fila sin resultados (ver el filtro más abajo).
      return Promise.resolve([]);
    }
    return fetchAddonCatalogResults({
      addonBaseUrl: addon.baseUrl,
      catalogId: row.addonCatalogId ?? "",
      tmdbLocale,
      token,
      type: row.type,
    });
  }
  return fetchCatalogResults({
    catalog: row.catalog,
    network: row.networkId ? networksById.get(row.networkId) : undefined,
    tmdbLocale,
    tmdbRegion,
    token,
    type: row.type,
  });
}

/** Nombre a mostrar junto al tipo en el título de la fila (ver `getFeedRowTitle`). */
function resolveRowSourceName(
  row: OneVidFeedRow,
  addonsById: Map<string, FeedAddonRef>,
  networksById: Map<number, NetworkOption>
): string | undefined {
  if (row.catalog === "addon") {
    const addon = row.addonId ? addonsById.get(row.addonId) : undefined;
    const catalogName = addon?.catalogs.find(
      (c) => c.id === row.addonCatalogId
    )?.name;
    return catalogName ?? addon?.manifestName;
  }
  return row.networkId ? networksById.get(row.networkId)?.name : undefined;
}

export function interleaveMediaMeta(
  a: MediaMeta[],
  b: MediaMeta[]
): MediaMeta[] {
  const out: MediaMeta[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const fromA = a[i];
    const fromB = b[i];
    if (fromA) {
      out.push(fromA);
    }
    if (fromB) {
      out.push(fromB);
    }
  }
  return out;
}

export interface HeroResult {
  /** true cuando el token TMDB murió al pedir el hero: hay que reconfigurar. */
  authFailed: boolean;
  hero: MediaMeta[];
}

export interface FeedSectionsResult {
  /** true cuando TODAS las filas fallaron por red (no auth): el feed va vacío. */
  allRowsFailed: boolean;
  /** true cuando el token TMDB murió: el feed va vacío y hay que reconfigurar. */
  authFailed: boolean;
  sections: FeedSection[];
}

/** true si alguna promesa fue rechazada por un token TMDB inválido. */
function hasAuthRejection(results: PromiseSettledResult<unknown>[]): boolean {
  return results.some(
    (result) =>
      result.status === "rejected" && result.reason instanceof TmdbAuthError
  );
}

/**
 * Carrusel destacado (trending película/serie intercalados). Es lo primero que
 * pinta /home (el elemento LCP), así que se resuelve aparte de las filas para
 * poder esperarlo solo a él y no bloquear el pintado con las N filas. Un token
 * muerto se reporta como dato (`authFailed`); un fallo de red solo deja el hero
 * vacío.
 */
export async function resolveHero({
  tmdbLocale,
  tmdbRegion,
  token,
}: {
  tmdbLocale: string;
  tmdbRegion: string;
  token: string;
}): Promise<HeroResult> {
  const settled = await Promise.allSettled([
    fetchCatalogResults({
      catalog: "trending",
      tmdbLocale,
      tmdbRegion,
      token,
      type: "movie",
    }),
    fetchCatalogResults({
      catalog: "trending",
      tmdbLocale,
      tmdbRegion,
      token,
      type: "series",
    }),
  ]);

  const [movies, series] = settled;
  const heroMovies = movies.status === "fulfilled" ? movies.value : [];
  const heroSeries = series.status === "fulfilled" ? series.value : [];
  return {
    authFailed: hasAuthRejection(settled),
    hero: interleaveMediaMeta(heroMovies, heroSeries).slice(0, HERO_TAKE),
  };
}

/**
 * Filas configuradas → filas con sus items de TMDB. Se resuelve aparte del hero
 * para poder transmitirse (stream) por debajo del carrusel sin bloquear el
 * primer pintado de /home. Un token muerto se reporta como dato (`authFailed`);
 * una fila caída por red desaparece.
 */
export async function resolveFeedSections({
  addonsById,
  itemsPerRow,
  networksById,
  rows,
  t,
  tmdbLocale,
  tmdbRegion,
  token,
}: ResolveFeedOptions): Promise<FeedSectionsResult> {
  const settled = await Promise.allSettled(
    rows.map((row) =>
      resolveRow(row, addonsById, networksById, tmdbLocale, tmdbRegion, token)
    )
  );

  // El token muerto se detecta ANTES de descartar filas: si falla la auth hay
  // que volver a mostrar el stepper, no un feed a medias.
  if (hasAuthRejection(settled)) {
    return { allRowsFailed: false, authFailed: true, sections: [] };
  }

  const sections = settled.flatMap((result, index) => {
    const row = rows[index];
    if (!row) {
      return [];
    }
    if (result.status === "rejected") {
      // Una fila caída (red/timeout) desaparece sin tumbar la página.
      console.warn(
        `[onevid] fila del feed fallida ${buildFeedRowId(row)}:`,
        result.reason
      );
      return [];
    }
    if (result.value.length === 0) {
      return [];
    }
    return [
      {
        href: buildFeedRowHref(row),
        id: buildFeedRowId(row),
        items: itemsPerRow ? result.value.slice(0, itemsPerRow) : result.value,
        title: getFeedRowTitle(
          row,
          t,
          resolveRowSourceName(row, addonsById, networksById)
        ),
      },
    ];
  });

  // Solo es error de red si TODAS las filas fallaron; si simplemente no
  // devolvieron resultados, el cliente muestra el estado vacío.
  const rejected = settled.filter(
    (result) => result.status === "rejected"
  ).length;
  const allRowsFailed = settled.length > 0 && rejected === settled.length;

  return { allRowsFailed, authFailed: false, sections };
}

/**
 * Feed completo (hero + filas) en una sola espera. Lo usa `/api/onevid-feed/
 * sections`, que sirve el mismo inicio a la app mobile en una respuesta. La web
 * (`/home`) NO lo usa: transmite las filas con `resolveHero` + `resolveFeedSections`
 * por separado para no bloquear el LCP.
 */
export async function resolveFeed(
  options: ResolveFeedOptions
): Promise<ResolvedFeed> {
  const [sectionsResult, heroResult] = await Promise.all([
    resolveFeedSections(options),
    resolveHero(options),
  ]);

  const { hero } = heroResult;

  // La auth la deciden las filas: el hero puede venir vacío por red sin que eso
  // signifique que el token murió.
  if (sectionsResult.authFailed) {
    return { error: "auth", hero, sections: [] };
  }

  return {
    error: sectionsResult.allRowsFailed ? "network" : null,
    hero,
    sections: sectionsResult.sections,
  };
}
