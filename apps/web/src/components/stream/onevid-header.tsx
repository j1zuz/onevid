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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import {
  BoltIcon,
  LogOutIcon,
  MonitorPlayIcon,
  SearchIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type OneVidAddonSummary,
  SetupStepper,
} from "@/components/stepper-onevid";
import { authClient } from "@/lib/auth-client";
import { OneVidProfileSwitcher } from "@/components/stream/onevid-profile-switcher";
import { useHackwTranslation } from "@/lib/hackw-i18n-context";
import type { NetworkOption } from "@/lib/tmdb";

type CatalogType = "movie" | "series";

interface CatalogOption {
  id: string;
  name: string;
  type: CatalogType;
}

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
  allNetworks: NetworkOption[];
  catalogs: CatalogOption[];
  catalogsByType: CatalogOption[];
  hasTorboxKey: boolean;
  linked: boolean;
  localMode: boolean;
  onLocalModeChange: (localMode: boolean) => void;
  onMovieSelect?: (id: string, type: CatalogType) => void;
  selectedCatalog: string;
  selectedCatalogOption: CatalogOption | undefined;
  selectedNetwork?: NetworkOption;
  selectedType: CatalogType;
  setupCompleted: boolean;
  typeOptions: CatalogType[];
}

function getCatalogDisplayLabel(
  catalog: CatalogOption,
  t: (key: string) => string
): string {
  const normalizedId = catalog.id.trim().toLowerCase();
  if (normalizedId === "top") {
    return t("Populares");
  }
  if (normalizedId === "year") {
    return t("Estrenos");
  }
  if (normalizedId === "imdbrating") {
    return t("Destacados");
  }
  return catalog.name;
}

function buildUrl({
  type,
  catalog,
  network,
}: {
  type: CatalogType;
  catalog: string;
  network?: number;
}): string {
  const params = new URLSearchParams();
  params.set("type", type);
  params.set("catalog", catalog);
  if (network) {
    params.set("network", String(network));
  }
  return `/home?${params.toString()}`;
}

export function OneVidHeader({
  typeOptions,
  selectedType,
  catalogs,
  catalogsByType,
  selectedCatalogOption: _selectedCatalogOption,
  selectedCatalog,
  allNetworks,
  selectedNetwork,
  onMovieSelect,
  addons,
  hasTorboxKey,
  linked,
  localMode,
  onLocalModeChange,
  setupCompleted,
}: OneVidHeaderProps) {
  const { push, refresh } = useRouter();
  const { t: rawT } = useHackwTranslation();
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
        className="max-h-80 overflow-y-auto [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        {searchResults.map((item) => (
          <li key={item.id}>
            <button
              className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent"
              onClick={() => {
                const resultType: CatalogType =
                  item.type === "series" ? "series" : "movie";
                onMovieSelect?.(item.id, resultType);
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
    <section className="sticky top-0 z-20 -mx-4 mb-6 grid grid-cols-1 gap-3 border-border/50 border-b bg-background/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-background/80 md:-mx-6 md:grid-cols-4 md:px-6">
      {/* Type selector */}
      <Select
        items={typeOptions.map((type) => ({
          value: type,
          label: type === "movie" ? t("Películas") : t("Series"),
        }))}
        onValueChange={(val) => {
          const type = val as CatalogType;
          const firstCatalog =
            catalogs.find((c) => c.type === type)?.id ?? "top";
          push(buildUrl({ type, catalog: firstCatalog }));
        }}
        value={selectedType}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {typeOptions.map((type) => (
            <SelectItem key={type} value={type}>
              {type === "movie" ? t("Películas") : t("Series")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Catalog selector */}
      <Select
        items={catalogsByType.map((catalog) => ({
          value: catalog.id,
          label: getCatalogDisplayLabel(catalog, t),
        }))}
        onValueChange={(val) => {
          if (val) {
            push(buildUrl({ type: selectedType, catalog: val }));
          }
        }}
        value={selectedCatalog}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {catalogsByType.map((catalog) => (
            <SelectItem
              key={`${catalog.type}:${catalog.id}`}
              value={catalog.id}
            >
              {getCatalogDisplayLabel(catalog, t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Network selector */}
      <Select
        items={[
          { value: "all", label: t("Todas las cadenas") },
          ...allNetworks.map((n) => ({
            value: String(n.id),
            label: n.name,
          })),
        ]}
        onValueChange={(val) => {
          if (val === "all") {
            push(buildUrl({ type: selectedType, catalog: selectedCatalog }));
          } else {
            push(
              buildUrl({
                type: selectedType,
                catalog: selectedCatalog,
                network: Number(val),
              })
            );
          }
        }}
        value={selectedNetwork ? String(selectedNetwork.id) : "all"}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("Todas las cadenas")}</SelectItem>
          {allNetworks.map((network) => (
            <SelectItem key={network.id} value={String(network.id)}>
              {network.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Search + Config */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1" ref={searchRef}>
          <form onSubmit={handleSearchSubmit}>
            <div className="relative">
              <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="w-full pr-8 pl-9"
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
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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
          >
            <BoltIcon className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuItem onClick={() => setConfigOpen(true)}>
              <BoltIcon className="size-3.5" />
              {t("Configuración de onevid")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {localMode ? (
              <DropdownMenuItem onClick={() => onLocalModeChange(false)}>
                <MonitorPlayIcon className="size-3.5" />
                {t("Volver a modo stream")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onLocalModeChange(true)}>
                <UploadIcon className="size-3.5" />
                {t("Modo local")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={signingOut}
              onClick={handleSignOut}
              variant="destructive"
            >
              <LogOutIcon className="size-3.5" />
              {t("Cerrar sesión")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Mismo Drawer (vaul, direction="right") que usa hackw para el
            historial de chat de IA: panel flotante con antes: antes/bordes
            redondeados, en vez del Sheet de borde recto. */}
        <Drawer direction="right" onOpenChange={setConfigOpen} open={configOpen}>
          <DrawerContent>
            <div
              className="mx-auto flex w-full max-w-md flex-col overflow-hidden"
              style={{ height: "min(88vh, 100dvh - 2rem)" }}
            >
              <DrawerHeader className="shrink-0">
                <DrawerTitle>{t("Configuración de onevid")}</DrawerTitle>
                <DrawerDescription>
                  {t("Gestiona tu token de TMDB y los complementos OneVLP.")}
                </DrawerDescription>
              </DrawerHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
                <SetupStepper
                  hasTorboxKey={hasTorboxKey}
                  initialAddons={addons}
                  linked={linked}
                  setupCompleted={setupCompleted}
                />
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      </div>
    </section>
  );
}
