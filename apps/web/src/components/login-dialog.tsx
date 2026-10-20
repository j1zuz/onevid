"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
import {
  ArrowLeftIcon,
  CheckIcon,
  CopyIcon,
  LoaderIcon,
  MonitorSmartphoneIcon,
  SplinePointer,
  TimerIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import {
  type DeviceCodeData,
  pollDeviceToken,
  requestDeviceCode,
} from "@/lib/tv-auth";

// Al autenticarse, entrar directo a la experiencia onevid. La sesión vive en la
// misma base de datos que hackw, así que también queda válida en hackw.tech.
const CALLBACK_URL = "/home";

// Cada cuánto rotamos el código (5 min) para que nunca se muestre uno a punto de expirar.
const REFRESH_SECONDS = 300;

/** "N72DAH3S" → "N72D-AH3S" para leerlo fácil. */
function formatUserCode(code: string): string {
  if (code.length <= 4) return code;
  const mid = Math.ceil(code.length / 2);
  return `${code.slice(0, mid)}-${code.slice(mid)}`;
}

/** Segundos → "m:ss". */
function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

type Step = "main" | "code";
type CodeStatus = "loading" | "waiting" | "approved" | "error";

export function LoginDialog() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("main");

  // ── Paso "main" ──────────────────────────────────────────────────────────────
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  async function handleGoogle() {
    setGoogleError(null);
    setGoogleLoading(true);
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: CALLBACK_URL,
        newUserCallbackURL: CALLBACK_URL,
      });
      // En éxito el navegador redirige a Google; el loader queda visible.
    } catch {
      setGoogleLoading(false);
      setGoogleError("No se pudo iniciar sesión con Google.");
    }
  }

  // ── Paso "code" (device login) ───────────────────────────────────────────────
  const [codeStatus, setCodeStatus] = useState<CodeStatus>("loading");
  const [codeData, setCodeData] = useState<DeviceCodeData | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(REFRESH_SECONDS);
  const [copied, setCopied] = useState(false);
  const runIdRef = useRef(0);
  const refreshAtRef = useRef(0);

  const startDeviceFlow = useCallback(async () => {
    const runId = ++runIdRef.current;
    setCodeStatus("loading");
    setCodeError(null);
    setCodeData(null);

    let code: DeviceCodeData;
    try {
      code = await requestDeviceCode();
    } catch (e) {
      if (runId !== runIdRef.current) return;
      setCodeError(e instanceof Error ? e.message : "No se pudo generar el código.");
      setCodeStatus("error");
      return;
    }
    if (runId !== runIdRef.current) return;

    setCodeData(code);
    setCodeStatus("waiting");
    refreshAtRef.current = Date.now() + REFRESH_SECONDS * 1000;
    setSecondsLeft(REFRESH_SECONDS);

    let intervalMs = Math.max(code.interval, 1) * 1000;
    const deadline = Date.now() + code.expires_in * 1000;

    const tick = async () => {
      if (runId !== runIdRef.current) return;
      if (Date.now() >= deadline) {
        setCodeError("El código expiró. Genera uno nuevo.");
        setCodeStatus("error");
        return;
      }
      const outcome = await pollDeviceToken(code.device_code);
      if (runId !== runIdRef.current) return;
      switch (outcome.kind) {
        case "approved":
          setCodeStatus("approved");
          // La cookie de sesión ya quedó seteada por pollDeviceToken antes de
          // retornar "approved", así que navegamos directo a /home.
          window.location.replace(CALLBACK_URL);
          return;
        case "pending":
          intervalMs += outcome.intervalDelta * 1000;
          break;
        case "denied":
          setCodeError("Rechazaste el acceso. Genera un código nuevo.");
          setCodeStatus("error");
          return;
        case "expired":
          setCodeError("El código expiró. Genera uno nuevo.");
          setCodeStatus("error");
          return;
        case "error":
          setCodeError(outcome.message);
          setCodeStatus("error");
          return;
      }
      window.setTimeout(tick, intervalMs);
    };
    window.setTimeout(tick, intervalMs);
  }, []);

  // Cuenta regresiva y rotación automática del código
  useEffect(() => {
    if (step !== "code" || codeStatus !== "waiting") return;
    const id = window.setInterval(() => {
      const left = Math.max(0, Math.round((refreshAtRef.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) startDeviceFlow();
    }, 1000);
    return () => window.clearInterval(id);
  }, [step, codeStatus, startDeviceFlow]);

  // Arrancar el flujo al entrar al paso "code"; cancelarlo al salir
  useEffect(() => {
    if (step === "code") {
      startDeviceFlow();
    } else {
      // Cortar polling si el usuario vuelve al paso main o cierra el dialog
      runIdRef.current++;
    }
  }, [step, startDeviceFlow]);

  // Reset completo al cerrar el dialog
  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setStep("main");
      setGoogleError(null);
      setGoogleLoading(false);
      runIdRef.current++;
    }
  }

  const copyCode = useCallback(async () => {
    if (!codeData) return;
    try {
      await navigator.clipboard.writeText(codeData.user_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* portapapeles bloqueado; el código sigue visible */
    }
  }, [codeData]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button className="btn-primary" translate="no" type="button">
            <SplinePointer data-icon="inline-start" />
            <span>Iniciar sesión</span>
          </Button>
        }
      />
      <DialogContent className="sm:max-w-sm">
        {/* ── Paso principal ── */}
        {step === "main" ? (
          <>
            <DialogHeader className="items-center gap-3 text-center sm:items-center sm:text-center">
              <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card">
                {/* biome-ignore lint/performance/noImgElement: logo SVG estático local */}
                <img alt="onevid" className="size-8" height={32} src="/onevid.svg" width={32} />
              </div>
              <div className="flex flex-col gap-1">
                <DialogTitle className="font-semibold text-base">Iniciar sesión</DialogTitle>
                <DialogDescription>
                  Continúa para iniciar sesión o crear una cuenta.
                </DialogDescription>
              </div>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              <Button
                className="w-full"
                disabled={googleLoading}
                onClick={handleGoogle}
                translate="no"
                type="button"
                variant="outline"
              >
                {googleLoading ? (
                  <LoaderIcon className="size-4 animate-spin" data-icon="inline-start" />
                ) : (
                  // biome-ignore lint/performance/noImgElement: ícono SVG estático local
                  <img
                    alt=""
                    className="size-4"
                    data-icon="inline-start"
                    height={16}
                    src="/google.svg"
                    width={16}
                  />
                )}
                <span>Continuar con Google</span>
              </Button>

              {googleError ? (
                <Alert className="w-full" variant="destructive">
                  <AlertTitle>No se pudo continuar</AlertTitle>
                  <AlertDescription>{googleError}</AlertDescription>
                </Alert>
              ) : null}

              {/* Separador "o" */}
              <div className="flex items-center gap-3 text-muted-foreground text-xs">
                <span className="h-px flex-1 bg-border" />
                <span>o</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              {/* Activar por código */}
              <Button
                className="w-full"
                onClick={() => setStep("code")}
                type="button"
                variant="ghost"
              >
                <MonitorSmartphoneIcon className="size-4" data-icon="inline-start" />
                <span>Activar por código</span>
              </Button>
            </div>
          </>
        ) : null}

        {/* ── Paso: generar código ── */}
        {step === "code" ? (
          <>
            <DialogHeader className="items-center gap-3 text-center sm:items-center sm:text-center">
              <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card">
                {/* biome-ignore lint/performance/noImgElement: logo SVG estático local */}
                <img alt="onevid" className="size-8" height={32} src="/onevid.svg" width={32} />
              </div>
              <div className="flex flex-col gap-1">
                <DialogTitle className="font-semibold text-base">Activar por código</DialogTitle>
                <DialogDescription>
                  Usa este código en otro dispositivo para iniciar sesión.
                </DialogDescription>
              </div>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              {/* Estado: cargando */}
              {codeStatus === "loading" ? (
                <div className="flex w-full items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-5">
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <Skeleton className="h-6 w-36 rounded-md" />
                  <Skeleton className="ml-auto size-4 rounded" />
                </div>
              ) : null}

              {/* Estado: código listo */}
              {codeStatus === "waiting" && codeData ? (
                <>
                  {/* Card del código — estilo similar al "Link sent!" de hackw */}
                  <button
                    className="flex w-full flex-col items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-5 text-left transition-colors hover:border-foreground/20 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={copyCode}
                    type="button"
                  >
                    <div className="flex w-full items-center gap-3">
                      {/* Ícono de estado */}
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        {copied
                          ? <CheckIcon className="size-4" />
                          : <MonitorSmartphoneIcon className="size-4" />
                        }
                      </span>
                      <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                        <span className="font-mono text-xl font-semibold tracking-[0.2em] text-foreground">
                          {formatUserCode(codeData.user_code)}
                        </span>
                      </div>
                      <CopyIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    </div>
                  </button>

                  {/* Cuenta regresiva */}
                  <div className="flex items-center justify-center gap-1.5 text-muted-foreground text-xs">
                    <TimerIcon className="size-3.5" />
                    <span>Nuevo código en {formatCountdown(secondsLeft)}</span>
                  </div>
                </>
              ) : null}

              {/* Estado: aprobado */}
              {codeStatus === "approved" ? (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <LoaderIcon className="size-4 animate-spin" />
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">¡Activado!</span>
                    <span className="text-xs text-muted-foreground">Entrando a tu cuenta…</span>
                  </div>
                </div>
              ) : null}

              {/* Estado: error */}
              {codeStatus === "error" ? (
                <div className="flex flex-col gap-3">
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-4">
                    <p className="text-center text-destructive text-sm">{codeError}</p>
                  </div>
                  <Button className="w-full" onClick={startDeviceFlow} type="button" variant="outline">
                    Generar código nuevo
                  </Button>
                </div>
              ) : null}

              {/* Volver */}
              <Button
                className="w-full"
                onClick={() => setStep("main")}
                type="button"
                variant="ghost"
              >
                <ArrowLeftIcon className="size-4" data-icon="inline-start" />
                <span>Volver</span>
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
