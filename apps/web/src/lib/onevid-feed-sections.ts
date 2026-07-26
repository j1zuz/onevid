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

import {
  buildFeedRowHref,
  buildFeedRowId,
  getFeedRowTitle,
  type NetworkOption,
  type OneVidFeedRow,
} from "@/lib/onevid-feed";
import { type MediaMeta, TmdbAuthError } from "@/lib/tmdb";
import { fetchCatalogResults } from "@/lib/tmdb-catalog";

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

export async function resolveFeed({
  itemsPerRow,
  networksById,
  rows,
  t,
  tmdbLocale,
  tmdbRegion,
  token,
}: ResolveFeedOptions): Promise<ResolvedFeed> {
  const [settled, heroMovies, heroSeries] = await Promise.all([
    Promise.allSettled(
      rows.map((row) =>
        fetchCatalogResults({
          catalog: row.catalog,
          network: row.networkId ? networksById.get(row.networkId) : undefined,
          tmdbLocale,
          tmdbRegion,
          token,
          type: row.type,
        })
      )
    ),
    // El hero es independiente de las filas configuradas (que pueden estar
    // todas acotadas a una cadena); si falla, simplemente no se muestra. El
    // fallo real de auth lo detectan las filas del feed más abajo.
    fetchCatalogResults({
      catalog: "trending",
      tmdbLocale,
      tmdbRegion,
      token,
      type: "movie",
    }).catch((error) => {
      console.warn("[onevid] hero (trending movie) falló:", error);
      return [];
    }),
    fetchCatalogResults({
      catalog: "trending",
      tmdbLocale,
      tmdbRegion,
      token,
      type: "series",
    }).catch((error) => {
      console.warn("[onevid] hero (trending series) falló:", error);
      return [];
    }),
  ]);

  const hero = interleaveMediaMeta(heroMovies, heroSeries).slice(0, HERO_TAKE);

  // El token muerto se detecta ANTES de descartar filas: si falla la auth hay
  // que volver a mostrar el stepper, no un feed a medias.
  if (
    settled.some(
      (result) =>
        result.status === "rejected" && result.reason instanceof TmdbAuthError
    )
  ) {
    return { error: "auth", hero, sections: [] };
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
          row.networkId ? networksById.get(row.networkId)?.name : undefined
        ),
      },
    ];
  });

  // Solo es error de red si TODAS las filas fallaron; si simplemente no
  // devolvieron resultados, el cliente muestra el estado vacío.
  const rejected = settled.filter(
    (result) => result.status === "rejected"
  ).length;
  const error =
    settled.length > 0 && rejected === settled.length ? "network" : null;

  return { error, hero, sections };
}
