"use client";

import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@workspace/ui/lib/utils";

/**
 * Vista previa a pantalla completa de una imagen del chat (la que se envía como
 * archivo o GIF). Va en un portal a `document.body` para escapar del scroll y
 * del apilado del panel de la watch party.
 *
 * - Clic fuera o Esc: cerrar.
 * - Clic en la imagen: alterna zoom 1× / 2×, igual que el visor del chat.
 * - Bloquea el scroll del documento mientras está abierta.
 */
export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt?: string;
  onClose: () => void;
}) {
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      aria-label={alt ?? "Imagen"}
      aria-modal="true"
      className="fixed inset-0 z-100 flex items-center justify-center overflow-auto bg-black/90 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
    >
      <button
        aria-label="Cerrar"
        className="fixed top-4 right-4 z-10 flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        onClick={onClose}
        type="button"
      >
        <XIcon className="size-5" />
      </button>
      {/* biome-ignore lint/performance/noImgElement: imagen remota del chat */}
      <img
        alt={alt ?? ""}
        className={cn(
          "max-h-full max-w-full rounded-lg object-contain transition-transform duration-200",
          zoomed ? "scale-200 cursor-zoom-out" : "cursor-zoom-in"
        )}
        onClick={(event) => {
          event.stopPropagation();
          setZoomed((value) => !value);
        }}
        src={src}
      />
    </div>,
    document.body
  );
}
