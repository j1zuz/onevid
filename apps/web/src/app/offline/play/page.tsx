"use client";

import { createPlayer, I18nProvider, registerI18n, videoFeatures } from "@videojs/react";
import deLocale from "@videojs/react/i18n/locales/de";
import enLocale from "@videojs/react/i18n/locales/en";
import esLocale from "@videojs/react/i18n/locales/es";
import frLocale from "@videojs/react/i18n/locales/fr";
import hiLocale from "@videojs/react/i18n/locales/hi";
import idLocale from "@videojs/react/i18n/locales/id";
import itLocale from "@videojs/react/i18n/locales/it";
import jaLocale from "@videojs/react/i18n/locales/ja";
import koLocale from "@videojs/react/i18n/locales/ko";
import nlLocale from "@videojs/react/i18n/locales/nl";
import ptLocale from "@videojs/react/i18n/locales/pt";
import ruLocale from "@videojs/react/i18n/locales/ru";
import trLocale from "@videojs/react/i18n/locales/tr";
import { Video, VideoSkin } from "@videojs/react/video";
import { ArrowLeftIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  getOfflineMediaFile,
  getOfflineMediaMetadata,
} from "@/hooks/use-mediabunny";
import { OfflineBadge } from "@/components/stream/offline-badge";
import { useTranslation } from "@/lib/onevid-i18n-context";
import {
  readLocalProgress,
  writeLocalProgress,
} from "@/lib/watch-progress-local";
import "@videojs/react/video/skin.css";
import "@/components/stream/video-js-player-overrides.css";

// Mismo player que el del catálogo (skin y features), creado una sola vez.
const { Player } = createPlayer({ features: videoFeatures });

// Textos del skin en el idioma del usuario: su i18n es propio.
for (const [locale, pack] of [
  ["de", deLocale],
  ["en", enLocale],
  ["es", esLocale],
  ["fr", frLocale],
  ["hi", hiLocale],
  ["id", idLocale],
  ["it", itLocale],
  ["ja", jaLocale],
  ["ko", koLocale],
  ["nl", nlLocale],
  ["pt", ptLocale],
  ["ru", ruLocale],
  ["tr", trLocale],
] as const) {
  registerI18n(locale, pack);
}

// Si el archivo no abre en este tiempo, se muestra el error en vez de dejar el
// spinner para siempre (OPFS puede quedarse colgado si la cuota está revuelta o
// si el handler desapareció entre navegaciones).
const OPEN_TIMEOUT_MS = 10_000;

/**
 * Reproductor local de una descarga sin conexión.
 *
 * No usa el player del catálogo (que necesita red para pedir fuentes): toma el
 * archivo de OPFS y lo reproduce con un blob URL, pero con el mismo skin de
 * Video.js para que los controles se sientan iguales. El service worker
 * precachea esta página (y sus chunks), así el enlace de /offline funciona sin
 * internet.
 */
