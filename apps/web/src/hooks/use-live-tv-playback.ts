"use client";

import { useEffect, useState } from "react";
import {
  type LivePlaybackHandle,
  startLivePlayback,
} from "@/hooks/use-mediabunny";
import { probeLiveTvAudio } from "@/lib/live-tv-codec";

/** Máximo que esperamos el sondeo antes de reproducir con hls.js. */
const PROBE_TIMEOUT_MS = 8000;

export interface LiveTvPlayback {
  /**
   * `true` mientras se sondea el manifiesto (y, si hace falta, mientras arranca
   * el pipeline de MediaBunny). El player muestra el logo del canal.
   */
  probing: boolean;
  /**
   * `src` de MediaSource cuando el canal va por el pipeline de transcodificación
   * de audio. `null` significa "usa hls.js con la URL del canal".
   */
  src: string | null;
}

/**
 * Decide cómo reproducir un canal de Live TV.
 *
 * - Audio que el navegador ya decodifica (AAC, MP3, Opus…) → hls.js, como
 *   siempre (`src: null`).
 * - Audio que MSE rechaza pero MediaBunny sabe decodificar (AC-3/E-AC-3/DTS/
 *   TrueHD) → pipeline de MediaBunny, que transcodifica solo el audio a AAC y
 *   devuelve un `src` de MediaSource con vídeo+audio ya muxeado.
 * - Cualquier fallo del sondeo o del pipeline → vuelve a hls.js, nunca peor.
 */
export function useLiveTvPlayback(url: string | null): LiveTvPlayback {
  const [probing, setProbing] = useState(true);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    // Sin URL válida (HTTP, credenciales incrustadas, canal roto) no hay nada
    // que sondear: el player ya muestra su alerta.
    if (!url) {
      setProbing(false);
      setSrc(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    let handle: LivePlaybackHandle | null = null;
    // El sondeo lee el manifiesto (y a veces un segmento). Si el proveedor se
    // cuelga, no podemos dejar el canal en "cargando" para siempre: pasado el
    // plazo se reproduce con hls.js como hasta ahora.
    let timeout: ReturnType<typeof setTimeout> | null = null;

    setProbing(true);
    setSrc(null);

    void (async () => {
      const plan = await Promise.race([
        probeLiveTvAudio(url, controller.signal),
        new Promise<"native">((resolve) => {
          timeout = setTimeout(() => resolve("native"), PROBE_TIMEOUT_MS);
        }),
      ]);
      if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (cancelled) {
        return;
      }
      if (plan !== "transcode") {
        setProbing(false);
        return;
      }
      handle = startLivePlayback({
        url,
        onStart: (next) => {
          if (!cancelled) {
            setSrc(next);
            setProbing(false);
          }
        },
        onError: (error) => {
          if (cancelled) {
            return;
          }
          // Sin URL ni credenciales en el log: el mensaje de MediaBunny puede
          // llevar el origen.
          console.warn(
            "[live-tv] no se pudo transcodificar el audio; se usa hls.js:",
            error.name,
          );
          setSrc(null);
          setProbing(false);
        },
      });
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (timeout !== null) {
        clearTimeout(timeout);
      }
      handle?.cancel();
    };
  }, [url]);

  return { probing, src };
}
