"use client";

import { buttonVariants } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import {
  HORIZONTAL_POSTER_GRID_CLASS,
  PosterCard,
} from "@/components/stream/poster-card";
import type { FeedSection } from "@/lib/onevid-feed-sections";
import { useTranslation } from "@/lib/onevid-i18n-context";

// Definido junto a `resolveFeed`, que es quien las produce. Se re-exporta aquí
// porque los consumidores de este componente ya lo importaban de este módulo.
export type { FeedSection };

/**
 * Una fila del feed de inicio. El título y los items ya vienen resueltos desde
 * el Server Component (`/home`), así que aquí no hay fetch.
 *
 * Ojo: NO lleva `data-dpad-poster-grid`. Ese atributo se pone una sola vez en el
 * contenedor del feed (onevid-page-client.tsx) para que todas las filas formen
 * un único ámbito geométrico; si cada fila tuviera el suyo, el mando de TV no
 * podría bajar de una fila a la siguiente (ver findNextFocusable en
 * dpad-navigation.tsx, que devuelve null al no encontrar candidato dentro del
 * mismo grid).
 */
export function FeedRow({ section }: { section: FeedSection }) {
  const { t: rawT } = useTranslation();
  const t = (key: string) => rawT(key as never);

  return (
    <section className="container mx-auto flex flex-col gap-3 px-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 className="font-semibold text-lg md:text-xl">{section.title}</h2>
        {/* Un `<a>` no debe renderizarse a través del `render` de Button (Base
            UI le exige semántica de botón nativo); se estilan las clases del
            botón directamente sobre el Link, como ya hace el trigger del
            engranaje en onevid-header.tsx. */}
        <Link
          className={cn(buttonVariants({ size: "xs" }), "btn-primary shrink-0")}
          data-dpad-focusable
          href={section.href}
        >
          <ChevronRightIcon data-icon="inline-start" />
          {t("Ver todo")}
        </Link>
      </div>
      <div className={HORIZONTAL_POSTER_GRID_CLASS}>
        {section.items.map((item) => (
          <PosterCard
            item={item}
            key={`${item.type}-${item.id}`}
            orientation="horizontal"
          />
        ))}
      </div>
    </section>
  );
}
