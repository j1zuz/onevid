/**
 * Feed de inicio configurable: cada fila es una combinación tipo × cadena. El
 * usuario elige qué filas quiere y en qué orden desde el paso 2 del stepper de
 * configuración; el orden se guarda en `one_vid.feed_rows`.
 *
 * Todas las filas son de tendencias. Antes se podía elegir entre Tendencias /
 * Estrenos / Destacados, pero las tres devolvían listas muy parecidas y el
 * tercer dropdown solo añadía ruido a la configuración: ahora una fila es
 * simplemente "lo que está en tendencia" de un tipo, opcionalmente acotado a
 * una cadena.
 *
 * Este módulo es intencionalmente puro (sin `fetch`, sin `next/*`, sin `db`):
 * lo importan tanto Server Components y API routes como el paso 2 del stepper,
 * que es un componente cliente. Por eso las listas estáticas de catálogos y
 * cadenas viven aquí y `src/lib/tmdb.ts` las re-exporta (para no arrastrar todo
 * el módulo de TMDB al bundle del cliente).
 */

/**
 * Se mantiene como campo persistido (y con forma de union) porque la app
 * mobile lee y escribe el mismo jsonb: quitarlo rompería su parseo.
 */
export type FeedCatalogId = "trending";
export type FeedMediaType = "movie" | "series";

export interface CatalogOption {
  id: string;
  name: string;
  type: FeedMediaType;
}

export interface NetworkOption {
  // Movie production company ids (TMDB `with_companies`). Used only as a
  // fallback when `with_watch_providers` returns nothing for the region.
  companyIds: number[];
  id: number;
  name: string;
  providerId: number;
}

/** Una fila del feed tal cual se persiste en el jsonb. */
export interface OneVidFeedRow {
  catalog: FeedCatalogId;
  networkId?: number;
  type: FeedMediaType;
}

/** Fila con id derivado, para keys de React y el `value` de Reorder.Item. */
export interface FeedRowWithId extends OneVidFeedRow {
  id: string;
}

/** Cada fila es (al menos) un request a TMDB, así que el feed tiene tope. */
export const FEED_MAX_ROWS = 10;

/**
 * Pósters visibles por fila en /home antes de "Ver todo": una sola fila, sin
 * wrap. Coincide con el máximo de columnas de la grilla horizontal
 * (`HORIZONTAL_POSTER_GRID_CLASS`, `xl:grid-cols-4`, ver poster-card.tsx), así
 * nunca se ve una segunda fila a medias en el ancho de pantalla más común.
 */
export const FEED_ROW_ITEM_LIMIT = 4;

export function getCatalogOptions(): CatalogOption[] {
  return [
    { id: "trending", type: "movie", name: "Tendencias" },
    { id: "trending", type: "series", name: "Tendencias" },
  ];
}

export function getNetworkOptions(): NetworkOption[] {
  return [
    { id: 213, name: "Netflix", providerId: 8, companyIds: [178_464] },
    { id: 2739, name: "Disney+", providerId: 337, companyIds: [3475, 2] },
    {
      id: 1024,
      name: "Amazon",
      providerId: 119,
      companyIds: [20_580, 210_099],
    },
    {
      id: 2552,
      name: "Apple TV+",
      providerId: 350,
      companyIds: [194_232, 152_726],
    },
    { id: 4330, name: "Paramount+", providerId: 531, companyIds: [4] },
    { id: 453, name: "Hulu", providerId: 15, companyIds: [] },
    // 3186 = "HBO Max"/Max en TMDB. Antes había también una entrada "HBO"
    // (network 49) que en la práctica era la misma cadena: compartía el
    // `providerId` de películas (1899, TMDB no separa los catálogos) y solo
    // se diferenciaba en las series de la marca previa al rebrand. Se dejó
    // una sola opción; ver NETWORK_ALIASES para las filas ya guardadas.
    { id: 3186, name: "Max", providerId: 1899, companyIds: [3268] },
  ];
}

/**
 * Cadenas retiradas → la que las reemplaza, para migrar filas ya guardadas en
 * vez de descartarlas.
 */
const NETWORK_ALIASES: Record<number, number> = {
  49: 3186, // HBO → Max
};

/**
 * El id NO se persiste: se deriva de la propia fila, que ya es única por
 * (tipo, catálogo, cadena). Así el jsonb queda mínimo y no puede
 * desincronizarse del contenido.
 */
export function buildFeedRowId(row: OneVidFeedRow): string {
  return `${row.type}:${row.catalog}:${row.networkId ?? "all"}`;
}

export function withFeedRowIds(rows: OneVidFeedRow[]): FeedRowWithId[] {
  return rows.map((row) => ({ ...row, id: buildFeedRowId(row) }));
}

