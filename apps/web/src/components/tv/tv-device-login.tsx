"use client";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  CheckIcon,
  CopyIcon,
  LoaderIcon,
  RefreshCwIcon,
  TimerIcon,
} from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DeviceCodeData,
  pollDeviceToken,
  requestDeviceCode,
} from "@/lib/tv-auth";

// Pantalla de login para TV: muestra un código que el usuario aprueba desde el
// teléfono en /device, mientras la TV hace polling. Al aprobarse,
// pollDeviceToken deja la cookie de sesión y mandamos a /home.

type Status = "loading" | "waiting" | "approved" | "error";

// Cada cuánto se regenera el código. El server lo deja vivo 15 min, pero lo
// rotamos antes (5 min) para que nunca se muestre uno a punto de expirar.
const REFRESH_SECONDS = 300;

/** "N72DAH3S" → "N72D-AH3S" para leerlo fácil desde el sofá. */
function formatUserCode(code: string): string {
  if (code.length <= 4) {
    return code;
  }
  const mid = Math.ceil(code.length / 2);
  return `${code.slice(0, mid)}-${code.slice(mid)}`;
}

/** Host legible de la URL de verificación (sin esquema), para mostrarlo grande. */
function displayUri(uri: string): string {
  try {
    const url = new URL(uri);
    return `${url.host}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return uri;
  }
}

/** Segundos → "m:ss". */
function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function TvDeviceLogin() {
  const [status, setStatus] = useState<Status>("loading");
  const [data, setData] = useState<DeviceCodeData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(REFRESH_SECONDS);
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  // Un solo ciclo de polling vivo a la vez: el ref corta el anterior al reiniciar
  // o desmontar, para que dos bucles no compitan por el mismo device_code.
  const runIdRef = useRef(0);
  // Momento (epoch ms) en que toca rotar el código; lo lee la cuenta regresiva.
  const refreshAtRef = useRef(0);

  const start = useCallback(async () => {
    const runId = ++runIdRef.current;
    setStatus("loading");
    setErrorMessage(null);
    setData(null);

    let code: DeviceCodeData;
    try {
      code = await requestDeviceCode();
    } catch (e) {
      if (runId !== runIdRef.current) {
        return;
      }
      setErrorMessage(
        e instanceof Error ? e.message : "No se pudo generar el código."
      );
      setStatus("error");
      return;
    }
    if (runId !== runIdRef.current) {
      return;
    }
    setData(code);
    setStatus("waiting");
    refreshAtRef.current = Date.now() + REFRESH_SECONDS * 1000;
    setSecondsLeft(REFRESH_SECONDS);

    let intervalMs = Math.max(code.interval, 1) * 1000;
    const deadline = Date.now() + code.expires_in * 1000;

    const tick = async () => {
      if (runId !== runIdRef.current) {
        return;
      }
      if (Date.now() >= deadline) {
        setErrorMessage("El código expiró. Genera uno nuevo.");
        setStatus("error");
        return;
      }
      const outcome = await pollDeviceToken(code.device_code);
      if (runId !== runIdRef.current) {
        return;
      }
      switch (outcome.kind) {
        case "approved":
          setStatus("approved");
          // Cookie de sesión ya puesta por pollDeviceToken → entra al catálogo.
          window.location.replace("/home");
          return;
        case "pending":
          intervalMs += outcome.intervalDelta * 1000;
          break;
        case "denied":
          setErrorMessage("Rechazaste el acceso. Genera un código nuevo.");
          setStatus("error");
          return;
        case "expired":
          setErrorMessage("El código expiró. Genera uno nuevo.");
          setStatus("error");
          return;
        case "error":
          setErrorMessage(outcome.message);
          setStatus("error");
          return;
      }
      window.setTimeout(tick, intervalMs);
    };

    window.setTimeout(tick, intervalMs);
  }, []);

  useEffect(() => {
    start();
    return () => {
      // Corta el polling en curso al desmontar.
      runIdRef.current++;
    };
  }, [start]);

  // Cuenta regresiva del badge: cada segundo recalcula lo que falta para rotar
  // el código y, al llegar a 0, pide uno nuevo.
  useEffect(() => {
    if (status !== "waiting") {
      return;
    }
    const id = window.setInterval(() => {
      const left = Math.max(
        0,
        Math.round((refreshAtRef.current - Date.now()) / 1000)
      );
      setSecondsLeft(left);
      if (left <= 0) {
        start();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [status, start]);

  // QR de la URL de verificación CON el código incluido
  // (`verification_uri_complete`): al escanearlo con el teléfono, lleva directo a
  // /device con el código ya puesto, sin teclear nada.
  useEffect(() => {
    if (!data) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    const target = data.verification_uri_complete || data.verification_uri;
    QRCode.toDataURL(target, { margin: 1, width: 240 })
      .then((url) => {
        if (!cancelled) {
          setQrDataUrl(url);
        }
      })
      .catch(() => {
        // Si el QR falla, la pantalla sigue mostrando la URL y el código.
        if (!cancelled) {
          setQrDataUrl(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [data]);

  const copyCode = useCallback(async () => {
    if (!data) {
      return;
    }
    try {
      await navigator.clipboard.writeText(data.user_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* el portapapeles puede estar bloqueado; el código sigue visible */
    }
  }, [data]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 bg-background px-6 py-12 text-center">
      <div className="flex flex-col items-center gap-2">
        {/* biome-ignore lint/performance/noImgElement: logo SVG estático local */}
        <img
          alt="onevid"
          className="size-12 rounded-md border border-border/70 bg-card p-1.5"
          height={48}
          src="/onevid.svg"
          width={48}
        />
        <span className="font-semibold text-xl">onevid</span>
      </div>

      {status === "loading" ? (
        <div className="flex flex-col items-center gap-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="size-[200px] rounded-2xl" />
          <Skeleton className="h-5 w-72" />
          <Skeleton className="h-20 w-64 rounded-2xl" />
          <Skeleton className="h-7 w-44 rounded-full" />
        </div>
      ) : null}

      {status === "waiting" && data ? (
        <div className="flex flex-col items-center gap-6">
          <h1 className="font-semibold text-2xl text-foreground">
            Inicia sesión
          </h1>
          {qrDataUrl ? (
            <div className="rounded-2xl border border-border bg-white p-3">
              {/* biome-ignore lint/performance/noImgElement: QR data URI local */}
              <img
                alt="Código QR para iniciar sesión"
                className="size-44"
                height={176}
                src={qrDataUrl}
                width={176}
              />
            </div>
          ) : (
            <Skeleton className="size-[200px] rounded-2xl" />
          )}
          <div className="max-w-xl space-y-1 text-balance text-muted-foreground">
            <p>Escanea el código QR con tu teléfono.</p>
            <p>
              O entra en{" "}
              <span className="font-semibold text-foreground">
                {displayUri(data.verification_uri)}
              </span>{" "}
              e ingresa el código:
            </p>
          </div>
          <button
            className="group flex flex-col items-center gap-2 rounded-2xl border border-border bg-card px-10 py-6 transition-colors hover:border-primary focus-visible:border-primary focus-visible:outline-none"
            data-dpad-focusable
            onClick={copyCode}
            type="button"
          >
            <span className="font-mono text-4xl tracking-[0.3em] text-foreground">
              {formatUserCode(data.user_code)}
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground text-sm">
              {copied ? (
                <>
                  <CheckIcon className="size-4 text-primary" />
                  ¡Copiado!
                </>
              ) : (
                <>
                  <CopyIcon className="size-4" />
                  Copiar código
                </>
              )}
            </span>
          </button>
          <Badge className="gap-1.5 px-3 py-1 text-sm" variant="secondary">
            <TimerIcon className="size-4" />
            Nuevo código en {formatCountdown(secondsLeft)}
          </Badge>
        </div>
      ) : null}

      {status === "approved" ? (
        <div className="flex items-center gap-3 text-muted-foreground">
          <LoaderIcon className="size-6 animate-spin" />
          <span className="text-lg">Entrando…</span>
        </div>
      ) : null}

      {status === "error" ? (
        <div className="flex flex-col items-center gap-5">
          <p className="max-w-md text-balance text-destructive text-lg">
            {errorMessage}
          </p>
          <Button
            className="btn-primary"
            data-dpad-focusable
            onClick={start}
            type="button"
          >
            <RefreshCwIcon data-icon="inline-start" />
            Generar código nuevo
          </Button>
        </div>
      ) : null}
    </main>
  );
}
