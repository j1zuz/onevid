export const SUPPORTED_LANGUAGES = [
  { code: "es-419", label: "Español (Latinoamérica)" },
  { code: "es-ES", label: "Español (España)" },
  { code: "en-US", label: "English (United States)" },
  { code: "fr-FR", label: "Français (France)" },
  { code: "de-DE", label: "Deutsch (Deutschland)" },
  { code: "hi-IN", label: "हिन्दी (भारत)" },
  { code: "id-ID", label: "Indonesia (Indonesia)" },
  { code: "it-IT", label: "Italiano (Italia)" },
  { code: "ja-JP", label: "日本語 (日本)" },
  { code: "ko-KR", label: "한국어 (대한민국)" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "nl-NL", label: "Nederlands (Nederland)" },
  { code: "ru-RU", label: "Русский (Россия)" },
  { code: "tr-TR", label: "Türkçe (Türkiye)" },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export const DEFAULT_LANGUAGE: SupportedLanguage = "es-419";

export const SUPPORTED_CODES = SUPPORTED_LANGUAGES.map(
  (l) => l.code
) as readonly SupportedLanguage[];
