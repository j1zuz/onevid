"use client";

import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  ArrowLeftIcon,
  DownloadIcon,
  FilmIcon,
  PlayIcon,
  WifiOffIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  getOfflineStorageUsage,
  listOfflineMedia,
  type OfflineMediaEntry,
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

/**
 * Biblioteca sin conexión de la PWA.
 *
 * No toca el servidor: lista los archivos que ya están en OPFS y enlaza al
 * reproductor local `/offline/play`. El service worker precachea esta página
 * (y su shell de JS) para que abra aunque no haya internet.
 */
export default function OfflinePage() {
  const { t: rawT, language } = useTranslation();
  const t = (key: string, options?: Record<string, unknown>) =>
    rawT(key as never, options as never) as unknown as string;
  const [entries, setEntries] = useState<OfflineMediaEntry[] | null>(null);
  const [usage, setUsage] = useState(0);
  const [online, setOnline] = useState(true);

  const load = useCallback(async () => {
    try {
      const [next, storage] = await Promise.all([
        listOfflineMedia(),
        getOfflineStorageUsage(),
      ]);
      setEntries(next);
      setUsage(storage.usage);
    } catch {
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [load]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-1 flex-col border-border border-x border-dashed bg-background px-4 pb-10 md:px-6">
      <section className="sticky top-0 z-10 flex items-center gap-3 border-border border-b border-dashed bg-background/95 py-3 backdrop-blur">
        <a
          aria-label={t("Volver al inicio")}
          className="rounded border border-transparent p-1"
          data-glimm-skip
          href="/home"
        >
          {/* biome-ignore lint/performance/noImgElement: icono estático local */}
          <img
            alt="onevid"
            className="size-8 rounded-md border border-border/70 bg-card p-1"
            height={32}
            src="/onevid-pwa-512.png"
            width={32}
          />
        </a>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold text-base">
            {t("Descargas sin conexión")}
          </h1>
          <p className="flex items-center gap-1 text-muted-foreground text-xs">
            {online ? null : <WifiOffIcon className="size-3" />}
            {online ? t("En línea") : t("Sin conexión")}
            {usage > 0 ? ` · ${formatBytes(usage)}` : ""}
          </p>
        </div>
        <a
          className="flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs"
          data-glimm-skip
          href="/home"
        >
          <ArrowLeftIcon className="size-3.5" />
          {t("Inicio")}
        </a>
      </section>

      {entries === null ? (
        <div aria-busy="true" className="mt-4" role="status">
          <span className="sr-only">{t("Cargando descargas…")}</span>
          <ul className="flex flex-col gap-2">
            {Array.from({ length: 4 }, (_, index) => (
              <li
                className="flex items-center gap-3 rounded-lg border p-2"
                key={`offline-skeleton-${index}`}
              >
                <Skeleton className="aspect-video w-24 shrink-0 rounded" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="size-9 shrink-0 rounded-full" />
              </li>
            ))}
          </ul>
        </div>
      ) : entries.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center">
          <DownloadIcon className="size-6 text-muted-foreground" />
          <p className="text-sm">{t("No hay descargas sin conexión.")}</p>
          <p className="max-w-xs text-muted-foreground text-xs">
            {t(
              "Guarda películas o episodios desde el reproductor para verlos cuando te quedes sin internet."
            )}
          </p>
          <a
            className="mt-2 rounded-full bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs"
            data-glimm-skip
            href="/home"
          >
            {t("Ver catálogo")}
          </a>
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {entries.map((entry) => {
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
              <li key={entry.storageKey}>
                <a
                  className="flex items-center gap-3 rounded-lg border p-2 transition-colors hover:bg-muted"
                  data-glimm-skip
                  href={`/offline/play?key=${encodeURIComponent(entry.storageKey)}`}
                >
                  <div className="relative flex aspect-video w-24 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                    <FilmIcon className="size-5 text-muted-foreground" />
                    {poster ? (
                      // biome-ignore lint/performance/noImgElement: póster externo de TMDB
                      <img
                        alt=""
                        className="absolute inset-0 size-full object-cover"
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                        src={poster}
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{entry.title}</p>
                    <p className="truncate text-muted-foreground text-xs">
                      {subtitle} · {formatBytes(entry.bytes)}
                    </p>
                    {entry.expiresAt > 0 ? (
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
                    ) : null}
                  </div>
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <PlayIcon className="size-4" />
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
