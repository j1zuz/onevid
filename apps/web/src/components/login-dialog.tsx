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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Separator } from "@workspace/ui/components/separator";
import { CircleCheckIcon, LoaderIcon, Sparkles } from "lucide-react";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

// Al autenticarse, entrar directo a la experiencia onevid. La sesión vive en la
// misma base de datos que hackw, así que también queda válida en hackw.tech.
const CALLBACK_URL = "/home";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginDialog() {
  const [email, setEmail] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!emailPattern.test(trimmed)) {
      setError("Introduce un correo electrónico válido");
      return;
    }
    setError(null);
    setLoading(true);
    const { error: sendError } = await authClient.signIn.magicLink({
      email: trimmed,
      callbackURL: CALLBACK_URL,
      newUserCallbackURL: CALLBACK_URL,
    });
    setLoading(false);
    if (sendError) {
      setError("No se pudo enviar el enlace. Inténtalo de nuevo.");
      return;
    }
    setLinkSent(true);
  }

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
          setLinkSent(false);
          setError(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button translate="no" type="button">
            <Sparkles data-icon="inline-start" />
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
              Ingresa tu correo electrónico para iniciar sesión o crear una
              cuenta.
            </DialogDescription>
          </div>
        </DialogHeader>

        {linkSent ? (
          <DialogFooter className="mt-2 flex-col gap-0 border-border border-t pt-4 sm:flex-col sm:justify-stretch">
            <Alert className="[&>svg]:!text-green-600 dark:[&>svg]:!text-green-500 w-full border-primary/25 bg-primary/5">
              <CircleCheckIcon />
              <AlertTitle>¡Enlace enviado!</AlertTitle>
              <AlertDescription>
                Te enviamos un enlace de inicio de sesión a tu correo
                electrónico.
              </AlertDescription>
            </Alert>
          </DialogFooter>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={handleMagicLink}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Correo Electrónico</Label>
              <Input
                autoComplete="email"
                id="email"
                name="email"
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Ingresa tu correo electrónico"
                type="email"
                value={email}
              />
            </div>

            <Button
              className="btn-primary w-full"
              disabled={loading}
              translate="no"
              type="submit"
            >
              {loading ? (
                <LoaderIcon className="size-4 animate-spin" data-icon="inline-start" />
              ) : (
                <Sparkles data-icon="inline-start" />
              )}
              <span>{loading ? "Enviando…" : "Enviar enlace"}</span>
            </Button>

            {error ? (
              <Alert className="w-full" variant="destructive">
                <AlertTitle>No se pudo enviar el enlace</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-muted-foreground text-xs">o</span>
              <Separator className="flex-1" />
            </div>

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
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
