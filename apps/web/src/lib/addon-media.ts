import "server-only";

/**
 * IDs de catálogos de addons con ids que no son TMDB/IMDb. Se codifican
 * como `addon~<uuid del addon>~<rawId en base64url>` para que:
 * - el addon dueño viaje en el propio id (sin consultar todos los addons),
 * - el id sea seguro en una URL y no contenga `:` (así `:temporada:episodio`
 *   sigue funcionando igual que con los ids de IMDb/TMDB).
 */
const PREFIX = "addon";
const SEPARATOR = "~";
// Un id de addon es un UUID y el rawId lo emite el catalogo; ambos acotados
// evitan URLs salientes gigantes y caracteres de control inyectados.
const MAX_ADDON_ID_LENGTH = 64;
const MAX_RAW_ID_LENGTH = 512;

export function encodeAddonMediaId(addonId: string, rawId: string): string {
  return `${PREFIX}${SEPARATOR}${addonId}${SEPARATOR}${Buffer.from(rawId, "utf8").toString("base64url")}`;
}

export function parseAddonMediaId(
  value: string
): { addonId: string; rawId: string } | null {
  const [prefix, addonId, encoded, ...rest] = value.split(SEPARATOR);
  if (
    prefix !== PREFIX ||
    !addonId ||
    addonId.length > MAX_ADDON_ID_LENGTH ||
    !encoded ||
    rest.length > 0
  ) {
    return null;
  }
  try {
    const rawId = Buffer.from(encoded, "base64url").toString("utf8");
    if (
      !rawId ||
      rawId.length > MAX_RAW_ID_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(rawId)
    ) {
      return null;
    }
    return { addonId, rawId };
  } catch {
    return null;
  }
}

export function isAddonMediaId(value: string): boolean {
  return parseAddonMediaId(value) !== null;
}

/** Id del player para un addon, con temporada/episodio opcionales. */
export function parseAddonStreamId(value: string): {
  addonId: string;
  episode?: number;
  rawId: string;
  season?: number;
} | null {
  const [base, seasonRaw, episodeRaw, ...rest] = value.split(":");
  if (rest.length > 0) {
    return null;
  }
  const ref = parseAddonMediaId(base);
  if (!ref) {
    return null;
  }
  if (seasonRaw === undefined || episodeRaw === undefined) {
    return ref;
  }
  const season = Number(seasonRaw);
  const episode = Number(episodeRaw);
  return Number.isInteger(season) && Number.isInteger(episode)
    ? { ...ref, season, episode }
    : ref;
}
