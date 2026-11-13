"use client";

import { CheckCircle2Icon, DownloadIcon } from "lucide-react";
import posthog from "posthog-js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type CancellableConversion,
  deleteOfflineMediaFile,
  downloadMediaFile,
  getOfflineMediaExpiry,
  getOfflineMediaFile,
  type OfflineMediaInfo,
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
  /**
   * Título/póster/destino del medio, para que el gestor de descargas de
   * Configuración pueda pintarlo y enlazar de vuelta al reproductor.
   */
  metadata?: OfflineMediaInfo;
  /**
   * Índice 0-based de la pista de audio activa en el player. Solo aplica cuando
   * hay que transcodificar: el archivo offline conserva ese idioma y descarta
   * los demás.
   */
  audioTrackIndex?: number;
  onSaved?: () => void;
}

type DownloadState =
  | { status: "idle" }
  | { status: "preparing"; progress: number | null }
  | { status: "downloading"; progress: number }
  | { status: "saved"; expiresAt: number | null }
  | { status: "error" };

// Misma caja y mismo grosor de trazo que los iconos de lucide (viewBox 24,
// `size-5`): el anillo dibuja 2..22 y trazo 2.5, así se ve al mismo tamaño y
// con el mismo peso que el icono de capas que va al lado en cualquier layout.
const R = 9.5;
const C = 2 * Math.PI * R;
const ICON_VIEW_BOX = "0 0 24 24";
const RING_STROKE = 2.5;
const CROSS_PATH = "M8 8 L16 16 M16 8 L8 16";

/** Mensaje de error sin URLs ni tokens: solo para diagnóstico. */
function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return raw
    .replace(/https?:\/\/\S+/gi, "<url>")
    .replace(/[?&](token|key|sig|expires|exp)=[^\s&]+/gi, "$1=<redacted>")
    .slice(0, 180);
}

/**
 * Traduce el fallo de una descarga a un motivo estable (para analítica) y a un
 * mensaje entendible. Nunca se manda la URL del medio: lleva el token del debrid.
 */
function classifyDownloadError(error: unknown): {
  reason: string;
  message: string;
  status?: number;
} {
  const name = error instanceof Error ? error.name : "unknown";
  const raw = error instanceof Error ? error.message : "";
  const match = raw.match(/HTTP (\d{3})/);
  const status = match ? Number(match[1]) : undefined;

  if (
    name === "QuotaExceededError" ||
    raw.includes("QuotaExceeded") ||
    /espacio suficiente/i.test(raw)
  ) {
    return {
      reason: "quota",
      message:
        "No hay espacio suficiente en este dispositivo. Elimina otra descarga o libera espacio y vuelve a intentarlo.",
    };
  }
  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      reason: "permission",
      message: "El navegador no permite guardar descargas en este dispositivo.",
    };
  }
  if (raw.includes("mixed-content")) {
    return {
      reason: "mixed-content",
      message:
        "La fuente usa HTTP y el navegador la bloquea en una página HTTPS.",
    };
  }
  if (raw.includes("preparando")) {
    return {
      reason: "debrid-preparing",
      message:
        "El debrid todavía está preparando el archivo. Prueba en unos minutos.",
    };
  }
  if (raw.includes("cortó")) {
    return {
      reason: "truncated",
      message: "La descarga se cortó antes de terminar. Inténtalo otra vez.",
    };
  }
  if (/archivo de origen/i.test(raw)) {
    return {
      reason: "source-empty",
      message:
        "El origen no devolvió datos. Prueba con otra fuente o inténtalo más tarde.",
    };
  }
  if (status && status >= 400) {
    return {
      reason: `http-${status}`,
      message: `El servidor del video respondió ${status}. Prueba con otra fuente.`,
      status,
    };
  }
  if (name === "TypeError" || /failed to fetch|networkerror/i.test(raw)) {
    return {
      reason: "network-or-cors",
      message:
        "No se pudo conectar con el servidor del video (red, CORS o contenido mixto).",
    };
  }
  return {
    reason: "unknown",
    message: "No se pudo guardar el video sin conexión. Inténtalo otra vez.",
  };
}

/** Tiempo restante legible: "45 s", "3 min 10 s", "23 h 40 min", "5 d 2 h". */function formatRemaining(ms: number): string | null {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 1) {
    return null;
  }
  if (totalSeconds < 60) {
    return `${totalSeconds} s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) {
    return restMinutes > 0 ? `${hours} h ${restMinutes} min` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days} d ${restHours} h` : `${days} d`;
}

/**
 * Guarda una copia privada para reproducirla sin conexión. Nunca crea una
 * descarga visible ni expone el archivo al sistema.
 */
