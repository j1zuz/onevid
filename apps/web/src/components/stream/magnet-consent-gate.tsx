"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "@/lib/onevid-i18n-context";

/**
 * Puerta de consentimiento para enlaces magnet pegados en la URL.
 *
 * Abrir un magnet hace que el servidor cree un torrent en la cuenta de TorBox
 * del usuario. Si el reproductor se montara al cargar la pagina, un enlace
 * enviado por un tercero dispararia esa accion sin que la victima lo pidiera.
 * Montar el player solo tras un clic convierte la accion en un gesto explicito.
 */
export function MagnetConsentGate({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  const { t } = useTranslation();
  const [confirmed, setConfirmed] = useState(false);

  if (confirmed) {
    return <>{children}</>;
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold break-words text-card-foreground">
          {title}
        </h1>
        <button
          className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground transition-opacity hover:opacity-90"
          onClick={() => setConfirmed(true)}
          type="button"
        >
          {t("Reproducir magnet")}
        </button>
      </div>
    </main>
  );
}
