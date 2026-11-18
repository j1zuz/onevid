"use client";

import { useSyncExternalStore } from 'react';
import {
  getActiveProfileSnapshot,
  subscribeProfileSnapshot,
  type Profile,
} from '@/lib/profiles';

/**
 * Perfil activo como estado reactivo (sin argumento, sincronizado con el
 * snapshot en memoria de `profiles.ts`).
 *
 * Lo usa el icono del tab "Perfil": al vivir dentro del propio icono, el avatar
 * se repinta aunque el navegador no vuelva a evaluar las `options` de la
 * pestaña, y sin depender de que el aviso de "perfil elegido" llegue después de
 * que exista el layout.
 */
export function useActiveProfile(): Profile | null {
  return useSyncExternalStore(
    subscribeProfileSnapshot,
    getActiveProfileSnapshot,
    getActiveProfileSnapshot,
  );
}
