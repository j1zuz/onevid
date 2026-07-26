"use client";

import { Input } from "@workspace/ui/components/input";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import { SearchIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OneVidAddonSummary } from "@/components/stepper-onevid";
import { OneVidProfileSwitcher } from "@/components/stream/onevid-profile-switcher";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { useTranslation } from "@/lib/onevid-i18n-context";
import type { FeedSurface, OneVidFeedRow } from "@/lib/onevid-feed";
import type { MediaMeta } from "@/lib/tmdb";

type CatalogType = "movie" | "series";

interface SearchMeta {
  background?: string;
  id: string;
  imdbRating?: string;
  name: string;
  poster?: string;
  type?: CatalogType;
  year?: string;
}

const SURFACE_TABS: Array<{
  href: string;
  label: string;
  surface: FeedSurface;
}> = [
  { href: "/home", label: "Inicio", surface: "home" },
  { href: "/home?surface=discover", label: "Descubrir", surface: "discover" },
];

// El endpoint ya recorta a 20; en el dropdown solo caben unos pocos.
const SEARCH_RESULT_LIMIT = 8;
const SEARCH_SKELETON_ROWS = ["a", "b", "c", "d"];

function buildSearchUrl(query: string): string {
  return `/api/search?q=${encodeURIComponent(query)}`;
}

function parseSearchResults(payload: unknown): SearchMeta[] {
  const results = (payload as { results?: SearchMeta[] } | null)?.results;
  return Array.isArray(results) ? results.slice(0, SEARCH_RESULT_LIMIT) : [];
}

// feedConfigured/feedRows/hasTorboxKey/addons/linked/setupCompleted quedan en
// la interfaz para no romper a los server components que ya arman este
// objeto de props (home/page.tsx), pero el header ya no los usa: esa
// configuración vive en la página /home/account.
interface OneVidHeaderProps {
  addons: OneVidAddonSummary[];
  discoverRows: OneVidFeedRow[];
  feedConfigured: boolean;
  feedRows: OneVidFeedRow[];
  hasTorboxKey: boolean;
  linked: boolean;
  onMovieSelect?: (movie: MediaMeta) => void;
  setupCompleted: boolean;
  /** Pestaña activa; la elige `?surface=` en /home. */
  surface?: FeedSurface;
}

