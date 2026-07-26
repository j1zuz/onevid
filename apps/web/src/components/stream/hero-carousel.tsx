"use client";

import { cn } from "@workspace/ui/lib/utils";
import { PlayIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { ExploreMovieDialog } from "@/components/explore-movie-dialog";
import { tmdbImage, type MediaMeta } from "@/lib/tmdb";

const AUTOPLAY_MS = 5000;
// w1280 (no "original"): banners grandes pero sin bajar backdrops de varios MB.
const HERO_IMAGE_SIZE = "w1280" as const;

/**
 * Hero destacado arriba de /home, igual en espíritu al carrusel de la app
 * móvil (apps/mobile/src/components/home/hero-carousel.tsx): mismo origen de
 * datos (trending película/serie intercalados) y misma idea de logo del
 * título sobre el backdrop. Sin animación de fundido entre diapositivas por
 * ahora (corte directo) para no depender de que una animación JS termine de
 * aplicarse para que la imagen sea visible.
 */
export function HeroCarousel({ items }: { items: MediaMeta[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [logoByKey, setLogoByKey] = useState<Record<string, string | null>>(
    {}
  );

  const active = items[index];
  const activeKey = active ? `${active.type}:${active.id}` : null;

  useEffect(() => {
    if (paused || items.length <= 1) {
      return;
    }
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % items.length);
    }, AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [paused, items.length]);

  // Logo tipográfico del título activo (si TMDB tiene uno), pedido bajo
  // demanda y cacheado por slide para no repetir el fetch al volver a pasar
  // por la misma diapositiva.
  useEffect(() => {
    if (!(active && activeKey) || activeKey in logoByKey) {
      return;
    }
    let cancelled = false;
    fetch(
      `/api/tmdb-logo?type=${active.type}&id=${encodeURIComponent(active.id)}`
    )
      .then((res) => (res.ok ? (res.json() as Promise<{ logo: string | null }>) : null))
      .then((data) => {
        if (!cancelled) {
          setLogoByKey((prev) => ({ ...prev, [activeKey]: data?.logo ?? null }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLogoByKey((prev) => ({ ...prev, [activeKey]: null }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [active, activeKey, logoByKey]);

  if (!active) {
    return null;
  }

  const activeLogo = activeKey ? logoByKey[activeKey] : null;
  const art = tmdbImage(active.background ?? active.poster, HERO_IMAGE_SIZE);

  return (
    <section
      // min-h además de aspect-ratio: red de seguridad para que la sección
      // nunca quede en 0 de alto si el aspect-ratio no llega a calcularse
      // dentro del contenedor flex-col que la envuelve.
      className="relative mb-2 aspect-video w-full min-h-56 overflow-hidden rounded-(--radius) border border-border/70 bg-muted md:aspect-[21/9] md:min-h-96"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <ExploreMovieDialog movie={active}>
        <div className="relative h-full w-full">
          {/* Sin motion/react para esto: la imagen siempre visible de
              entrada (opacity-100 fijo), sin depender de que una animación
              JS termine de aplicarse para que se vea algo. El `key` sigue
              forzando un elemento nuevo por diapositiva. */}
          {/* biome-ignore lint/performance/noImgElement: external CDN backdrop */}
          <img
            alt={active.name}
            // object-top en vez de center: los backdrops de TMDB suelen tener
            // la cara/sujeto principal arriba, y con "center" el recorte a
            // 16:9/21:9 se la comía por igual arriba y abajo.
            className="absolute inset-0 h-full w-full object-cover object-top"
            key={activeKey}
            loading="eager"
            src={art}
          />

          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/10 to-transparent"
          />

          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-start gap-3 p-5 md:p-10">
            {activeLogo ? (
              // biome-ignore lint/performance/noImgElement: external CDN logo
              <img
                alt={active.name}
                className="max-h-14 max-w-64 object-contain drop-shadow-lg md:max-h-24 md:max-w-96"
                src={activeLogo}
              />
            ) : (
              <h2 className="max-w-lg font-bold text-white text-xl drop-shadow-lg md:text-4xl">
                {active.name}
              </h2>
            )}
            {active.description && (
              <p className="line-clamp-2 max-w-lg text-sm text-white/90 drop-shadow-lg md:line-clamp-3 md:text-base">
                {active.description}
              </p>
            )}
            <span className="btn-primary inline-flex items-center gap-1.5 rounded-4xl px-4 py-2 font-medium text-sm">
              <PlayIcon className="size-4 fill-current" />
              Reproducir
            </span>
          </div>
        </div>
      </ExploreMovieDialog>

      {items.length > 1 && (
        <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center gap-1.5">
          {items.map((item, i) => (
            <button
              aria-label={item.name}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index ? "w-6 bg-primary" : "w-1.5 bg-white/40"
              )}
              data-dpad-focusable
              key={`${item.type}-${item.id}`}
              onClick={() => setIndex(i)}
              type="button"
            />
          ))}
        </div>
      )}
    </section>
  );
}
