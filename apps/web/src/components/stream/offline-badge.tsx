"use client";

import { WifiOffIcon } from "lucide-react";

/**
 * Chip "Sin conexión" para indicar que lo que se está viendo sale del archivo
 * guardado en OPFS (o que la página es la del offline).
 *
 * Vive en un solo sitio para que el reproductor del catálogo y la página
 * /offline/play lo pinten exactamente igual.
 */
export function OfflineBadge({ label }: { label: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-black/50 px-2 py-1 text-[0.7rem] text-white backdrop-blur-sm">
      <WifiOffIcon className="size-3" />
      {label}
    </span>
  );
}
