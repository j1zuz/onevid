import { getLocales } from "expo-localization";
import { useCallback, useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import { DEFAULT_LANGUAGE, SUPPORTED_CODES, type SupportedLanguage } from "./languages";

function resolveDeviceLanguage(): SupportedLanguage {
  const locales = getLocales();
  for (const locale of locales) {
    const tag = locale.languageTag as SupportedLanguage;
    if (SUPPORTED_CODES.includes(tag)) {
      return tag;
    }
    const byCode = SUPPORTED_CODES.find((code) =>
      code.startsWith(`${locale.languageCode}-`)
    );
    if (byCode) {
      return byCode;
    }
  }
  return DEFAULT_LANGUAGE;
}

/**
 * Resuelve el idioma del dispositivo a uno de los soportados. En Android el
 * locale puede cambiar sin reiniciar la app, así que se re-lee al volver a
 * foreground; en iOS el locale es estable durante la sesión (según la guía
 * oficial de expo-localization) y no hace falta el listener de AppState.
 */
export function useDeviceLocale(): SupportedLanguage {
  const [locale, setLocale] = useState<SupportedLanguage>(resolveDeviceLanguage);

  const refresh = useCallback(() => setLocale(resolveDeviceLanguage()), []);

  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refresh();
      }
    });
    return () => subscription.remove();
  }, [refresh]);

  return locale;
}
