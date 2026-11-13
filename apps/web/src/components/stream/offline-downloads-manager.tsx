"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  DownloadIcon,
  EllipsisVerticalIcon,
  FilmIcon,
  LoaderIcon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  deleteOfflineMediaFile,
  getOfflineRetentionDays,
  listOfflineMedia,
  OFFLINE_RETENTION_DAYS_OPTIONS,
  type OfflineMediaEntry,
  setOfflineRetentionDays,
} from "@/hooks/use-mediabunny";
import { useTranslation } from "@/lib/onevid-i18n-context";
import { tmdbImage } from "@/lib/tmdb";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${
    units[exponent]
  }`;
}

function playerHref(entry: OfflineMediaEntry): string | null {
  if (!(entry.contentType && entry.rawId)) {
    return null;
  }
  const params = new URLSearchParams({ title: entry.title });
  if (entry.poster) {
    params.set("poster", entry.poster);
  }
  return `/home/player/${entry.contentType}/${encodeURIComponent(
    entry.rawId
  )}?${params.toString()}`;
}

/**
 * Gestor de las pelis/episodios guardados sin conexión (OPFS). Vive dentro de
 * Configuración y lee los metadatos que `downloadMediaFile` escribe al guardar.
 */
export function OfflineDownloadsManager() {
  const { t: rawT, language } = useTranslation();
  const t = (key: string, options?: Record<string, unknown>) =>
    rawT(key as never, options as never) as unknown as string;
  const [entries, setEntries] = useState<OfflineMediaEntry[] | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // Clave pendiente de confirmación: borrar una copia no tiene vuelta atrás.
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [retentionDays, setRetentionDaysState] = useState(() =>
    getOfflineRetentionDays()
  );
  const [error, setError] = useState("");

  // Cambiar la retención reajusta las copias ya guardadas: al volver a cargar
  // se ven las fechas nuevas.
  function changeRetention(days: number) {
    setOfflineRetentionDays(days);
    setRetentionDaysState(days);
    void load();
  }

  const load = useCallback(async () => {
    try {
      const next = await listOfflineMedia();
      setEntries(next);
    } catch {
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete(storageKey: string) {
    setError("");
    setDeleting(storageKey);
    try {
      await deleteOfflineMediaFile(storageKey);
      setEntries((current) =>
        current ? current.filter((item) => item.storageKey !== storageKey) : current
      );
    } catch {
      setError(t("No se pudo eliminar la descarga."));
    } finally {
      setDeleting(null);
    }
  }

  if (entries === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
        <LoaderIcon className="size-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-md border p-3">
        <div className="flex flex-col gap-0.5">
          <p className="font-medium text-sm">{t("Conservar descargas")}</p>
          <p className="text-muted-foreground text-xs">
            {t(
              "Cuánto tiempo se guarda cada copia en este dispositivo antes de borrarse sola."
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {OFFLINE_RETENTION_DAYS_OPTIONS.map((days) => {
            const label = days === 1 ? t("1 día") : t("{{days}} días", { days });
            return (
              <Button
                aria-label={label}
                aria-pressed={retentionDays === days}
                data-dpad-focusable
                key={days}
                onClick={() => changeRetention(days)}
                size="xs"
                variant={retentionDays === days ? "default" : "outline"}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-8 text-center">
          <DownloadIcon className="size-6 text-muted-foreground" />
          <p className="text-sm">{t("No hay descargas sin conexión.")}</p>
          <p className="max-w-xs text-muted-foreground text-xs">
            {t("Películas y episodios guardados en este dispositivo.")}
          </p>
        </div>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">
            {t("Películas y episodios guardados en este dispositivo.")}
          </p>
          {entries.map((entry) => {
        const href = playerHref(entry);
        const poster = tmdbImage(entry.poster, "w185");
        const subtitle =
          entry.contentType === "series"
            ? entry.season && entry.episode
              ? t("Temporada {{season}} · Episodio {{episode}}", {
                  season: entry.season,
                  episode: entry.episode,
                })
              : t("Serie")
            : t("Película");
        return (
          <div
            className="flex items-center gap-3 rounded-md border p-2"
            key={entry.storageKey}
          >
            <div className="flex aspect-video w-24 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
              {poster ? (
                // biome-ignore lint/performance/noImgElement: póster externo de TMDB
                <img
                  alt=""
                  className="size-full object-cover"
                  loading="lazy"
                  src={poster}
                />
              ) : (
                <FilmIcon className="size-5 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{entry.title}</p>
              <p className="truncate text-muted-foreground text-xs">
                {subtitle} · {formatBytes(entry.bytes)}
              </p>
              {entry.expiresAt > 0 && (
                <p className="truncate text-muted-foreground text-xs">
                  {t("Guardado hasta {{date}}", {
                    date: new Intl.DateTimeFormat(language, {
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      month: "short",
                    }).format(entry.expiresAt),
                  })}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      aria-label={t("Opciones")}
                      data-dpad-focusable
                      size="icon-xs"
                      variant="ghost"
                    />
                  }
                >
                  <EllipsisVerticalIcon className="size-3 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {href && (
                    <DropdownMenuItem
                      render={<Link href={href} />}
                      data-dpad-focusable
                    >
                      <PlayIcon className="size-3" />
                      {t("Reproducir")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    data-dpad-focusable
                    disabled={deleting === entry.storageKey}
                    onClick={() => setConfirmKey(entry.storageKey)}
                    variant="destructive"
                  >
                    <Trash2Icon className="size-3" />
                    {t("Eliminar")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        );
      })}
        </>
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setConfirmKey(null);
          }
        }}
        open={confirmKey !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("¿Eliminar la descarga?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Se borrará la copia guardada en este dispositivo. Podrás volver a descargarla cuando quieras."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmKey(null)}>
              {t("Cancelar")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const key = confirmKey;
                setConfirmKey(null);
                if (key) {
                  void handleDelete(key);
                }
              }}
              variant="destructive"
            >
              {t("Eliminar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
