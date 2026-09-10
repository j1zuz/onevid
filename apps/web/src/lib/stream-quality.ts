import type { QualityTier, StreamSource } from "@/types/stream";

export type { QualityTier };

export interface QualityPref {
  enabled: boolean;
  tier: QualityTier;
}

/**
 * Orden por defecto cuando el usuario nunca configuró el suyo: 1080p primero y
 * 4K al final. No es el orden "de mayor a menor" que uno esperaría, y es a
 * propósito — la fuente que abre el reproductor es `sources[0]`, y en la
 * telemetría del proyecto los archivos 4K son los que más tardan en dar el
 * primer fotograma y los que más cortes provocan a mitad. 1080p arranca antes y
 * se sostiene mejor; quien quiera 4K lo sube desde Configuración.
 */
export const DEFAULT_QUALITY_ORDER: QualityPref[] = [
  { tier: "1080", enabled: true },
  { tier: "720", enabled: true },
  { tier: "1440", enabled: true },
  { tier: "2160", enabled: true },
  { tier: "480", enabled: true },
  { tier: "unknown", enabled: true },
];

export const QUALITY_TIERS: QualityTier[] = [
  "2160",
  "1440",
  "1080",
  "720",
  "480",
  "unknown",
];

/** Etiqueta corta para la interfaz (chip del selector de medios y ajustes). */
export const QUALITY_LABELS: Record<QualityTier, string> = {
  "2160": "4K",
  "1440": "1440p",
  "1080": "1080p",
  "720": "720p",
  "480": "SD",
  unknown: "Otras",
};

// De mayor a menor: gana el token más específico que aparezca en el texto. El
// orden importa porque un mismo título suele traer varias pistas ("4K HDR
// 2160p") y queremos quedarnos con la más alta.
const TIER_PATTERNS: Array<[QualityTier, RegExp]> = [
  ["2160", /\b(?:2160p?|4k|uhd)\b/i],
  ["1440", /\b(?:1440p?|2k|qhd)\b/i],
  ["1080", /\b(?:1080[pi]?|fhd|full\s?hd)\b/i],
  ["720", /\b720p?\b/i],
  ["480", /\b(?:480p?|360p?|240p?|sd)\b/i],
];

// "HD" a secas es el caso ambiguo: muchos addons lo usan como sinónimo de 1080p
// y otros de 720p. Solo se consulta cuando ningún patrón explícito coincidió, y
// cae a 720 por ser la lectura conservadora (si nos equivocamos, la fuente
// queda un escalón más arriba de lo que debería, no más abajo).
const BARE_HD_PATTERN = /\bhd\b/i;

function sourceText(source: StreamSource): string {
  const behaviors = Array.isArray(source.behaviors) ? source.behaviors : [];
  return [source.title, source.name, source.description, ...behaviors]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
}

export function parseQualityTier(source: StreamSource): QualityTier {
  const text = sourceText(source);
  for (const [tier, pattern] of TIER_PATTERNS) {
    if (pattern.test(text)) {
      return tier;
    }
  }
  return BARE_HD_PATTERN.test(text) ? "720" : "unknown";
}

/** Completa una preferencia guardada con los tiers que le falten, al final. */
export function normalizeQualityPref(
  raw: QualityPref[] | null | undefined
): QualityPref[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_QUALITY_ORDER;
  }
  const seen = new Set<QualityTier>();
  const pref: QualityPref[] = [];
  for (const entry of raw) {
    if (
      entry &&
      QUALITY_TIERS.includes(entry.tier) &&
      !seen.has(entry.tier)
    ) {
      seen.add(entry.tier);
      pref.push({ tier: entry.tier, enabled: entry.enabled !== false });
    }
  }
  for (const tier of QUALITY_TIERS) {
    if (!seen.has(tier)) {
      pref.push({ tier, enabled: true });
    }
  }
  return pref;
}

/**
 * Reordena las fuentes según la preferencia del usuario. El orden es ESTABLE:
 * dentro de un mismo escalón se respeta el orden en que llegaron del addon, que
 * es la única señal de "cuál recomienda el proveedor" que tenemos.
 *
 * Los escalones apagados se filtran, PERO si el filtro dejara la lista vacía se
 * devuelve la lista completa: quedarse sin fuentes rompe la reproducción, y eso
 * es peor que ofrecer una calidad que el usuario prefería no ver.
 */
export function sortSourcesByQuality<T extends { quality?: QualityTier }>(
  sources: T[],
  pref: QualityPref[]
): T[] {
  const rank = new Map<QualityTier, number>(
    pref.map((entry, index) => [entry.tier, index])
  );
  const disabled = new Set<QualityTier>(
    pref.filter((entry) => !entry.enabled).map((entry) => entry.tier)
  );

  const kept = sources.filter(
    (source) => !disabled.has(source.quality ?? "unknown")
  );
  const ordered = kept.length > 0 ? kept : sources;

  return ordered
    .map((source, index) => ({ source, index }))
    .sort((a, b) => {
      const rankA = rank.get(a.source.quality ?? "unknown") ?? rank.size;
      const rankB = rank.get(b.source.quality ?? "unknown") ?? rank.size;
      return rankA === rankB ? a.index - b.index : rankA - rankB;
    })
    .map((entry) => entry.source);
}
