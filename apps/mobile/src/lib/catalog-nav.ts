import { router } from 'expo-router';

/**
 * Params de una fila del feed, extraídos del `href` que da el backend
 * (`buildFeedRowHref`): `/home?type=...&catalog=...&network=...` para las filas
 * de TMDB, o la variante `catalog=addon&addonId=...&addonCatalogId=...`. Son lo
 * que necesita la vista "Ver todo" (/catalog) para pedir el catálogo completo.
 */
export interface CatalogRowParams {
  type: 'movie' | 'series';
  catalog: string;
  network?: string;
  addonId?: string;
  addonCatalogId?: string;
}

/**
 * Parseo manual de la query (`?a=1&b=2`). No usamos `URLSearchParams`: el
 * polyfill de React Native es incompleto y su `.get()` no es de fiar entre
 * versiones de Hermes.
 */
function parseQuery(query: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of query.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq === -1 ? part : part.slice(0, eq);
    const value = eq === -1 ? '' : part.slice(eq + 1);
    if (key) out[decodeURIComponent(key)] = decodeURIComponent(value);
  }
  return out;
}

/** Extrae los params de la fila desde su `href`; null si no es navegable. */
export function parseFeedHref(href: string): CatalogRowParams | null {
  const q = href.split('?')[1];
  if (!q) return null;
  const p = parseQuery(q);
  const type = p.type;
  const catalog = p.catalog;
  if ((type !== 'movie' && type !== 'series') || !catalog) return null;
  return {
    type,
    catalog,
    network: p.network || undefined,
    addonId: p.addonId || undefined,
    addonCatalogId: p.addonCatalogId || undefined,
  };
}

/** Abre la grilla "Ver todo" de una fila con su título y sus params. */
export function navigateToCatalog(title: string, params: CatalogRowParams) {
  router.push({
    pathname: '/catalog',
    params: {
      title,
      type: params.type,
      catalog: params.catalog,
      ...(params.network ? { network: params.network } : {}),
      ...(params.addonId ? { addonId: params.addonId } : {}),
      ...(params.addonCatalogId
        ? { addonCatalogId: params.addonCatalogId }
        : {}),
    },
  });
}
