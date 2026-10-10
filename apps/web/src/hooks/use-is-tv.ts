"use client";

import { useEffect, useState } from "react";
import { isTvUserAgent } from "@/lib/tv";

/**
 * ¿El cliente es una TV? Versión para componentes cliente (el server usa
 * `isTvUserAgent` directo con el header). Arranca en `false` y se resuelve tras
 * montar para no romper la hidratación; en la práctica queda fijado antes de que
 * el usuario elija fuente o pulse Reproducir. `?tv=1` fuerza el modo para probar
 * en el navegador de escritorio.
 */
export function useIsTv(): boolean {
  const [isTv, setIsTv] = useState(false);
  useEffect(() => {
    const forced =
      new URLSearchParams(window.location.search).get("tv") === "1";
    setIsTv(isTvUserAgent(navigator.userAgent) || forced);
  }, []);
  return isTv;
}
