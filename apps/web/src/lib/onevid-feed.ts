/**
 * Feed de inicio configurable: cada fila es una combinación tipo × cadena (o
 * tipo × catálogo de un addon). El usuario elige qué filas quiere y en qué
 * orden desde el paso 2 del stepper de configuración; el orden se guarda en
 * `one_vid.feed_rows`.
 *
 * Las filas "trending" son de TMDB. Antes se podía elegir entre Tendencias /
 * Estrenos / Destacados, pero las tres devolvían listas muy parecidas y el
 * tercer dropdown solo añadía ruido a la configuración: ahora una fila
 * "trending" es simplemente "lo que está en tendencia" de un tipo,
 * opcionalmente acotado a una cadena. Las filas "addon" en cambio muestran el
 * catálogo propio de un addon OneVLP (formato Stremio: `manifest.catalogs` +
 * `/catalog/:type/:id.json`), resuelto vía IMDb → TMDB.
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
export type FeedCatalogId = "addon" | "trending";
export type FeedMediaType = "movie" | "series";

export interface CatalogOption {
  id: string;
  name: string;
  type: FeedMediaType;
}

/** Un catálogo propio de un addon (manifest.catalogs, formato Stremio). */
export interface AddonCatalogRef {
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
  /** Solo cuando `catalog === "addon"`: id del addon en `one_vid_addon`. */
  addonId?: string;
  /** Solo cuando `catalog === "addon"`: id del catálogo dentro de ese addon. */
  addonCatalogId?: string;
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
 * (tipo, catálogo, cadena) o (tipo, addon, catálogo del addon). Así el jsonb
 * queda mínimo y no puede desincronizarse del contenido.
 */
export function buildFeedRowId(row: OneVidFeedRow): string {
  if (row.catalog === "addon") {
    return `${row.type}:addon:${row.addonId}:${row.addonCatalogId}`;
  }
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
 *
 * Una fila "addon" solo se valida estructuralmente aquí (que traiga
 * `addonId`/`addonCatalogId` como strings): este módulo es puro y no puede
 * consultar la DB para saber si ese addon/catálogo sigue existiendo. Si ya no
 * existe, `resolveFeed` simplemente no devuelve items para esa fila y
 * desaparece del feed, igual que cualquier otra fila caída.
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
    const { type, networkId, catalog, addonId, addonCatalogId } =
      raw as Record<string, unknown>;
    if (type !== "movie" && type !== "series") {
      continue;
    }

    let row: OneVidFeedRow;
    if (
      catalog === "addon" &&
      typeof addonId === "string" &&
      addonId.trim() &&
      typeof addonCatalogId === "string" &&
      addonCatalogId.trim()
    ) {
      row = {
        type,
        catalog: "addon",
        addonId: addonId.trim(),
        addonCatalogId: addonCatalogId.trim(),
      };
    } else {
      // `catalog` ya no discrimina nada más dentro de las filas de TMDB
      // (todas son de tendencias), pero se sigue escribiendo para que la app
      // mobile lea un jsonb con la forma que espera.
      row = { type, catalog: "trending" };
      // El endpoint /trending de TMDB no admite filtro de cadena, pero
      // fetchCatalogResults ya resuelve eso cayendo a discover
      // (popularity.desc) cuando hay cadena, así que aquí no hace falta
      // descartarla.
      if (typeof networkId === "number") {
        const resolved = NETWORK_ALIASES[networkId] ?? networkId;
        if (validNetworkIds.has(resolved)) {
          row.networkId = resolved;
        }
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
 * "Tendencias · Películas" cuando la fila no está acotada, "Películas ·
 * Netflix" cuando sí tiene cadena, y "<nombre del catálogo> · Películas"
 * cuando la fila viene de un addon. `sourceName` es el nombre de la cadena o
 * del catálogo del addon, según corresponda; sin él las filas de cadena caen
 * al "Tendencias" genérico y las de addon a un rótulo neutro (p. ej. si el
 * addon ya no existe).
 */
export function getFeedRowTitle(
  row: OneVidFeedRow,
  t: Translate,
  sourceName?: string
): string {
  const typeLabel = row.type === "movie" ? t("Películas") : t("Series");
  if (row.catalog === "addon") {
    return sourceName
      ? `${sourceName} · ${typeLabel}`
      : `${t("Catálogo del addon")} · ${typeLabel}`;
  }
  if (sourceName) {
    return `${typeLabel} · ${sourceName}`;
  }
  return `${t("Tendencias")} · ${typeLabel}`;
}

/**
 * URL de la vista "Ver todo" (la grilla completa de esa fila). El catálogo de
 * un addon llega en una sola respuesta (sin paginación estandarizada como la
 * de TMDB), pero esa respuesta trae más items de los que la fila del feed
 * muestra (acotada a FEED_ROW_ITEM_LIMIT): "Ver todo" reutiliza esa misma
 * respuesta con un tope más alto (ver CATALOG_VIEW_ALL_ITEM_LIMIT en
 * addon-catalog.ts) en vez de descartar el resto.
 */
export function buildFeedRowHref(row: OneVidFeedRow): string {
  if (row.catalog === "addon") {
    if (!(row.addonId && row.addonCatalogId)) {
      return "";
    }
    const params = new URLSearchParams({
      type: row.type,
      catalog: "addon",
      addonId: row.addonId,
      addonCatalogId: row.addonCatalogId,
    });
    return `/home?${params.toString()}`;
  }
  const params = new URLSearchParams({ type: row.type, catalog: row.catalog });
  if (row.networkId) {
    params.set("network", String(row.networkId));
  }
  return `/home?${params.toString()}`;
}
