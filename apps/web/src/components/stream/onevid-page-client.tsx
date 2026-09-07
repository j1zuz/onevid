"use client";

import { buttonVariants } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ExploreMovieGrid } from "@/components/explore-movie-grid";
import type { OneVidAddonSummary } from "@/components/stepper-onevid";
import { ContinueWatchingRow } from "@/components/stream/continue-watching-row";
import { type FeedSection, FeedRow } from "@/components/stream/feed-row";
import { HeroCarousel } from "@/components/stream/hero-carousel";
import { OneVidHeader } from "@/components/stream/onevid-header";
import {
  type OneVidProfile,
  OneVidProfileProvider,
} from "@/components/stream/onevid-profile-context";
import type { FeedSurface, OneVidFeedRow } from "@/lib/onevid-feed";
import { useTranslation } from "@/lib/onevid-i18n-context";
import type { MediaMeta } from "@/lib/tmdb";

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

// Encabezado de las vistas "salidas del feed" ("Ver todo" de una fila, o
// "Ver todo" de Continuar viendo): título + botón para volver, con el mismo
// icono y estilo que el "Ver todo" que llevó hasta aquí.
function BackToHomeHeader({ title }: { title: string }) {
  const { t: rawT } = useTranslation();
  const t = (key: string) => rawT(key as never);
  return (
    <div className="container mx-auto flex items-baseline justify-between gap-2 px-3">
      <h1 className="font-semibold text-lg md:text-xl">{title}</h1>
      {/* Un `<a>` no debe renderizarse a través del `render` de Button (Base UI
          le exige semántica de botón nativo); se estilan las clases del botón
          directamente sobre el Link. */}
      <Link
        className={cn(buttonVariants({ size: "xs" }), "btn-primary shrink-0")}
        data-dpad-focusable
        href="/home"
      >
        <ChevronRightIcon data-icon="inline-start" />
        {t("Volver al inicio")}
      </Link>
    </div>
  );
}

interface OneVidPageClientProps {
  addons: OneVidAddonSummary[];
  discoverRows: OneVidFeedRow[];
  feedConfigured: boolean;
  feedRows: OneVidFeedRow[];
  /** Modo feed: filas ya resueltas por el server. */
  feedSections?: FeedSection[];
  hasTorboxKey: boolean;
  /** Hero destacado (trending película/serie), solo modo feed. */
  heroItems: MediaMeta[];
  initialProfiles: OneVidProfile[];
  linked: boolean;
  /** Modo "Ver todo": grilla completa de una sola fila. */
  posters?: MediaMeta[];
  setupCompleted: boolean;
  /** Pestaña activa del header (Inicio/Descubrir); la elige `?surface=` en /home. */
  surface?: FeedSurface;
  viewAllTitle?: string;
}

export function OneVidPageClient({
  addons,
  discoverRows,
  feedConfigured,
  feedRows,
  feedSections,
  hasTorboxKey,
  heroItems,
  initialProfiles,
  linked,
  posters,
  setupCompleted,
  surface,
  viewAllTitle,
}: OneVidPageClientProps) {
  const searchParams = useSearchParams();
  const { t: rawT } = useTranslation();
  const t = (key: string) => rawT(key as never);
  // Vista completa de Continuar viendo (navegada desde su propio "Ver todo").
  // No depende del server: los datos de progreso ya se piden en el cliente.
  const continueViewAll = searchParams.get("view") === "continuing";
  const router = useRouter();
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const handleMovieSelect = useCallback((movie: MediaMeta) => {
    router.push(`/home/detail/${movie.type}/${encodeURIComponent(movie.id)}`);
  }, [router]);

  let mainContent: ReactNode;
  if (feedSections?.length) {
    mainContent = feedSections.map((section) => (
      <FeedRow key={section.id} section={section} />
    ));
  } else if (posters?.length) {
    mainContent = <ExploreMovieGrid posters={posters} />;
  } else {
    mainContent = (
      <section className="rounded-xl border bg-card p-8 text-center">
        <p className="text-muted-foreground text-sm">
          No se encontraron resultados.
        </p>
      </section>
    );
  }

  return (
    <OneVidProfileProvider initialProfiles={initialProfiles}>
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <OneVidHeader
          discoverRows={discoverRows}
          addons={addons}
          feedConfigured={feedConfigured}
          feedRows={feedRows}
          hasTorboxKey={hasTorboxKey}
          linked={linked}
          onMovieSelect={handleMovieSelect}
          surface={surface}
          setupCompleted={setupCompleted}
        />

        {/* Contenedor con scroll propio (no el de <body>): así el fondo con
            fade del borde superior puede overlayarse sobre este contenedor
            específico. no-scrollbar oculta la barra (sigue siendo
            scrolleable con mouse/trackpad/touch/teclado, solo sin indicador
            visual, igual que el dropdown de búsqueda del header). */}
        <div className="relative min-h-0 flex-1">
          <ScrollTopFade scrollAreaRef={scrollAreaRef} />
          {/* `data-dpad-poster-grid` va aquí, en el contenedor de TODAS las
              filas, no en cada fila: findNextFocusable (dpad-navigation.tsx)
              resuelve el ámbito con `closest()` y devuelve null si no encuentra
              candidato dentro del mismo grid, así que con un grid por fila el
              mando no podría bajar de una fila a la siguiente. */}
          <div
            className="no-scrollbar flex h-full flex-col gap-8 overflow-y-auto py-4"
            data-dpad-poster-grid
            ref={scrollAreaRef}
          >
            {continueViewAll ? (
              <>
                <BackToHomeHeader title={t("Continuar viendo")} />
                <ContinueWatchingRow fullView />
              </>
            ) : viewAllTitle ? (
              // "Ver todo" de una fila del catálogo: sin Continuar viendo
              // arriba, solo el encabezado de vuelta y la grilla completa. Se
              // muestra también cuando la grilla viene vacía, para no dejar
              // al usuario atrapado sin los dropdowns que antes lo devolvían.
              <>
                <BackToHomeHeader title={viewAllTitle} />
                {mainContent}
              </>
            ) : (
              <>
                {heroItems.length > 0 && (
                  // -mt-4 para acercarlo al header: cancela el padding
                  // superior del contenedor con scroll (py-4) sin tocar el
                  // espaciado del resto de las filas.
                  <div className="-mt-4">
                    <HeroCarousel items={heroItems} />
                  </div>
                )}
                <ContinueWatchingRow />
                {mainContent}
              </>
            )}
          </div>
        </div>
      </div>

    </OneVidProfileProvider>
  );
}
