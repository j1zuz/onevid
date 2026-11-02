"use client";

import { DownloadIcon, XIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CancellableConversion,
  downloadMediaFile,
} from "@/hooks/use-mediabunny";

interface PlayerDownloadButtonProps {
  /** URL de origen (puede ser un redirect de TorBox; se resuelve dentro). */
  url: string;
  /** Nombre del archivo de origen, para decidir si hace falta transcodificar. */
  filename: string;
  /** Clave estable para guardar el medio en el almacenamiento privado. */
  storageKey: string;
  /** Pista/hint de codec (título de la fuente) para la detección de compatibilidad. */
  codecHint?: string;
  onSaved?: () => void;
}

type DownloadState =
  | { status: "idle" }
  | { status: "downloading"; progress: number }
  | { status: "error" };

// Radio del anillo de progreso, igual que el spinner de transcodificación del
// player para que ambos se lean iguales.
const R = 10;
const C = 2 * Math.PI * R;

/**
 * Guarda una copia privada para reproducirla sin conexión. Nunca crea una
 * descarga visible ni expone el archivo al sistema.
 */
export function PlayerDownloadButton({
  url,
  filename,
  storageKey,
  codecHint = "",
  onSaved,
}: PlayerDownloadButtonProps) {
  const [state, setState] = useState<DownloadState>({ status: "idle" });
  const abortedRef = useRef<{ current: boolean } | null>(null);
  const conversionRef = useRef<CancellableConversion | null>(null);
  // Evita actualizar estado tras desmontar (la transcodificación es larga).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Al salir del player, cortar cualquier descarga en curso.
      if (abortedRef.current) {
        abortedRef.current.current = true;
      }
      void conversionRef.current?.cancel().catch(() => undefined);
    };
  }, []);

  const cancel = useCallback(() => {
    if (abortedRef.current) {
      abortedRef.current.current = true;
    }
    void conversionRef.current?.cancel().catch(() => undefined);
    setState({ status: "idle" });
  }, []);

  const start = useCallback(async () => {
    if (!url) {
      return;
    }
    const aborted = { current: false };
    abortedRef.current = aborted;
    conversionRef.current = null;
    setState({ status: "downloading", progress: 0 });
    try {
      // Devuelve "done" o "canceled"; en ambos casos se vuelve a idle sin mensaje.
      await downloadMediaFile({
        url,
        filename,
        storageKey,
        codecHint,
        abortedRef: aborted,
        conversionRef,
        onProgress: (progress) => {
          if (mountedRef.current && !aborted.current) {
            setState({ status: "downloading", progress });
          }
        },
      });
      if (mountedRef.current && !aborted.current) {
        setState({ status: "idle" });
        onSaved?.();
      }
    } catch {
      if (mountedRef.current && !aborted.current) {
        setState({ status: "error" });
        setTimeout(() => {
          if (mountedRef.current) {
            setState({ status: "idle" });
          }
        }, 4000);
      }
    }
  }, [url, filename, storageKey, codecHint, onSaved]);

  if (state.status === "downloading") {
    const offset = C - state.progress * C;
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-label="Cancelar guardado sin conexión"
              className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
              onClick={cancel}
              type="button"
            />
          }
        >
          <svg className="-rotate-90 absolute" height="30" viewBox="0 0 30 30" width="30">
          <title>Progreso de descarga</title>
          <circle
            cx="15"
            cy="15"
            fill="none"
            r={R}
            stroke="rgba(255,255,255,0.2)"
            strokeWidth="2.5"
          />
          <circle
            className="transition-all duration-300"
            cx="15"
            cy="15"
            fill="none"
            r={R}
            stroke="white"
            strokeDasharray={C}
            strokeDashoffset={offset}
            strokeLinecap="round"
            strokeWidth="2.5"
          />
        </svg>
          <XIcon className="size-4" />
        </TooltipTrigger>
        <TooltipContent>Cancelar guardado sin conexión</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label="Guardar para ver sin conexión"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
            onClick={start}
            type="button"
          />
        }
      >
        <DownloadIcon className="size-5" />
      </TooltipTrigger>
      <TooltipContent>Ver sin conexión</TooltipContent>
    </Tooltip>
  );
}
