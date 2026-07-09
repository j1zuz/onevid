"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ExploreMovieDialog } from "@/components/explore-movie-dialog";
import { ExploreMovieGrid } from "@/components/explore-movie-grid";
import type { OneVidAddonSummary } from "@/components/stepper-onevid";
import { ContinueWatchingRow } from "@/components/stream/continue-watching-row";
import { OneVidHeader } from "@/components/stream/onevid-header";
import {
  type OneVidProfile,
  OneVidProfileProvider,
} from "@/components/stream/onevid-profile-context";
import type { MediaMeta, NetworkOption } from "@/lib/tmdb";

type CatalogType = "movie" | "series";

interface CatalogOption {
  id: string;
  name: string;
  type: CatalogType;
}

interface OneVidPageClientProps {
  addons: OneVidAddonSummary[];
  allNetworks: NetworkOption[];
  catalogs: CatalogOption[];
  catalogsByType: CatalogOption[];
  hasTorboxKey: boolean;
  initialProfiles: OneVidProfile[];
  linked: boolean;
  posters: MediaMeta[];
  selectedCatalog: string;
  selectedCatalogOption: CatalogOption | undefined;
  selectedNetwork?: NetworkOption;
  selectedType: CatalogType;
  setupCompleted: boolean;
  typeOptions: CatalogType[];
}

export function OneVidPageClient({
  typeOptions,
  selectedType,
  catalogs,
  catalogsByType,
  selectedCatalogOption,
  selectedCatalog,
  selectedNetwork,
  allNetworks,
  posters,
  addons,
  hasTorboxKey,
  initialProfiles,
  linked,
  setupCompleted,
}: OneVidPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchMovie, setSearchMovie] = useState<MediaMeta | null>(null);
  const [drawerKey, setDrawerKey] = useState(0);
  const consumedReopenRef = useRef(false);

  const handleMovieSelect = useCallback(
    (id: string, type: CatalogType) => {
      const found = posters.find((p) => p.id === id);
      setSearchMovie(
        found ?? {
          id,
          type,
          name: "",
          poster: "",
          background: "",
          logo: "",
        }
      );
      setDrawerKey((k) => k + 1);
    },
    [posters]
  );

  // Reopen movie drawer when returning from the player via ?movie=&movieType=
  useEffect(() => {
    if (consumedReopenRef.current) {
      return;
    }
    const movieId = searchParams.get("movie");
    const movieTypeParam = searchParams.get("movieType");
    if (!movieId) {
      return;
    }
    consumedReopenRef.current = true;
    const movieType: CatalogType =
      movieTypeParam === "series" ? "series" : "movie";
    handleMovieSelect(movieId, movieType);

    // Strip the params from the URL without adding history
    const next = new URLSearchParams(searchParams.toString());
    next.delete("movie");
    next.delete("movieType");
    const qs = next.toString();
    router.replace(
      qs ? `/home?${qs}` : "/home",
      {
        scroll: false,
      }
    );
  }, [searchParams, handleMovieSelect, router]);

  let mainContent: ReactNode;
  if (posters.length === 0) {
    mainContent = (
      <section className="rounded-xl border bg-card p-8 text-center">
        <p className="text-muted-foreground text-sm">
          No se encontraron resultados.
        </p>
      </section>
    );
  } else {
    mainContent = <ExploreMovieGrid posters={posters} />;
  }

  return (
    <OneVidProfileProvider initialProfiles={initialProfiles}>
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <OneVidHeader
          addons={addons}
          allNetworks={allNetworks}
          catalogs={catalogs}
          catalogsByType={catalogsByType}
          hasTorboxKey={hasTorboxKey}
          linked={linked}
          onMovieSelect={handleMovieSelect}
          selectedCatalog={selectedCatalog}
          selectedCatalogOption={selectedCatalogOption}
          selectedNetwork={selectedNetwork}
          selectedType={selectedType}
          setupCompleted={setupCompleted}
          typeOptions={typeOptions}
        />

        {/* Contenedor con scroll propio (no el de <body>): así el util
            scroll-fade-t de shadcn, que necesita que el elemento con la clase
            sea el que scrollea, puede aplicarse y verse al bajar.
            no-scrollbar oculta la barra de este contenedor (sigue siendo
            scrolleable con mouse/trackpad/touch/teclado, solo sin indicador
            visual, igual que el dropdown de búsqueda del header). */}
        <div className="scroll-fade-t no-scrollbar flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto py-4">
          <ContinueWatchingRow />
          {mainContent}
        </div>
      </div>

      {searchMovie && (
        <ExploreMovieDialog
          defaultOpen
          key={`search-${drawerKey}-${searchMovie.id}`}
          movie={searchMovie}
          onPlay={() => setSearchMovie(null)}
        />
      )}
    </OneVidProfileProvider>
  );
}
