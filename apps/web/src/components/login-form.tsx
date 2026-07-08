"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Separator } from "@workspace/ui/components/separator";
import { CircleCheckIcon, LoaderIcon, Sparkles } from "lucide-react";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

// Tras autenticarse, llevar directo a la experiencia onevid. La sesión se
// guarda en la misma base de datos que hackw, así que también queda válida en
// hackw.tech (cookie compartida en producción vía COOKIE_DOMAIN).
const CALLBACK_URL = "/home/projects/onevid";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginForm() {
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
    <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        {/* biome-ignore lint/performance/noImgElement: logo SVG estático local */}
        <img alt="onevid" className="size-10" height={40} src="/onevid.svg" width={40} />
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-base">Iniciar sesión en onevid</h1>
          <p className="text-muted-foreground text-sm">
            Ingresa tu correo para iniciar sesión o crear una cuenta.
          </p>
        </div>
      </div>

      {linkSent ? (
        <Alert className="border-primary/25 bg-primary/5">
          <CircleCheckIcon />
          <AlertTitle>¡Enlace enviado!</AlertTitle>
          <AlertDescription>
            Te enviamos un enlace de inicio de sesión a tu correo.
          </AlertDescription>
        </Alert>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={handleMagicLink}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Correo electrónico</Label>
            <Input
              autoComplete="email"
              id="email"
              name="email"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              type="email"
              value={email}
            />
          </div>

          <Button
            className="w-full"
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
            <Alert variant="destructive">
              <AlertTitle>No se pudo continuar</AlertTitle>
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
            ) : null}
            <span>Continuar con Google</span>
          </Button>
        </form>
      )}
    </div>
  );
}
