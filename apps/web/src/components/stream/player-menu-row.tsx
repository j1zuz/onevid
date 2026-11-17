"use client";

import { ChevronIcon } from "@videojs/react/icons";
import { LoaderIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Fila del menú de ajustes del player para una acción nuestra (audio/subs,
 * episodios, descarga, fuentes, ver juntos).
 *
 * Usa las clases del propio skin (`media-menu-trigger-item`), así hereda alto,
 * padding, radio, tipografía y estados de foco sin duplicarlos; el icono entra
 * a 16 px, el mismo tamaño que los del menú nativo.
 */
export function PlayerMenuRow({
  busy = false,
  label,
  icon,
  onClick,
  state,
}: {
  /** Acción en curso: se pinta un spinner a la derecha. */
  busy?: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  /** Texto secundario a la derecha (p. ej. el % de descarga). */
  state?: string;
}) {
  return (
    <button
      className="media-menu-trigger-item flex w-full items-center justify-between gap-1.5"
      onClick={onClick}
      type="button"
    >
      {/* Mismo hueco icono→texto y mismo cajón de icono que las filas nativas
          del skin (gap: 1.5 × spacing, icono de 4.5 × spacing). */}
      <span className="flex items-center gap-[calc(var(--media-spacing)*1.5)]">
        <span className="flex size-[calc(var(--media-spacing)*4.5)] shrink-0 items-center justify-center">
          {icon}
        </span>
        <span>{label}</span>
      </span>
      {busy ? (
        <LoaderIcon className="size-3.5 shrink-0 animate-spin opacity-80" />
      ) : state ? (
        <span className="text-white/60 text-xs tabular-nums">{state}</span>
      ) : (
        <ChevronIcon className="media-menu-forward-chevron size-3.5 shrink-0 opacity-60" />
      )}
    </button>
  );
}

/** Separador fino entre las opciones del skin y las nuestras. */
export function PlayerMenuRowGroup({ children }: { children: ReactNode }) {
  return (
    <div className="mt-[calc(var(--media-spacing)*0.5)] flex flex-col border-white/10 border-t pt-[calc(var(--media-spacing)*0.5)]">
      {children}
    </div>
  );
}
