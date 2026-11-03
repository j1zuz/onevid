/**
 * Utilidades para enlaces magnet pegados en el buscador.
 *
 * Un magnet solo es reproducible si trae un info-hash BitTorrent
 * (`xt=urn:btih:…`); el resto de parámetros (`dn`, `tr`, etc.) son opcionales.
 * No usamos `new URL()` porque el esquema `magnet:` no garantiza que el `dn`
 * venga percent-encoded y `URL` lo normalizaría de formas que no nos interesan.
 */

const MAGNET_PREFIX = "magnet:?";
const BTIH_RE = /^urn:btih:[a-z0-9]+$/i;

function magnetParams(value: string): URLSearchParams | null {
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith(MAGNET_PREFIX)) {
    return null;
  }
  return new URLSearchParams(trimmed.slice(MAGNET_PREFIX.length));
}

/** Valores de un parámetro sin depender de mayúsculas en el nombre. */
function paramValues(params: URLSearchParams, name: string): string[] {
  const values: string[] = [];
  for (const [key, value] of params) {
    if (key.toLowerCase() === name) {
      values.push(value);
    }
  }
  return values;
}

/** ¿El texto pegado es un magnet con un info-hash BitTorrent válido? */
export function isMagnetLink(value: string): boolean {
  const params = magnetParams(value);
  if (!params) {
    return false;
  }
  return paramValues(params, "xt").some((xt) => BTIH_RE.test(xt.trim()));
}

/** Info-hash BitTorrent del magnet, o `null` si no es válido. */
export function magnetInfoHash(value: string): string | null {
  const params = magnetParams(value);
  if (!params) {
    return null;
  }
  const xt = paramValues(params, "xt").find((item) => BTIH_RE.test(item.trim()));
  return xt ? xt.trim().slice("urn:btih:".length) : null;
}

/** Nombre legible para el dropdown y la barra del reproductor. */
export function magnetDisplayName(value: string): string {
  const params = magnetParams(value);
  if (!params) {
    return "Magnet link";
  }

  const name = paramValues(params, "dn")
    .map((item) => item.trim())
    .find(Boolean);
  // Sin `dn` no hay un nombre legible: mostramos "Magnet link" en vez del
  // hash, que no le dice nada al usuario.
  return name || "Magnet link";
}

/** Ruta del reproductor que resuelve el magnet. */
export function buildMagnetPlayerHref(value: string): string {
  return `/home/player/magnet?magnet=${encodeURIComponent(value.trim())}`;
}