export function OneVidHeader({
  onMovieSelect,
  surface = "home",
}: OneVidHeaderProps) {
  const { t: rawT } = useTranslation();
  const t = (key: string) => rawT(key as never);
  const {
    loading: searchLoading,
    query: searchQuery,
    reset: resetSearch,
    results: searchResults,
    search,
    submit,
  } = useDebouncedSearch<SearchMeta>({
    buildUrl: buildSearchUrl,
    parse: parseSearchResults,
  });
  // `open` es independiente de la respuesta del fetch a propósito: antes el
  // dropdown se abría al *recibir* los resultados, así que en la primera
  // búsqueda el skeleton no llegaba a verse nunca y la lista aparecía de
  // golpe (a partir de la segunda sí, porque el estado ya se había quedado
  // abierto).
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const hasQuery = searchQuery.trim().length > 0;
  const showResults = open && hasQuery;

  const handleSearchChange = useCallback(
    (value: string) => {
      search(value);
      setOpen(value.trim().length > 0);
    },
    [search]
  );

  const handleSearchSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      submit();
      setOpen(searchQuery.trim().length > 0);
    },
    [searchQuery, submit]
  );

  const clearSearch = useCallback(() => {
    resetSearch();
    setOpen(false);
  }, [resetSearch]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function renderSearchResults() {
    // Solo caemos al skeleton cuando no hay nada que mostrar. Si ya había
    // resultados, se quedan atenuados mientras llega la query refinada: así
    // el dropdown no cambia de alto en cada tecla.
    if (searchLoading && searchResults.length === 0) {
      return (
        <div className="space-y-2 p-2">
          {SEARCH_SKELETON_ROWS.map((key) => (
            <div className="flex items-center gap-3" key={key}>
              <Skeleton className="h-12 w-20 shrink-0 rounded-md" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      );
    }
    if (searchResults.length === 0) {
      return (
        <p className="p-3 text-center text-muted-foreground text-sm">
          {t("No se encontraron resultados")}
        </p>
      );
    }
    return (
      <ul
        className={cn(
          "scroll-fade-y max-h-80 overflow-y-auto transition-opacity [&::-webkit-scrollbar]:hidden",
          searchLoading && "opacity-50"
        )}
        style={{ scrollbarWidth: "none" }}
      >
        {searchResults.map((item) => (
          // Tipo + id, igual que el dedupe de /api/search: los ids de TMDB
          // son por colección, así que una película y una serie pueden
          // compartir el mismo número y colisionar como key.
          <li key={`${item.type ?? "movie"}:${item.id}`}>
            <button
              className="flex w-full items-center gap-3 rounded-md border border-transparent px-3 py-2 text-left transition-colors"
              data-dpad-focusable
              onClick={() => {
                // Pasamos el objeto completo del /api/search: así el diálogo
                // abre con título y arte sin tener que buscar el item en una
                // lista de la página (que con el feed ya no es única).
                onMovieSelect?.({
                  background: item.background,
                  id: item.id,
                  imdbRating: item.imdbRating,
                  name: item.name,
                  poster: item.poster,
                  type: item.type === "series" ? "series" : "movie",
                  year: item.year,
                });
                clearSearch();
              }}
              type="button"
            >
              {item.background || item.poster ? (
                /* biome-ignore lint/performance/noImgElement: external CDN art */
                <img
                  alt=""
                  className="h-12 w-20 shrink-0 rounded-md object-cover"
                  decoding="async"
                  loading="lazy"
                  src={item.background || item.poster}
                />
              ) : (
                <div className="h-12 w-20 shrink-0 rounded-md bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground text-sm">
                  {item.name}
                </p>
                <p className="flex items-center gap-1 text-muted-foreground text-xs">
                  {item.year && <span>{item.year}</span>}
                  {item.imdbRating && (
                    <>
                      <span>·</span>
                      <span className="text-yellow-500/80">
                        ★ {item.imdbRating}
                      </span>
                    </>
                  )}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section
      className="sticky top-0 z-20 -mx-4 mb-6 flex items-center gap-3 border-border border-b border-dashed bg-background/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-background/80 md:-mx-6 md:px-6"
      data-dpad-focus-subtle
    >
      {/* Logo: lleva de vuelta a /home. */}
      <Link
        className="flex shrink-0 items-center rounded border border-transparent"
        data-dpad-focusable
        href="/home"
      >
        {/* biome-ignore lint/performance/noImgElement: logo SVG estático local */}
        <img
          alt="onevid"
          className="size-8 rounded-md border border-border/70 bg-card p-1"
          height={32}
          src="/onevid.svg"
          width={32}
        />
      </Link>

      {/* Las dos superficies configurables. Son enlaces y no un control con
          estado porque cada una es una carga distinta del Server Component; el
          feed de cada pestaña lo arma el usuario en el paso 2 del stepper. */}
      <nav className="flex shrink-0 items-center gap-1">
        {SURFACE_TABS.map((tab) => (
          <Link
            aria-current={surface === tab.surface ? "page" : undefined}
            className={cn(
              "rounded-full border border-transparent px-3 py-1 font-medium text-sm transition-colors",
              surface === tab.surface
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            data-dpad-focusable
            href={tab.href}
            key={tab.surface}
          >
            {t(tab.label)}
          </Link>
        ))}
      </nav>

      {/* Búsqueda + perfil + configuración. Los selectores de tipo / catálogo /
          cadena que vivían aquí ahora son el paso 2 del stepper ("Configurar
          feed"): el usuario arma su inicio una vez y /home lo respeta. */}
      <div className="flex flex-1 items-center justify-end gap-2">
        {/* max-w para que la búsqueda no ocupe todo el espacio entre el logo y
            los controles de la derecha. */}
        <div className="relative w-full max-w-xs" ref={searchRef}>
          <form onSubmit={handleSearchSubmit}>
            <div className="relative">
              <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="w-full pr-8 pl-9"
                data-dpad-focusable
                onChange={(e) => handleSearchChange(e.target.value)}
                onFocus={() => {
                  if (hasQuery) {
                    setOpen(true);
                  }
                }}
                placeholder={`${t("Buscar")}...`}
                type="text"
                value={searchQuery}
              />
              {searchQuery && (
                <button
                  className="-translate-y-1/2 absolute top-1/2 right-3 rounded border border-transparent text-muted-foreground hover:text-foreground"
                  data-dpad-focusable
                  onClick={clearSearch}
                  type="button"
                >
                  <XIcon className="size-4" />
                </button>
              )}
            </div>
          </form>

          {showResults && (
            /* El fade+slide es del contenedor, no de cada resultado: el
               scanner del mando (dpad-navigation) descarta los elementos con
               opacity 0, así que animar los ítems uno a uno los volvería
               inalcanzables mientras dura su animación. */
            <div className="absolute top-full right-0 z-50 mt-1 w-full animate-in overflow-hidden rounded-lg border border-border bg-card shadow-lg duration-150 fade-in-0 slide-in-from-top-1">
              {renderSearchResults()}
            </div>
          )}
        </div>

        {/* Único trigger: el dropdown del avatar trae perfiles + Configuración
            + Modo local + Cerrar sesión (onevid-profile-switcher.tsx). Ya no
            hay un ícono de engranaje aparte. */}
        <OneVidProfileSwitcher />
      </div>
    </section>
  );
}
