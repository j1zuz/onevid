"use client";

import Link from "next/link";
import { Loader } from "lucide-react";
import { Button, buttonVariants } from "@workspace/ui/components/button";
import { useTranslation } from "@/lib/onevid-i18n-context";

export interface MagnetGateError {
  action: string;
  href: string;
  message: string;
}

/**
 * Pantalla previa a reproducir un magnet.
 *
 * Abrir un magnet hace que el servidor cree un torrent en la cuenta debrid del
 * usuario. Si el reproductor se montara al cargar la página, un enlace enviado
 * por un tercero dispararía esa acción sin que la víctima lo pidiera. Montar el
 * player solo tras un clic convierte la acción en un gesto explícito.
 *
 * Mientras el player resuelve el torrent, este mismo cartel se queda encima con
 * el botón en estado de carga: antes el player se montaba al instante y la
 * pantalla quedaba negra varios segundos, sin ninguna señal de que algo estaba
 * pasando.
 */
export function MagnetConsentGate({
  error,
  loading = false,
  onConfirm,
  title,
}: {
  error?: MagnetGateError | null;
  /** El player ya está montado y todavía no tiene imagen. */
  loading?: boolean;
  onConfirm?: () => void;
  title: string;
}) {
  const { t } = useTranslation();

  return (
    <main className="fixed inset-0 z-50 flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold break-words text-card-foreground">
          {title}
        </h1>
        {error ? (
          <div className="mt-4 flex flex-col gap-4">
            <p className="text-destructive text-sm">{error.message}</p>
            <Link
              className={buttonVariants({ className: "btn-primary w-full" })}
              href={error.href}
            >
              {error.action}
            </Link>
          </div>
        ) : (
          <Button
            className="btn-primary mt-5 w-full"
            disabled={loading}
            onClick={onConfirm}
            type="button"
          >
            {loading ? <Loader className="size-4 animate-spin" /> : null}
            {t("Reproducir magnet")}
          </Button>
        )}
      </div>
    </main>
  );
}
