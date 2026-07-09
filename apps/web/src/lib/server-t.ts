import { cookies, headers } from "next/headers";
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_CODES,
  type SupportedLanguage,
} from "@/lib/languages";
import { ALL_TRANSLATIONS } from "@/lib/translations";

const interpolationRegexCache = new Map<string, RegExp>();
function getInterpolationRegex(key: string): RegExp {
  let regex = interpolationRegexCache.get(key);
  if (!regex) {
    regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
    interpolationRegexCache.set(key, regex);
  }
  return regex;
}

/**
 * Server-side translation helper for Server Components.
 * Returns a t() function and the active locale, both resolved from the NEXT_LOCALE cookie.
 */
export async function getServerT() {
  // El cliente móvil no envía cookies (no es un navegador): manda su idioma en
  // el header `x-app-language`. Le damos prioridad sobre la cookie NEXT_LOCALE
  // (que usa la web) para que el catálogo/carátulas de TMDB salgan en el idioma
  // elegido en la app. Si ninguno es válido, caemos al idioma por defecto.
  const headerStore = await headers();
  const headerLang = headerStore.get("x-app-language")?.trim();
  const store = await cookies();
  const saved = headerLang || store.get("NEXT_LOCALE")?.value;
  const locale: SupportedLanguage = SUPPORTED_CODES.includes(saved as never)
    ? (saved as SupportedLanguage)
    : DEFAULT_LANGUAGE;

  function t(key: string, opts?: Record<string, unknown>): string {
    let result =
      ALL_TRANSLATIONS[locale]?.[key] ??
      ALL_TRANSLATIONS[DEFAULT_LANGUAGE]?.[key] ??
      key;
    if (opts) {
      for (const [k, v] of Object.entries(opts)) {
        result = result.replace(getInterpolationRegex(k), String(v));
      }
    }
    return result;
  }

  return { t, locale };
}
