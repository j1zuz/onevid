"use client";

import { buttonVariants } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  HORIZONTAL_POSTER_GRID_CLASS,
  PosterCard,
} from "@/components/stream/poster-card";
import { useOneVidProfiles } from "@/components/stream/onevid-profile-context";
import { FEED_ROW_ITEM_LIMIT } from "@/lib/onevid-feed";
import { useTranslation } from "@/lib/onevid-i18n-context";
import type { MediaMeta } from "@/lib/tmdb";

interface ContinueWatchingItem extends MediaMeta {
  durationSec: number;
  positionSec: number;
}

interface ContinueWatchingRowProps {
  /**
   * Vista completa (/home?view=continuing): sin cap ni botón "Ver todo" propio
   * ni encabezado propio — el título y el "Volver al inicio" los pone la
   * página, igual que en las demás filas del feed.
   */
  fullView?: boolean;
}

/**
 * "Continue watching" row: the profile's in-progress titles with a resume
 * progress bar over each poster. Hidden entirely when there's nothing to resume.
 */
export function ContinueWatchingRow({
  fullView = false,
}: ContinueWatchingRowProps = {}) {
  const { t, language } = useTranslation();
  const { activeProfileId } = useOneVidProfiles();
  // `null` = fetch in flight (show a skeleton reserving this row's space so
  // the section below it doesn't render first and then get pushed down once
  // this data arrives); `[]` = loaded, nothing to resume (hide the row).
  const [items, setItems] = useState<ContinueWatchingItem[] | null>(null);

  // Depende también de `language`: al cambiar idioma queremos re-pedir los
  // títulos ya localizados (el endpoint los traduce leyendo la cookie
  // NEXT_LOCALE, que el selector persiste antes del refresh). Sin esto, como es
  // un componente cliente, sus datos quedaban en el idioma anterior hasta un
  // recargado manual, aunque el catálogo (server) sí cambiaba.
  useEffect(() => {
    if (!activeProfileId) {
      setItems([]);
      return;
    }
    setItems(null);
    const controller = new AbortController();
    fetch("/api/onevid-progress", {
      headers: { "X-Profile-Id": activeProfileId },
      signal: controller.signal,
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ results: ContinueWatchingItem[] }>) : null))
      .then((data) => {
        setItems(data?.results ?? []);
      })
      .catch((error: unknown) => {
        // Un fetch cancelado (cleanup del efecto: cambio de perfil/idioma,
        // remount al entrar a la vista completa, o el doble-invoke de Strict
        // Mode en dev) no es "sin datos" — no toques el estado, que ya lo
        // resuelve la ejecución del efecto que sí sigue en pie. Si lo
        // tratábamos igual que un error real, se veía un parpadeo de "No
        // tienes nada para continuar viendo" antes de que llegaran los items.
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        /* no profile / offline — just don't show the row */
        setItems([]);
      });
    return () => controller.abort();
  }, [activeProfileId, language]);

  if (items === null) {
    return (
      <section className="container mx-auto flex flex-col gap-3 px-2">
        {!fullView && (
          <h2 className="px-1 font-semibold text-lg md:text-xl">
            {t("Continuar viendo")}
          </h2>
        )}
        <div className={HORIZONTAL_POSTER_GRID_CLASS}>
          {["a", "b", "c", "d", "e"].map((key) => (
            <div className="space-y-1" key={key}>
              <div className="aspect-video w-full animate-pulse rounded-(--radius) bg-muted/40" />
              <div className="mx-auto h-4 w-3/4 animate-pulse rounded bg-muted/40" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (items.length === 0) {
    if (fullView) {
      return (
        <section className="rounded-xl border bg-card p-8 text-center">
          <p className="text-muted-foreground text-sm">
            No tienes nada para continuar viendo.
          </p>
        </section>
      );
    }
    return null;
  }

  // Solo se muestra "Ver todo" cuando hay más de los que caben en una fila:
  // con pocos items no hay nada oculto que revelar.
  const hasOverflow = !fullView && items.length > FEED_ROW_ITEM_LIMIT;
  const visibleItems = fullView || !hasOverflow ? items : items.slice(0, FEED_ROW_ITEM_LIMIT);

  return (
    <section className="container mx-auto flex flex-col gap-3 px-2">
      {!fullView && (
        <div className="flex items-baseline justify-between gap-2 px-1">
          <h2 className="font-semibold text-lg md:text-xl">
            {t("Continuar viendo")}
          </h2>
          {hasOverflow && (
            <Link
              className={cn(
                buttonVariants({ size: "xs" }),
                "btn-primary shrink-0"
              )}
              data-dpad-focusable
              href="/home?view=continuing"
            >
              <ChevronRightIcon data-icon="inline-start" />
              {t("Ver todo")}
            </Link>
          )}
        </div>
      )}
      {/* Sin `data-dpad-poster-grid` propio: el ámbito lo pone el contenedor del
          feed (onevid-page-client.tsx) para que el mando pueda bajar de esta
          fila a las siguientes. */}
      <div className={HORIZONTAL_POSTER_GRID_CLASS}>
        {visibleItems.map((item) => {
          const pct =
            item.durationSec > 0
              ? Math.min(
                  100,
                  Math.round((item.positionSec / item.durationSec) * 100)
                )
              : 0;
          return (
            <PosterCard
              item={item}
              key={`${item.type}-${item.id}`}
              orientation="horizontal"
              progressPct={pct}
            />
          );
        })}
      </div>
    </section>
  );
}