/**
 * Las dos superficies configurables: el inicio y la pestaña "Descubrir". Cada
 * una guarda sus propias filas (`one_vid.feed_rows` / `one_vid.discover_rows`)
 * y las comparten la web y la app.
 */
export type FeedSurface = "discover" | "home";

/** Preset para quien nunca configuró nada (4 filas = 4 requests a TMDB). */
export const DEFAULT_FEED_ROWS: OneVidFeedRow[] = [
  { type: "movie", catalog: "trending" },
  { type: "series", catalog: "trending" },
  { type: "movie", catalog: "trending", networkId: 213 },
  { type: "series", catalog: "trending", networkId: 213 },
];

/**
 * Preset de Descubrir: una fila por cadena, que es lo que esa pestaña mostraba
 * antes con el selector de cadenas. Así nadie se encuentra la pantalla vacía
 * al actualizar sin haber configurado nada.
 */
export const DEFAULT_DISCOVER_ROWS: OneVidFeedRow[] = [
  { type: "movie", catalog: "trending", networkId: 213 }, // Netflix
  { type: "series", catalog: "trending", networkId: 213 },
  { type: "movie", catalog: "trending", networkId: 1024 }, // Prime Video
  { type: "series", catalog: "trending", networkId: 2739 }, // Disney+
  { type: "series", catalog: "trending", networkId: 3186 }, // Max
];

export function getDefaultRows(surface: FeedSurface): OneVidFeedRow[] {
  return surface === "discover" ? DEFAULT_DISCOVER_ROWS : DEFAULT_FEED_ROWS;
}

/**
 * Valida y normaliza filas que vienen del cliente (PUT) o de la DB (jsonb).
 * Es la ÚNICA validación del feed, así que una fila corrupta guardada a mano
 * nunca puede tumbar /home.
 *
 * También hace de migración: las filas guardadas con los catálogos que ya no
 * existen (`year`, `imdbrating`) y con cadenas retiradas (HBO) se reescriben
 * en vez de descartarse, así nadie pierde su inicio al desplegar. Como la
 * migración puede colapsar dos filas en una (p. ej. `movie:year` y
 * `movie:trending`), el dedupe por id se queda con la primera.
 *
 * Devuelve `null` cuando el valor no es un array (columna NULL o basura), que
 * es como distinguimos "nunca configurado" de "configurado".
 */
export function parseFeedRows(value: unknown): OneVidFeedRow[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const validNetworkIds = new Set(getNetworkOptions().map((n) => n.id));
  const seen = new Set<string>();
  const rows: OneVidFeedRow[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const { type, networkId } = raw as Record<string, unknown>;
    if (type !== "movie" && type !== "series") {
      continue;
    }
    // `catalog` ya no discrimina nada (todas las filas son de tendencias),
    // pero se sigue escribiendo para que la app mobile lea un jsonb con la
    // forma que espera.
    const row: OneVidFeedRow = { type, catalog: "trending" };
    // El endpoint /trending de TMDB no admite filtro de cadena, pero
    // fetchCatalogResults ya resuelve eso cayendo a discover (popularity.desc)
    // cuando hay cadena, así que aquí no hace falta descartarla.
    if (typeof networkId === "number") {
      const resolved = NETWORK_ALIASES[networkId] ?? networkId;
      if (validNetworkIds.has(resolved)) {
        row.networkId = resolved;
      }
    }
    const id = buildFeedRowId(row);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    rows.push(row);
    if (rows.length >= FEED_MAX_ROWS) {
      break;
    }
  }

  return rows;
}

type Translate = (key: string) => string;

/**
 * Título de una fila, tanto en /home como en la lista del paso 2:
 * "Tendencias · Películas" cuando la fila no está acotada, y
 * "Películas · Netflix" cuando sí. El prefijo "Tendencias" solo aparece en las
 * filas generales, donde hace falta para que no queden como un "Películas" a
 * secas; en las de cadena el nombre de la cadena ya da el contexto y
 * encadenar tres partes solo alarga el título.
 */
export function getFeedRowTitle(
  row: OneVidFeedRow,
  t: Translate,
  networkName?: string
): string {
  const typeLabel = row.type === "movie" ? t("Películas") : t("Series");
  if (networkName) {
    return `${typeLabel} · ${networkName}`;
  }
  return `${t("Tendencias")} · ${typeLabel}`;
}

/** URL de la vista "Ver todo" (la grilla completa de esa fila). */
export function buildFeedRowHref(row: OneVidFeedRow): string {
  const params = new URLSearchParams({ type: row.type, catalog: row.catalog });
  if (row.networkId) {
    params.set("network", String(row.networkId));
  }
  return `/home?${params.toString()}`;
}
