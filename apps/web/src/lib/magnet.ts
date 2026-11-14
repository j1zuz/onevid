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

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Normaliza un info-hash a hex minúscula. El magnet acepta base32 además de
 * hex, pero los servicios debrid publican siempre hex: sin normalizar, un
 * magnet en base32 no se reconoce como "ya existe en la cuenta" y se vuelve a
 * crear (duplicado).
 */
export function normalizeInfoHash(raw: string): string | null {
  const value = raw.trim();
  if (/^[0-9a-f]{40}$/i.test(value)) {
    return value.toLowerCase();
  }
  // El base32 de un magnet se escribe en mayúsculas por convención, pero hay
  // enlaces en minúsculas: se normaliza antes de validar.
  const base32 = value.toUpperCase();
  if (!/^[A-Z2-7]{32}$/.test(base32)) {
    return null;
  }
  let bits = "";
  for (const char of base32) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) {
      return null;
    }
    bits += index.toString(2).padStart(5, "0");
  }
  let hex = "";
  for (let i = 0; i < 160; i += 8) {
    hex += Number.parseInt(bits.slice(i, i + 8), 2)
      .toString(16)
      .padStart(2, "0");
  }
  return hex;
}
