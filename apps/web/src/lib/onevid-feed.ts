/**
 * Feed de inicio configurable: cada fila es una combinación
 * tipo × catálogo × cadena (las mismas que antes producían los tres dropdowns
 * del header). El usuario elige qué filas quiere y en qué orden desde el paso 2
 * del stepper de configuración; el orden se guarda en `one_vid.feed_rows`.
 *
 * Este módulo es intencionalmente puro (sin `fetch`, sin `next/*`, sin `db`):
 * lo importan tanto Server Components y API routes como el paso 2 del stepper,
 * que es un componente cliente. Por eso las listas estáticas de catálogos y
 * cadenas viven aquí y `src/lib/tmdb.ts` las re-exporta (para no arrastrar todo
 * el módulo de TMDB al bundle del cliente).
 */

export type FeedCatalogId = "trending" | "year" | "imdbrating";
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

export const FEED_CATALOG_IDS: FeedCatalogId[] = [
  "trending",
  "year",
  "imdbrating",
];

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
    { id: "year", type: "movie", name: "Estrenos" },
    { id: "imdbrating", type: "movie", name: "Destacados" },
    { id: "trending", type: "series", name: "Tendencias" },
    { id: "year", type: "series", name: "Estrenos" },
    { id: "imdbrating", type: "series", name: "Destacados" },
  ];
}

export function getNetworkOptions(): NetworkOption[] {
  return [
    { id: 213, name: "Netflix", providerId: 8, companyIds: [178_464] },
    { id: 2739, name: "Disney+", providerId: 337, companyIds: [3475, 2] },
    { id: 49, name: "HBO", providerId: 1899, companyIds: [3268] },
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
    // Red de TV distinta de HBO (3186 = "HBO Max"/Max en TMDB); el id previo
    // (6171) apuntaba por error a "UTY", una cadena japonesa sin relación.
    // El `providerId` de streaming para películas sí es el mismo que HBO
    // (1899): TMDB no separa el catálogo de películas de Max del de HBO Max.
    { id: 3186, name: "Max", providerId: 1899, companyIds: [3268] },
  ];
}

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

/** Preset para quien nunca configuró nada (4 filas = 4 requests a TMDB). */
export const DEFAULT_FEED_ROWS: OneVidFeedRow[] = [
  { type: "movie", catalog: "trending" },
  { type: "series", catalog: "trending" },
  { type: "movie", catalog: "year" },
  { type: "series", catalog: "imdbrating" },
];

function isFeedCatalogId(value: unknown): value is FeedCatalogId {
  return FEED_CATALOG_IDS.includes(value as FeedCatalogId);
}

/**
 * Valida y normaliza filas que vienen del cliente (PUT) o de la DB (jsonb).
 * Es la ÚNICA validación del feed, así que una fila corrupta guardada a mano
 * nunca puede tumbar /home.
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
    const { type, catalog, networkId } = raw as Record<string, unknown>;
    if (type !== "movie" && type !== "series") {
      continue;
    }
    if (!isFeedCatalogId(catalog)) {
      continue;
    }
    const row: OneVidFeedRow = { type, catalog };
    // El endpoint /trending de TMDB no admite filtro de cadena, pero
    // fetchCatalogResults ya resuelve eso cayendo a discover (popularity.desc)
    // cuando hay cadena, así que aquí no hace falta descartarla.
    if (typeof networkId === "number" && validNetworkIds.has(networkId)) {
      row.networkId = networkId;
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

export function getFeedCatalogLabel(
  catalog: FeedCatalogId,
  t: Translate
): string {
  if (catalog === "trending") {
    return t("Tendencias");
  }
  if (catalog === "year") {
    return t("Estrenos");
  }
  return t("Destacados");
}

/** Título completo (catálogo · tipo · cadena) para la lista del paso 2. */
export function getFeedRowTitle(
  row: OneVidFeedRow,
  t: Translate,
  networkName?: string
): string {
  const parts = [
    getFeedCatalogLabel(row.catalog, t),
    row.type === "movie" ? t("Películas") : t("Series"),
  ];
  if (networkName) {
    parts.push(networkName);
  }
  return parts.join(" · ");
}

/**
 * Título corto (tipo · cadena) para /home: el nombre del catálogo se omite
 * porque ya se elige y se ve en el paso 2 de configuración; repetirlo en cada
 * fila del feed es ruido.
 */
export function getFeedRowShortTitle(
  row: OneVidFeedRow,
  t: Translate,
  networkName?: string
): string {
  const parts = [row.type === "movie" ? t("Películas") : t("Series")];
  if (networkName) {
    parts.push(networkName);
  }
  return parts.join(" · ");
}

/** URL de la vista "Ver todo" (la grilla completa de esa fila). */
export function buildFeedRowHref(row: OneVidFeedRow): string {
  const params = new URLSearchParams({ type: row.type, catalog: row.catalog });
  if (row.networkId) {
    params.set("network", String(row.networkId));
  }
  return `/home?${params.toString()}`;
}
