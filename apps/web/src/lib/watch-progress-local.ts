"use client";

import { readActiveProfileId } from "@/lib/active-profile";

/**
 * Copia local del progreso de visionado.
 *
 * El servidor sigue siendo la fuente de verdad ("Continuar viendo" entre
 * dispositivos). Esto solo existe para la reproducción de descargas: la
 * biblioteca `/offline/play` abre sin red, así que no puede preguntar la
 * posición guardada y antes empezaba siempre en el segundo 0. El reproductor
 * del catálogo también deja aquí un espejo de lo que va guardando, de modo que
 * una descarga abierta sin conexión retoma donde se quedó el usuario.
 *
 * Se clave por perfil + título + temporada/episodio, igual que el servidor. En
 * un dispositivo sin perfil activo se usa "anon" (las descargas ya son del
 * dispositivo, no de la cuenta).
 */
const STORAGE_PREFIX = "onevid:watch-progress:v1";
// Debajo de esto no hay nada que retomar: son arranques accidentales.
const MIN_SEC = 10;
// Si queda menos que esto para el final se considera terminado y se borra,
// para no reabrir la descarga en los créditos.
const END_MARGIN_SEC = 30;

export interface LocalWatchProgress {
  durationSec: number;
  positionSec: number;
  updatedAt: number;
}

function storageKey(
  mediaType: string,
  mediaId: string,
  season = 0,
  episode = 0
): string {
  const profileId = readActiveProfileId() ?? "anon";
  return `${STORAGE_PREFIX}:${profileId}:${mediaType}:${mediaId}:${season}:${episode}`;
}

export function readLocalProgress(
  mediaType: string,
  mediaId: string,
  season = 0,
  episode = 0
): LocalWatchProgress | null {
  if (typeof localStorage === "undefined" || !mediaId) {
    return null;
  }
  try {
    const raw = localStorage.getItem(storageKey(mediaType, mediaId, season, episode));
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const value = parsed as Partial<LocalWatchProgress>;
    if (
      typeof value.positionSec !== "number" ||
      typeof value.durationSec !== "number" ||
      !Number.isFinite(value.positionSec) ||
      !Number.isFinite(value.durationSec) ||
      value.positionSec < MIN_SEC
    ) {
      return null;
    }
    return {
      durationSec: value.durationSec,
      positionSec: value.positionSec,
      updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export function clearLocalProgress(
  mediaType: string,
  mediaId: string,
  season = 0,
  episode = 0
): void {
  if (typeof localStorage === "undefined" || !mediaId) {
    return;
  }
  try {
    localStorage.removeItem(storageKey(mediaType, mediaId, season, episode));
  } catch {
    /* almacenamiento lleno o bloqueado: no es crítico */
  }
}

/**
 * Guarda la posición actual. Con el título terminado (o a falta de menos de
 * `END_MARGIN_SEC`) borra la entrada en vez de dejar un punto de reanudación
 * pegado al final.
 */
export function writeLocalProgress(
  mediaType: string,
  mediaId: string,
  season: number,
  episode: number,
  positionSec: number,
  durationSec: number
): void {
  if (typeof localStorage === "undefined" || !mediaId) {
    return;
  }
  if (!Number.isFinite(positionSec) || positionSec < MIN_SEC) {
    return;
  }
  const duration = Number.isFinite(durationSec) ? durationSec : 0;
  if (duration > 0 && positionSec >= duration - END_MARGIN_SEC) {
    clearLocalProgress(mediaType, mediaId, season, episode);
    return;
  }
  try {
    localStorage.setItem(
      storageKey(mediaType, mediaId, season, episode),
      JSON.stringify({
        durationSec: duration,
        positionSec,
        updatedAt: Date.now(),
      } satisfies LocalWatchProgress)
    );
  } catch {
    /* almacenamiento lleno o bloqueado: no es crítico */
  }
}
