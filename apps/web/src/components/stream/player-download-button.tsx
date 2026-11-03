"use client";

import { CheckCircle2Icon, DownloadIcon, XIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CancellableConversion,
  deleteOfflineMediaFile,
  downloadMediaFile,
  getOfflineMediaExpiry,
  getOfflineMediaFile,
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
  | { status: "saved"; expiresAt: number | null }
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
    let active = true;
    void getOfflineMediaFile(storageKey)
      .then((file) => {
        if (active && file) {
          setState({
            status: "saved",
            expiresAt: getOfflineMediaExpiry(storageKey),
          });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          console.error("Could not inspect offline media:", error);
        }
      });
    return () => {
      active = false;
      mountedRef.current = false;
      // Al salir del player, cortar cualquier descarga en curso.
      if (abortedRef.current) {
        abortedRef.current.current = true;
      }
      void conversionRef.current?.cancel().catch(() => undefined);
    };
  }, [storageKey]);

  useEffect(() => {
    if (state.status !== "saved" || state.expiresAt === null) {
      return;
    }
    const remaining = state.expiresAt - Date.now();
    if (remaining <= 0) {
      void deleteOfflineMediaFile(storageKey).catch((error: unknown) => {
        console.error("Could not expire offline media:", error);
      });
      setState({ status: "idle" });
      return;
    }
    const timer = setTimeout(() => {
      void deleteOfflineMediaFile(storageKey)
        .catch((error: unknown) => {
          console.error("Could not expire offline media:", error);
        })
        .finally(() => setState({ status: "idle" }));
    }, remaining);
    return () => clearTimeout(timer);
  }, [state, storageKey]);

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
        setState({
          status: "saved",
          expiresAt: getOfflineMediaExpiry(storageKey),
        });
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

  if (state.status === "saved") {
    const expiresLabel = state.expiresAt
      ? new Intl.DateTimeFormat("es", {
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          month: "short",
        }).format(state.expiresAt)
      : "en 24 horas";
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-label="Guardado para ver sin conexión"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 shadow-[0_0_0_2px_rgba(16,185,129,0.2)] backdrop-blur-sm dark:bg-emerald-950 dark:text-emerald-300"
              disabled
              type="button"
            />
          }
        >
          <CheckCircle2Icon className="size-5" />
        </TooltipTrigger>
        <TooltipContent>Disponible sin conexión hasta {expiresLabel}</TooltipContent>
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