function OfflinePlayer() {
  const { language, t: rawT } = useTranslation();
  const t = useCallback(
    (key: string) => rawT(key as never) as unknown as string,
    [rawT]
  );
  // `t` no debe reiniciar el efecto de carga (si cambia de identidad, se
  // cancelaba la promesa en curso y la página se quedaba en "Abriendo…").
  const translate = useRef(t);
  useEffect(() => {
    translate.current = t;
  }, [t]);

  const searchParams = useSearchParams();
  const key = searchParams.get("key") ?? "";
  const [src, setSrc] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [poster, setPoster] = useState("");
  const [background, setBackground] = useState("");
  const [logo, setLogo] = useState("");
  const [error, setError] = useState("");
  const urlRef = useRef<string | null>(null);
  // Progreso local: la página abre sin red, así que no puede pedirle la
  // posición al servidor. Se reanuda con el espejo local que dejó el player
  // (o una sesión anterior de esta misma página) y se sigue guardando aquí.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const infoRef = useRef<{
    contentType?: "movie" | "series";
    contentId?: string;
    episode?: number;
    season?: number;
  } | null>(null);
  const resumeRef = useRef<number | null>(null);
  const lastSavedRef = useRef(0);
  // Última posición conocida: al desmontar, el <video> ya puede haberse ido y
  // sin esto el guardado de salida escribiría 0.
  const latestRef = useRef({ duration: 0, position: 0 });

  const saveProgress = useCallback(() => {
    const video = videoRef.current;
    const info = infoRef.current;
    if (!(info?.contentType && info.contentId)) {
      return;
    }
    const { duration, position } = video
      ? { duration: video.duration, position: video.currentTime }
      : latestRef.current;
    writeLocalProgress(
      info.contentType,
      info.contentId,
      info.season ?? 0,
      info.episode ?? 0,
      position,
      duration
    );
  }, []);

  // Al ocultar la pestaña o salir se guarda el último segundo visto, igual que
  // hace el reproductor del catálogo con el servidor.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        saveProgress();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", saveProgress);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", saveProgress);
      saveProgress();
    };
  }, [saveProgress]);

  useEffect(() => {
    let active = true;
    let timeoutId: number | undefined;
    setSrc(null);
    setError("");

    const metadata = key ? getOfflineMediaMetadata(key) : null;
    infoRef.current = metadata
      ? {
          contentType: metadata.contentType,
          contentId: metadata.contentId,
          episode: metadata.episode,
          season: metadata.season,
        }
      : null;
    resumeRef.current = null;
    lastSavedRef.current = 0;
    latestRef.current = { duration: 0, position: 0 };
    if (metadata?.contentType && metadata.contentId) {
      const local = readLocalProgress(
        metadata.contentType,
        metadata.contentId,
        metadata.season ?? 0,
        metadata.episode ?? 0
      );
      resumeRef.current = local?.positionSec ?? null;
    }
    if (metadata?.title) {
      setTitle(metadata.title);
    }
    if (metadata?.poster) {
      setPoster(metadata.poster);
    }
    if (metadata?.background) {
      setBackground(metadata.background);
    }
    if (metadata?.logo) {
      setLogo(metadata.logo);
    }

    if (!key) {
      setError(translate.current("No se indicó qué descarga reproducir."));
      return;
    }

    timeoutId = window.setTimeout(() => {
      if (active) {
        setError(translate.current("La descarga tardó demasiado en abrirse."));
      }
    }, OPEN_TIMEOUT_MS);

    getOfflineMediaFile(key)
      .then((file) => {
        if (!active) {
          return;
        }
        window.clearTimeout(timeoutId);
        if (!file) {
          setError(
            translate.current("La descarga ya no está en este dispositivo.")
          );
          return;
        }
        const url = URL.createObjectURL(file);
        urlRef.current = url;
        setSrc(url);
      })
      .catch(() => {
        if (active) {
          window.clearTimeout(timeoutId);
          setError(translate.current("No se pudo abrir la descarga."));
        }
      });

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [key]);

  return (
    <main className="fixed inset-0 flex flex-col bg-black text-white">
      <header className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-3 py-3">
        {/* Mismo botón de volver que la barra del player del catálogo:
            círculo de 36 px, fondo blanco al 10% y el mismo `ArrowLeft`. */}
        <a
          aria-label={t("Volver a las descargas")}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
          data-glimm-skip
          href="/offline"
        >
          <ArrowLeftIcon className="size-5" />
        </a>
        <p className="min-w-0 flex-1 truncate font-medium text-base text-white">
          {title}
        </p>
        <OfflineBadge label={t("Sin conexión")} />
      </header>

      {src ? (
        // Mismo skin del reproductor del catálogo (Video.js), pero sobre el blob
        // local y sin resolver fuentes. No usa `stream-video-player-root` para
        // no heredar los overrides del player de streaming (ahí el botón de play
        // se oculta porque hay gesto de tap).
        <div className="player-offline-root absolute inset-0">
          <I18nProvider locale={(language || "es").split("-")[0]}>
          <Player key={src}>
            <VideoSkin>
              <Video
                autoPlay
                className="size-full bg-black object-contain"
                onEnded={saveProgress}
                onError={() =>
                  setError(t("No se pudo reproducir la descarga."))
                }
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget;
                  const target = resumeRef.current;
                  // Retoma donde se quedó el usuario. Si el punto guardado ya
                  // está en el final (o fuera del archivo) se empieza normal.
                  if (
                    target !== null &&
                    target > 10 &&
                    (!Number.isFinite(video.duration) ||
                      target < video.duration - 5)
                  ) {
                    video.currentTime = target;
                  }
                }}
                onPause={saveProgress}
                onTimeUpdate={() => {
                  const video = videoRef.current;
                  if (video) {
                    latestRef.current = {
                      duration: video.duration,
                      position: video.currentTime,
                    };
                  }
                  const now = Date.now();
                  if (now - lastSavedRef.current < 5000) {
                    return;
                  }
                  lastSavedRef.current = now;
                  saveProgress();
                }}
                playsInline
                preload="auto"
                ref={videoRef}
                src={src}
              />
            </VideoSkin>
          </Player>
          </I18nProvider>
        </div>
      ) : (
        <div className="relative flex flex-1 flex-col items-center justify-center px-6 text-center">
          {error ? (
            <>
              <p className="text-sm">{error}</p>
              <a
                className="mt-4 rounded-full bg-white px-3 py-1.5 font-medium text-black text-xs"
                data-glimm-skip
                href="/offline"
              >
                {t("Volver a las descargas")}
              </a>
            </>
          ) : (
            <>
              {/* Pantalla de carga igual que la del player del catálogo: fondo
                  del título (o el póster) con velo oscuro y el logo pulsante.
                  Sin spinner ni texto: mientras dura, ya se sabe qué se abrió. */}
              {background || poster ? (
                <img
                  alt=""
                  aria-hidden
                  className="absolute inset-0 size-full object-cover opacity-60"
                  src={background || poster}
                />
              ) : null}
              <div aria-hidden className="absolute inset-0 bg-black/45" />
              {logo ? (
                <img
                  alt=""
                  className="relative z-10 max-h-[26vh] w-auto max-w-[62vw] animate-pulse object-contain motion-reduce:animate-none"
                  src={logo}
                />
              ) : (
                <p className="relative z-10 max-w-[80vw] animate-pulse truncate font-medium text-lg text-white motion-reduce:animate-none">
                  {title}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </main>
  );
}

export default function OfflinePlayPage() {
  // `useSearchParams` obliga a un límite de Suspense en Next.
  return (
    <Suspense fallback={null}>
      <OfflinePlayer />
    </Suspense>
  );
}