export function PlayerDownloadButton({
  url,
  filename,
  storageKey,
  codecHint = "",
  metadata,
  audioTrackIndex,
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
          try {
            posthog.capture("offline_media_error", {
              error_name: error instanceof Error ? error.name : "unknown",
              stage: "inspect",
            });
          } catch {
            // La analítica nunca debe romper la reproducción.
          }
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
        try {
          posthog.capture("offline_media_error", {
            error_name: error instanceof Error ? error.name : "unknown",
            stage: "expire",
          });
        } catch {
          // La analítica nunca debe romper la reproducción.
        }
      });
      setState({ status: "idle" });
      return;
    }
    const timer = setTimeout(() => {
      void deleteOfflineMediaFile(storageKey)
        .catch((error: unknown) => {
          try {
            posthog.capture("offline_media_error", {
              error_name: error instanceof Error ? error.name : "unknown",
              stage: "expire",
            });
          } catch {
            // La analítica nunca debe romper la reproducción.
          }
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
        metadata,
        audioTrackIndex,
        abortedRef: aborted,
        conversionRef,
        // El debrid todavía no tiene el archivo: se avisa en vez de dejar una
        // barra de progreso congelada en 0 %.
        onPreparing: (progress) => {
          if (mountedRef.current && !aborted.current) {
            setState({ status: "preparing", progress });
          }
        },
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
    } catch (error) {
      if (mountedRef.current && !aborted.current) {
        const failure = classifyDownloadError(error);
        // Sin esto la descarga fallida volvía al icono sin explicar nada y sin
        // rastro en analítica: imposible saber si fue cuota, CORS o el debrid.
        const storage =
          failure.reason === "quota" && navigator.storage?.estimate
            ? await navigator.storage.estimate().catch(() => null)
            : null;
        try {
          posthog.capture("offline_media_error", {
            stage: "download",
            reason: failure.reason,
            error_name: error instanceof Error ? error.name : "unknown",
            error_message: safeErrorMessage(error),
            ...(failure.status ? { http_status: failure.status } : {}),
            ...(storage
              ? {
                  quota_gb: Number(((storage.quota ?? 0) / 1e9).toFixed(2)),
                  usage_gb: Number(((storage.usage ?? 0) / 1e9).toFixed(2)),
                }
              : {}),
          });
        } catch {
          // La analítica nunca debe romper la reproducción.
        }
        toast.error(failure.message);
        setState({ status: "error" });
        setTimeout(() => {
          if (mountedRef.current) {
            setState({ status: "idle" });
          }
        }, 4000);
      }
    }
  }, [url, filename, storageKey, codecHint, metadata, audioTrackIndex, onSaved]);

  if (state.status === "preparing") {
    const label =
      state.progress !== null && state.progress > 0
        ? `Preparando en debrid… ${Math.round(state.progress * 100)} %`
        : "Preparando en debrid…";
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-label="Cancelar preparación en debrid"
              className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
              onClick={cancel}
              type="button"
            />
          }
        >
          <svg
            aria-hidden="true"
            className="absolute size-5 animate-spin"
            viewBox={ICON_VIEW_BOX}
          >
            <circle
              cx="12"
              cy="12"
              fill="none"
              r={R}
              stroke="rgba(255,255,255,0.45)"
              strokeWidth={RING_STROKE}
            />
            <circle
              cx="12"
              cy="12"
              fill="none"
              r={R}
              stroke="white"
              strokeDasharray={`${C * 0.25} ${C}`}
              strokeLinecap="round"
              strokeWidth={RING_STROKE}
            />
          </svg>
          {/* X en su propio SVG para que no gire con el anillo. */}
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 m-auto size-5"
            viewBox={ICON_VIEW_BOX}
          >
            <path
              d={CROSS_PATH}
              stroke="white"
              strokeLinecap="round"
              strokeWidth="2"
            />
          </svg>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  }

  if (state.status === "downloading") {
    const percent = Math.round(state.progress * 100);
    const offset = C - state.progress * C;
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-label={`Cancelar guardado sin conexión (${percent}%)`}
              className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
              onClick={cancel}
              type="button"
            />
          }
        >
          <svg
            aria-hidden="true"
            className="-rotate-90 size-5"
            viewBox={ICON_VIEW_BOX}
          >
            <circle
              cx="12"
              cy="12"
              fill="none"
              r={R}
              stroke="rgba(255,255,255,0.45)"
              strokeWidth={RING_STROKE}
            />
            <circle
              className="transition-all duration-300"
              cx="12"
              cy="12"
              fill="none"
              r={R}
              stroke="white"
              strokeDasharray={C}
              strokeDashoffset={offset}
              strokeLinecap="round"
              strokeWidth={RING_STROKE}
            />
            {/* El porcentaje ya lo muestra el tooltip; dentro del anillo solo la X. */}
            <path
              d={CROSS_PATH}
              stroke="white"
              strokeLinecap="round"
              strokeWidth="2"
            />
          </svg>
        </TooltipTrigger>
        <TooltipContent>
          Cancelar guardado sin conexión · {percent}%
        </TooltipContent>
      </Tooltip>
    );
  }

  if (state.status === "saved") {
    // Lo que importa aquí no es la fecha exacta sino cuánto le queda de las 24 h
    // de retención.
    const remaining = state.expiresAt
      ? formatRemaining(state.expiresAt - Date.now())
      : null;
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-disabled="true"
              aria-label={
                remaining
                  ? `Guardado para ver sin conexión, le quedan ${remaining}`
                  : "Guardado para ver sin conexión"
              }
              className="flex size-9 shrink-0 cursor-default items-center justify-center rounded-full bg-emerald-50 text-emerald-700 shadow-[0_0_0_2px_rgba(16,185,129,0.2)] backdrop-blur-sm dark:bg-emerald-950 dark:text-emerald-300"
              type="button"
            />
          }
        >
          <CheckCircle2Icon className="size-5" />
        </TooltipTrigger>
        <TooltipContent>
          Disponible sin conexión
          {remaining ? ` · le quedan ${remaining}` : ""}
        </TooltipContent>
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
