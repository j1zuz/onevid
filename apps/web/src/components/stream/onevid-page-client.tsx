"use client";

import { cn } from "@workspace/ui/lib/utils";
import { useSearchParams } from "next/navigation";
import {
  type ReactNode,
  type RefObject,
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

// Top-edge fade, cheap version: the shadcn `scroll-fade-t` utility masks
// (`mask-image`) whatever element it's applied to and re-evaluates that mask
// every scroll frame via a CSS scroll-driven animation. Applied directly to
// the scrollable container (dozens of poster `<img>`s), that forced the
// browser to re-rasterize the whole grid on every scroll tick.
//
// This component owns its `isScrolled` state itself, attaching the scroll
// listener directly to the DOM node via an effect, instead of lifting that
// state into `OneVidPageClient`. Lifting it up made the WHOLE page
// (including `OneVidProfileProvider` and everything under it) re-render on
// every scroll-direction toggle, even though nothing about the catalog
// itself changed — react-scan flagged this as dozens of "no changes
// detected" renders. Keeping the state here means only this tiny overlay
// re-renders when scrolling.
function ScrollTopFade({
  scrollAreaRef,
}: {
  scrollAreaRef: RefObject<HTMLDivElement | null>;
}) {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) {
      return;
    }
    let ticking = false;
    const handleScroll = () => {
      if (ticking) {
        return;
      }
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        setIsScrolled(el.scrollTop > 0);
      });
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [scrollAreaRef]);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-10 h-10 bg-gradient-to-b from-background to-transparent transition-opacity duration-150",
        isScrolled ? "opacity-100" : "opacity-0"
      )}
    />
  );
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
  const searchParams = useSearchParams();
  const [searchMovie, setSearchMovie] = useState<MediaMeta | null>(null);
  const [drawerKey, setDrawerKey] = useState(0);
  const consumedReopenRef = useRef(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

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

    // Strip the params from the URL via the native History API instead of
    // router.replace: this avoids a second Next.js soft-navigation (RSC
    // round-trip) stacked right on top of the one that brought us back from
    // the player, which was leaving the lazy-loaded poster grid in a broken,
    // blank-canvas state.
    const next = new URLSearchParams(searchParams.toString());
    next.delete("movie");
    next.delete("movieType");
    const qs = next.toString();
    window.history.replaceState(null, "", qs ? `/home?${qs}` : "/home");
  }, [searchParams, handleMovieSelect]);

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

        {/* Contenedor con scroll propio (no el de <body>): así el fondo con
            fade del borde superior puede overlayarse sobre este contenedor
            específico. no-scrollbar oculta la barra (sigue siendo
            scrolleable con mouse/trackpad/touch/teclado, solo sin indicador
            visual, igual que el dropdown de búsqueda del header). */}
        <div className="relative min-h-0 flex-1">
          <ScrollTopFade scrollAreaRef={scrollAreaRef} />
          <div
            className="no-scrollbar flex h-full flex-col gap-8 overflow-y-auto py-4"
            ref={scrollAreaRef}
          >
            <ContinueWatchingRow />
            {mainContent}
          </div>
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
