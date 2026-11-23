"use client";

import { Button } from "@workspace/ui/components/button";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * Puerta de sesión del chat de la watch party.
 *
 * El QR de la TV abre esta ruta en el móvil, así que el usuario puede llegar
 * sin sesión. En vez de mandarlo a la landing (donde perdería la sala), se
 * inicia sesión aquí mismo y Google devuelve a esta misma URL.
 */
export function WatchChatSignIn({ roomTitle }: { roomTitle: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogle() {
    setError(null);
    setLoading(true);
    try {
      const url = window.location.href;
      await authClient.signIn.social({
        provider: "google",
        callbackURL: url,
        newUserCallbackURL: url,
      });
    } catch {
      setLoading(false);
      setError("No se pudo iniciar sesión con Google.");
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <p className="text-muted-foreground text-sm">Ver juntos</p>
      <h1 className="max-w-sm font-semibold text-xl">{roomTitle}</h1>
      <p className="max-w-xs text-muted-foreground text-sm">
        Inicia sesión para entrar al chat de la sala. La película se sigue viendo
        en la TV.
      </p>
      <Button
        className="btn-primary mt-2"
        disabled={loading}
        onClick={() => void handleGoogle()}
        size="lg"
      >
        {loading ? "Entrando…" : "Continuar con Google"}
      </Button>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </main>
  );
}
