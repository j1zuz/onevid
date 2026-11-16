"use client";

import { createPlayer, videoFeatures } from "@videojs/react";
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
import "@videojs/react/video/skin.css";
import "@/components/stream/video-js-player-overrides.css";

// Mismo player que el del catálogo (skin y features), creado una sola vez.
const { Player } = createPlayer({ features: videoFeatures });

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
  const { t: rawT } = useTranslation();
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

  useEffect(() => {
    let active = true;
    let timeoutId: number | undefined;
    setSrc(null);
    setError("");

    const metadata = key ? getOfflineMediaMetadata(key) : null;
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
          <Player key={src}>
            <VideoSkin>
              <Video
                autoPlay
                className="size-full bg-black object-contain"
                onError={() =>
                  setError(t("No se pudo reproducir la descarga."))
                }
                playsInline
                preload="auto"
                src={src}
              />
            </VideoSkin>
          </Player>
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
