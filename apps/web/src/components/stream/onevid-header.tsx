"use client";

import { buttonVariants } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@workspace/ui/components/drawer";
import { Input } from "@workspace/ui/components/input";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import { BoltIcon, LogOutIcon, SearchIcon, UploadIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LanguageMenuItem } from "@/components/language-selector";
import {
  type OneVidAddonSummary,
  SetupStepper,
} from "@/components/stepper-onevid";
import { authClient } from "@/lib/auth-client";
import { OneVidProfileSwitcher } from "@/components/stream/onevid-profile-switcher";
import { useTranslation } from "@/lib/onevid-i18n-context";
import type { OneVidFeedRow } from "@/lib/onevid-feed";
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

interface OneVidHeaderProps {
  addons: OneVidAddonSummary[];
  feedConfigured: boolean;
  feedRows: OneVidFeedRow[];
  hasTorboxKey: boolean;
  linked: boolean;
  onMovieSelect?: (movie: MediaMeta) => void;
  setupCompleted: boolean;
}

export function OneVidHeader({
  onMovieSelect,
  addons,
  feedConfigured,
  feedRows,
  hasTorboxKey,
  linked,
  setupCompleted,
}: OneVidHeaderProps) {
  const { push, refresh } = useRouter();
  const { t: rawT } = useTranslation();
  const t = (key: string) => rawT(key as never);
  const [configOpen, setConfigOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          push("/");
          refresh();
        },
        onError: () => {
          setSigningOut(false);
        },
      },
    });
  }, [push, refresh]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchMeta[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSearchResults(data.results?.slice(0, 8) || []);
      setShowResults(true);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => doSearch(value), 350);
    },
    [doSearch]
  );

  const handleSearchSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (searchQuery.trim()) {
        doSearch(searchQuery);
      }
    },
    [searchQuery, doSearch]
  );

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchResults([]);
    setShowResults(false);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function renderSearchResults() {
    if (searchLoading) {
      return (
        <div className="space-y-2 p-2">
          {["a", "b", "c", "d"].map((key) => (
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
          No se encontraron resultados
        </p>
      );
    }
    return (
      <ul
        className="scroll-fade-y max-h-80 overflow-y-auto [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        {searchResults.map((item) => (
          <li key={item.id}>
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
                setShowResults(false);
                setSearchQuery("");
              }}
              type="button"
            >
              {item.background || item.poster ? (
                <div
                  className="h-12 w-20 shrink-0 rounded-md bg-center bg-cover"
                  style={{
                    backgroundImage: `url(${item.background || item.poster})`,
                  }}
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
      {/* Búsqueda + perfil + configuración. Los selectores de tipo / catálogo /
          cadena que vivían aquí ahora son el paso 2 del stepper ("Configurar
          feed"): el usuario arma su inicio una vez y /home lo respeta. */}
      <div className="flex flex-1 items-center gap-2">
        <div className="relative flex-1" ref={searchRef}>
          <form onSubmit={handleSearchSubmit}>
            <div className="relative">
              <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="w-full pr-8 pl-9"
                data-dpad-focusable
                onChange={(e) => handleSearchChange(e.target.value)}
                onFocus={() => {
                  if (searchResults.length > 0) {
                    setShowResults(true);
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
            <div className="absolute top-full right-0 z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
              {renderSearchResults()}
            </div>
          )}
        </div>

        <OneVidProfileSwitcher />

        <div aria-hidden className="h-6 w-px shrink-0 bg-border" />

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("Configuración")}
            className={cn(buttonVariants({ size: "icon", variant: "outline" }))}
            data-dpad-focusable
          >
            <BoltIcon className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuItem
              data-dpad-focusable
              onClick={() => setConfigOpen(true)}
            >
              <BoltIcon className="size-3.5" />
              {t("Configuración de onevid")}
            </DropdownMenuItem>
            <LanguageMenuItem />
            <DropdownMenuSeparator />
            {/* Navega a /: la MISMA pantalla de modo local que ve alguien sin
                sesión (sin duplicar una versión propia acá). El proxy
                (src/proxy.ts) detecta que venimos de /home vía Referer y no
                redirige de vuelta. */}
            <DropdownMenuItem data-dpad-focusable render={<Link href="/" />}>
              <UploadIcon className="size-3.5" />
              {t("Modo local")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-dpad-focusable
              disabled={signingOut}
              onClick={handleSignOut}
              variant="destructive"
            >
              <LogOutIcon className="size-3.5" />
              {t("Cerrar sesión")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Drawer sobre @base-ui/react/drawer (NO vaul): misma librería que
            DropdownMenu/Dialog en este proyecto, así que el menú de los 3
            puntos anidado dentro funciona sin conflictos de foco/portal. */}
        <Drawer
          onOpenChange={setConfigOpen}
          open={configOpen}
          swipeDirection="right"
        >
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{t("Configuración de onevid")}</DrawerTitle>
              <DrawerDescription>
                {t("Gestiona tu configuración.")}
              </DrawerDescription>
            </DrawerHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
              <SetupStepper
                feedConfigured={feedConfigured}
                feedRows={feedRows}
                hasTorboxKey={hasTorboxKey}
                initialAddons={addons}
                linked={linked}
                setupCompleted={setupCompleted}
              />
            </div>
          </DrawerContent>
        </Drawer>
      </div>
    </section>
  );
}
