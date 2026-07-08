import i18next, { type i18n, type TFunction } from "i18next";
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_CODES,
  type SupportedLanguage,
} from "@/lib/languages";
import { ALL_TRANSLATIONS } from "@/lib/translations";

export interface Translators {
  language: SupportedLanguage;
  t: TFunction;
}

export interface HackwI18nOptions {
  language?: SupportedLanguage;
  translationsForLanguage?: Record<string, string>;
}

export class Hackwi18n {
  private readonly i18nInstance: i18n;
  private currentLanguage: SupportedLanguage;
  private readonly translations: Partial<
    Record<SupportedLanguage, Record<string, string>>
  >;
  private initialized = false;

  constructor({
    language = DEFAULT_LANGUAGE,
    translationsForLanguage,
  }: HackwI18nOptions = {}) {
    this.currentLanguage = language;
    this.translations = {};
    this.i18nInstance = i18next.createInstance();

    if (translationsForLanguage) {
      this.translations[language] = translationsForLanguage;
    }
  }

  private async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const resources: Record<string, { translation: Record<string, string> }> =
      {};

    // Carga todos los idiomas desde los JSON generados por el CLI
    for (const [lang, keys] of Object.entries(ALL_TRANSLATIONS)) {
      resources[lang] = {
        translation: {
          ...keys,
          ...(this.translations[lang as SupportedLanguage] ?? {}),
        },
      };
    }

    // Idiomas con traducciones extra registradas manualmente (no en ALL_TRANSLATIONS)
    for (const [lang, keys] of Object.entries(this.translations)) {
      if (!resources[lang]) {
        resources[lang] = { translation: keys as Record<string, string> };
      }
    }

    await this.i18nInstance.init({
      lng: this.currentLanguage,
      fallbackLng: DEFAULT_LANGUAGE,
      resources,
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    this.initialized = true;
  }

  async setLanguage(lang: SupportedLanguage): Promise<void> {
    await this.init();
    this.currentLanguage = lang;
    await this.i18nInstance.changeLanguage(lang);
  }

  registerTranslation(
    lang: SupportedLanguage,
    keys: Record<string, string>
  ): void {
    this.translations[lang] = { ...(this.translations[lang] ?? {}), ...keys };

    if (this.initialized) {
      this.i18nInstance.addResourceBundle(
        lang,
        "translation",
        keys,
        true,
        true
      );
    }
  }

  async getTranslators(): Promise<Translators> {
    await this.init();
    return {
      t: this.i18nInstance.t.bind(this.i18nInstance),
      language: this.currentLanguage,
    };
  }

  getI18nInstance(): i18n {
    return this.i18nInstance;
  }

  getAvailableLanguages(): readonly SupportedLanguage[] {
    return SUPPORTED_CODES;
  }
}
