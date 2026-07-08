"use client";

import type { TFunction } from "i18next";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Hackwi18n } from "@/lib/hackw-i18n";
import { DEFAULT_LANGUAGE, type SupportedLanguage } from "@/lib/languages";
import { ALL_TRANSLATIONS } from "@/lib/translations";

interface HackwI18nContextValue {
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => Promise<void>;
  t: TFunction;
}

const HackwI18nContext = createContext<HackwI18nContextValue | null>(null);

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
 * Builds a synchronous t() from the bundled JSON dictionaries so that the
 * very first render already shows the correct locale without waiting for
 * the async i18next initialization (prevents the Spanish-flash on reload).
 */
function makeSyncT(locale: SupportedLanguage): TFunction {
  const dict =
    ALL_TRANSLATIONS[locale] ?? ALL_TRANSLATIONS[DEFAULT_LANGUAGE] ?? {};
  const fallback = ALL_TRANSLATIONS[DEFAULT_LANGUAGE] ?? {};
  return ((key: string, optsOrDefault?: unknown) => {
    let result: string = dict[key] ?? fallback[key] ?? key;
    if (
      optsOrDefault &&
      typeof optsOrDefault === "object" &&
      optsOrDefault !== null
    ) {
      const opts = optsOrDefault as Record<string, unknown>;
      for (const [k, v] of Object.entries(opts)) {
        result = result.replace(getInterpolationRegex(k), String(v));
      }
    }
    return result;
  }) as TFunction;
}

interface HackwProviderProps {
  children: ReactNode;
  i18nInstance?: Hackwi18n;
  initialLocale?: SupportedLanguage;
}

export function HackwProvider({
  children,
  i18nInstance,
  initialLocale = DEFAULT_LANGUAGE,
}: HackwProviderProps) {
  const instanceRef = useRef<Hackwi18n>(
    i18nInstance ?? new Hackwi18n({ language: initialLocale })
  );

  // Initialize t synchronously from the bundled JSON — no flicker on first render
  const [t, setT] = useState<TFunction>(() => makeSyncT(initialLocale));
  const [language, setLanguageState] =
    useState<SupportedLanguage>(initialLocale);

  // Inicialización y sincronización cuando initialLocale cambia (ej. router.refresh())
  useEffect(() => {
    let cancelled = false;
    instanceRef.current
      .setLanguage(initialLocale)
      .then(() => {
        if (cancelled) {
          return instanceRef.current.getTranslators();
        }
        return instanceRef.current.getTranslators();
      })
      .then((translators) => {
        if (cancelled) {
          return;
        }
        setT(() => translators.t);
        setLanguageState(initialLocale);
      });
    return () => {
      cancelled = true;
    };
  }, [initialLocale]);

  const setLanguage = useCallback(async (lang: SupportedLanguage) => {
    await instanceRef.current.setLanguage(lang);
    const { t: nextT } = await instanceRef.current.getTranslators();
    setT(() => nextT);
    setLanguageState(lang);
  }, []);

  const value = useMemo(
    () => ({ t, language, setLanguage }),
    [t, language, setLanguage]
  );

  return (
    <HackwI18nContext.Provider value={value}>
      {children}
    </HackwI18nContext.Provider>
  );
}

export function useHackwTranslation(): HackwI18nContextValue {
  const ctx = use(HackwI18nContext);
  if (!ctx) {
    throw new Error("useHackwTranslation must be used inside <HackwProvider>");
  }
  return ctx;
}
