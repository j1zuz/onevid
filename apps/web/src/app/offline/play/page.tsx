"use client";

import { createPlayer, videoFeatures } from "@videojs/react";
import { Video, VideoSkin } from "@videojs/react/video";
import { ArrowLeftIcon, LoaderIcon, WifiOffIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  getOfflineMediaFile,
  getOfflineMediaMetadata,
} from "@/hooks/use-mediabunny";
import { useTranslation } from "@/lib/onevid-i18n-context";
import "@videojs/react/video/skin.css";
import "@/components/stream/video-js-player-overrides.css";

// Mismo player que el del catálogo (skin y features), creado una sola vez.
const { Player } = createPlayer({ features: videoFeatures });

/**
 * Reproductor local de una descarga sin conexión.
 *
 * No usa el player del catálogo (que necesita red para pedir fuentes): toma el
 * archivo de OPFS y lo reproduce con un blob URL. El service worker precachea
 * esta página, así el enlace de /offline funciona sin internet.
 */
function OfflinePlayer() {
  const { t: rawT } = useTranslation();
  const t = useCallback(
    (key: string) => rawT(key as never) as unknown as string,
    [rawT]
  );
  const searchParams = useSearchParams();
  const key = searchParams.get("key") ?? "";
  const [src, setSrc] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setSrc(null);
    setError("");

    const metadata = key ? getOfflineMediaMetadata(key) : null;
    if (metadata?.title) {
      setTitle(metadata.title);
    }

    if (!key) {
      setError(t("No se indicó qué descarga reproducir."));
      return;
    }

    getOfflineMediaFile(key)
      .then((file) => {
        if (!active) {
          return;
        }
        if (!file) {
          setError(t("La descarga ya no está en este dispositivo."));
          return;
        }
        const url = URL.createObjectURL(file);
        urlRef.current = url;
        setSrc(url);
      })
      .catch(() => {
        if (active) {
          setError(t("No se pudo abrir la descarga."));
        }
      });

    return () => {
      active = false;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [key, t]);

  return (
    <main className="fixed inset-0 flex flex-col bg-black text-white">
      <header className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-gradient-to-b from-black/80 to-transparent px-3 py-3">
        <a
          aria-label={t("Volver a las descargas")}
          className="flex size-8 items-center justify-center rounded-full bg-black/50"
          data-glimm-skip
          href="/offline"
        >
          <ArrowLeftIcon className="size-4" />
        </a>
        <p className="min-w-0 flex-1 truncate text-sm">{title}</p>
        <span className="flex items-center gap-1 rounded-full bg-black/50 px-2 py-1 text-[0.65rem]">
          <WifiOffIcon className="size-3" />
          {t("Sin conexión")}
        </span>
      </header>

      {src ? (
        // Mismo skin del reproductor del catálogo (Video.js), pero sobre el blob
        // local y sin resolver fuentes: así los controles se sienten igual que
        // los del player normal. No usa `stream-video-player-root` para no
        // heredar los overrides del player de streaming (ahí el botón de play se
        // oculta porque hay gesto de tap).
        <div className="player-offline-root absolute inset-0">
          <Player key={src}>
            <VideoSkin>
              <Video
                autoPlay
                className="size-full bg-black object-contain"
                onError={() => setError(t("No se pudo reproducir la descarga."))}
                playsInline
                preload="auto"
                src={src}
              />
            </VideoSkin>
          </Player>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          {error ? (
            <>
              <p className="text-sm">{error}</p>
              <a
                className="rounded-full bg-white px-3 py-1.5 font-medium text-black text-xs"
                data-glimm-skip
                href="/offline"
              >
                {t("Volver a las descargas")}
              </a>
            </>
          ) : (
            <>
              <LoaderIcon className="size-5 animate-spin text-white/70" />
              <p className="text-sm text-white/70">
                {t("Abriendo descarga…")}
              </p>
            </>
          )}
        </div>
      )}
    </main>
  );
}

export default function OfflinePlayPage() {
  return (
    <Suspense fallback={null}>
      <OfflinePlayer />
    </Suspense>
  );
}
