"use client";

import { Skeleton } from "@workspace/ui/components/skeleton";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { WatchProvider, WatchProviders } from "@/lib/tmdb";

/**
 * Muestra dónde ver el título (suscripción, alquiler y compra) cuando la app no
 * tiene fuentes propias para reproducir.
 *
 * La lista y los logos vienen de TMDB; el deep-link directo a cada plataforma
 * (`provider.link`) viene de JustWatch, resuelto en el backend con el título y
 * el año. Si un proveedor no tiene deep-link, se cae a la página de TMDB
 * (`data.link`), que a su vez enlaza a las plataformas. Si no hay nada para la
 * región (o falla), renderiza `fallback`.
 */
export function WatchProvidersNotice({
  type,
  id,
  title,
  year,
  fallback,
}: {
  type: "movie" | "series";
  id: string;
  title: string;
  year?: string;
  fallback: ReactNode;
}) {
  const [data, setData] = useState<WatchProviders | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ type, id, title });
    if (year) {
      params.set("year", year);
    }
    fetch(`/api/watch-providers?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((d: WatchProviders | null) => {
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        // Petición abortada (cleanup del effect / props cambiadas): NO apagamos
        // `loading`, si no el fallback parpadea antes de que llegue la real.
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        setLoading(false);
      });
    return () => controller.abort();
  }, [type, id, title, year]);

  if (loading) {
    // Misma caja que el resultado final para que no haya salto visual.
    return (
      <div className="rounded-lg border border-border/50 bg-muted/50 p-3">
        <div className="flex flex-wrap gap-2">
          {["a", "b", "c"].map((key) => (
            <Skeleton className="size-11 rounded-lg" key={key} />
          ))}
        </div>
      </div>
    );
  }

  const groups: { items: WatchProvider[]; key: string; label: string }[] = [
    { key: "flatrate", label: "Suscripción", items: data?.flatrate ?? [] },
    { key: "rent", label: "Alquiler", items: data?.rent ?? [] },
    { key: "buy", label: "Compra", items: data?.buy ?? [] },
  ].filter((g) => g.items.length > 0);

  if (groups.length === 0) {
    return <>{fallback}</>;
  }

  return (
    <div className="space-y-3 rounded-lg border border-border/50 bg-muted/50 p-3">
      {groups.map((group) => (
        <div className="space-y-1.5" key={group.key}>
          <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
            {group.label}
          </p>
          <div className="flex flex-wrap gap-2">
            {group.items.map((p) => (
              <ProviderTile fallbackLink={data?.link} key={p.id} provider={p} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProviderTile({
  provider,
  fallbackLink,
}: {
  provider: WatchProvider;
  fallbackLink?: string;
}) {
  const logo = provider.logo ? (
    // biome-ignore lint/performance/noImgElement: external CDN logo
    <img
      alt={provider.name}
      className="size-11 rounded-lg object-contain"
      height={44}
      src={provider.logo}
      width={44}
    />
  ) : (
    <span className="flex size-11 items-center justify-center rounded-lg bg-background text-center text-[10px] text-muted-foreground">
      {provider.name}
    </span>
  );

  // Deep-link de JustWatch si existe; si no, la página de TMDB como fallback.
  const href = provider.link ?? fallbackLink;
  if (href) {
    return (
      <a
        className="transition-transform hover:scale-105"
        href={href}
        rel="noreferrer"
        target="_blank"
        title={provider.name}
      >
        {logo}
      </a>
    );
  }
  return <span title={provider.name}>{logo}</span>;
}
