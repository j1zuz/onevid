import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { type AppMode, loadAppMode } from '@/lib/app-mode';
import { getAccessToken } from '@/lib/auth';

export interface AppSurface {
  authed: boolean;
  mode: AppMode;
  /**
   * true → mostrar la experiencia local (Reproducir video / empty states de los
   * tabs de catálogo). false → experiencia stream (catálogo). Sin sesión siempre
   * es local; con sesión depende del modo elegido.
   */
  showLocal: boolean;
}

/**
 * Combina sesión + modo, revalidando en CADA focus del tab (para reaccionar a
 * login/logout y a cambios de modo sin remontar). Devuelve null mientras carga.
 */
export function useAppSurface(): AppSurface | null {
  const [surface, setSurface] = useState<AppSurface | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([getAccessToken(), loadAppMode()]).then(([token, mode]) => {
        if (cancelled) return;
        const authed = Boolean(token);
        // En Android TV no hay modo local (el selector de galería no aplica): la
        // app es siempre stream (catálogo / login).
        const showLocal = Platform.isTV ? false : !authed || mode === 'local';
        setSurface({ authed, mode, showLocal });
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );
  return surface;
}
