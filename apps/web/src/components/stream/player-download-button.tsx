"use client";

import { DownloadIcon, XIcon } from "lucide-react";
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
  /** Título del contenido, usado como nombre sugerido del archivo descargado. */
  title: string;
  /** Pista/hint de codec (título de la fuente) para la detección de compatibilidad. */
  codecHint?: string;
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
 * Botón de descarga en la barra superior del player. Para fuentes incompatibles
 * transcodifica a un MP4 compatible y lo guarda en el dispositivo; para fuentes
 * nativas baja el archivo original. Pensado para usuarios con mal internet: el
 * archivo queda completo y reproducible offline. Mientras baja, muestra el
 * progreso y actúa como botón de cancelar.
 */
export function PlayerDownloadButton({
  url,
  filename,
  title,
  codecHint = "",
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
        title,
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
  }, [url, filename, title, codecHint]);

  if (state.status === "downloading") {
    const offset = C - state.progress * C;
    return (
      <button
        aria-label="Cancelar descarga"
        className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
        onClick={cancel}
        type="button"
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
      </button>
    );
  }

  return (
    <button
      aria-label="Descargar"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
      onClick={start}
      type="button"
    >
      <DownloadIcon className="size-5" />
    </button>
  );
}
