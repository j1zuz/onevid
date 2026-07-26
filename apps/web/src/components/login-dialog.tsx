"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
import { LoaderIcon, SplinePointer } from "lucide-react";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

// Al autenticarse, entrar directo a la experiencia onevid. La sesión vive en la
// misma base de datos que hackw, así que también queda válida en hackw.tech.
const CALLBACK_URL = "/home";

export function LoginDialog() {
  const [error, setError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleGoogle() {
    setError(null);
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
      setError("No se pudo iniciar sesión con Google.");
    }
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setError(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            className="btn-primary"
            translate="no"
            type="button"
          >
            <SplinePointer data-icon="inline-start" />
            <span>Iniciar sesión</span>
          </Button>
        }
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="items-center gap-3 text-center sm:items-center sm:text-center">
          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card">
            {/* biome-ignore lint/performance/noImgElement: logo SVG estático local */}
            <img alt="onevid" className="size-8" height={32} src="/onevid.svg" width={32} />
          </div>
          <div className="flex flex-col gap-1">
            <DialogTitle className="font-semibold text-base">
              Iniciar sesión
            </DialogTitle>
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

          {error ? (
            <Alert className="w-full" variant="destructive">
              <AlertTitle>No se pudo continuar</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
