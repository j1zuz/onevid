"use client";

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { GlobeIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/languages";
import { useTranslation } from "@/lib/onevid-i18n-context";

const NEXT_LOCALE_COOKIE = "NEXT_LOCALE";

function persistLocaleCookie(locale: SupportedLanguage) {
  const maxAge = 60 * 60 * 24 * 365;
  // biome-ignore lint/suspicious/noDocumentCookie: setting the locale cookie is intentional
  document.cookie = `${NEXT_LOCALE_COOKIE}=${locale}; path=/; max-age=${maxAge}; samesite=lax`;
}

/**
 * Submenú de idioma dentro del menú de los 3 puntos: sincroniza el idioma en
 * memoria (useTranslation) y lo persiste en la cookie NEXT_LOCALE que lee el
 * layout server-side, así el idioma elegido sobrevive a recargas y a nuevas
 * visitas. Usa DropdownMenuSub (mismo árbol de foco/portal que el resto del
 * menú) en vez de un popup separado, para evitar conflictos de foco anidado.
 */
export function LanguageMenuItem() {
  const { language, setLanguage, t } = useTranslation();
  const router = useRouter();

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <GlobeIcon className="size-3.5" />
        {t("Idioma")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          onValueChange={(val) => {
            const locale = val as SupportedLanguage;
            setLanguage(locale);
            persistLocaleCookie(locale);
            // El catálogo de TMDB se resuelve en Server Components leyendo la
            // cookie NEXT_LOCALE una sola vez por navegación; sin refresh() el
            // texto de la UI cambia pero los posters siguen en el idioma viejo.
            router.refresh();
          }}
          value={language}
        >
          {SUPPORTED_LANGUAGES.map((lang) => (
            <DropdownMenuRadioItem key={lang.code} value={lang.code}>
              {lang.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
