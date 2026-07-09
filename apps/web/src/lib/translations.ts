import type { SupportedLanguage } from "@/lib/languages";
import deDE from "../../locales/de-DE/translation.json";
import enUS from "../../locales/en-US/translation.json";
import esLatam from "../../locales/es-419/translation.json";
import esES from "../../locales/es-ES/translation.json";
import frFR from "../../locales/fr-FR/translation.json";
import hiIN from "../../locales/hi-IN/translation.json";
import idID from "../../locales/id-ID/translation.json";
import itIT from "../../locales/it-IT/translation.json";
import jaJP from "../../locales/ja-JP/translation.json";
import koKR from "../../locales/ko-KR/translation.json";
import nlNL from "../../locales/nl-NL/translation.json";
import ptBR from "../../locales/pt-BR/translation.json";
import ruRU from "../../locales/ru-RU/translation.json";
import trTR from "../../locales/tr-TR/translation.json";

export const ALL_TRANSLATIONS: Record<
  SupportedLanguage,
  Record<string, string>
> = {
  "es-419": esLatam as Record<string, string>,
  "es-ES": esES as Record<string, string>,
  "en-US": enUS as Record<string, string>,
  "fr-FR": frFR as Record<string, string>,
  "de-DE": deDE as Record<string, string>,
  "hi-IN": hiIN as Record<string, string>,
  "id-ID": idID as Record<string, string>,
  "it-IT": itIT as Record<string, string>,
  "ja-JP": jaJP as Record<string, string>,
  "ko-KR": koKR as Record<string, string>,
  "pt-BR": ptBR as Record<string, string>,
  "nl-NL": nlNL as Record<string, string>,
  "ru-RU": ruRU as Record<string, string>,
  "tr-TR": trTR as Record<string, string>,
};
