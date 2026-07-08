import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { DEFAULT_LANGUAGE } from "./languages";
import deDE from "./locales/de-DE.json";
import enUS from "./locales/en-US.json";
import esLatam from "./locales/es-419.json";
import esES from "./locales/es-ES.json";
import frFR from "./locales/fr-FR.json";
import hiIN from "./locales/hi-IN.json";
import idID from "./locales/id-ID.json";
import itIT from "./locales/it-IT.json";
import jaJP from "./locales/ja-JP.json";
import koKR from "./locales/ko-KR.json";
import nlNL from "./locales/nl-NL.json";
import ptBR from "./locales/pt-BR.json";
import ruRU from "./locales/ru-RU.json";
import trTR from "./locales/tr-TR.json";

i18next.use(initReactI18next).init({
  resources: {
    "es-419": { translation: esLatam },
    "es-ES": { translation: esES },
    "en-US": { translation: enUS },
    "fr-FR": { translation: frFR },
    "de-DE": { translation: deDE },
    "hi-IN": { translation: hiIN },
    "id-ID": { translation: idID },
    "it-IT": { translation: itIT },
    "ja-JP": { translation: jaJP },
    "ko-KR": { translation: koKR },
    "pt-BR": { translation: ptBR },
    "nl-NL": { translation: nlNL },
    "ru-RU": { translation: ruRU },
    "tr-TR": { translation: trTR },
  },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});

export default i18next;
