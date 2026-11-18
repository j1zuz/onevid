"use client";

import { useEffect, useState } from "react";

/**
 * ¿El navegador expone `MediaSource` (MSE)? Es el requisito del pipeline de
 * transcodificación de MediaBunny (`runProgressivePlayback` lanza si falta).
 *
 * Arranca en `null` (desconocido) y se resuelve tras montar para no romper la
 * hidratación, igual que `useIsTv`.
 *
 * Ojo: Safari en iPhone NO tiene `MediaSource` — solo `ManagedMediaSource`,
 * que MediaBunny no usa —, así que ahí el camino de transcodificación no puede
 * funcionar nunca y hay que caer al `<video>` nativo.
 */
export function useMediaSourceSupport(): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    setSupported(typeof MediaSource !== "undefined");
  }, []);
  return supported;
}
