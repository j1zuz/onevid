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
  /**
   * Fuerza una revalidación inmediata (sin depender de un cambio de foco de
   * ruta). Necesario cuando el cambio de modo ocurre en la MISMA pantalla que
   * lee `useAppSurface` (p. ej. "Continuar sin cuenta" en StreamLoginScreen,
   * que vive dentro de /home: un router.replace('/home') ahí es un no-op de
   * navegación y no dispara useFocusEffect).
   */
  refresh: () => void;
}

/**
 * Combina sesión + modo, revalidando en CADA focus del tab (para reaccionar a
 * login/logout y a cambios de modo sin remontar). Devuelve null mientras carga.
 */
export function useAppSurface(): AppSurface | null {
  const [surface, setSurface] = useState<AppSurface | null>(null);

  const load = useCallback(() => {
    Promise.all([getAccessToken(), loadAppMode()]).then(([token, mode]) => {
      const authed = Boolean(token);
      // En TV no hay sesión implícita en modo local (a diferencia de móvil):
      // por defecto se pide login, pero el usuario puede elegir "Continuar
      // sin cuenta" en la pantalla de QR, que persiste mode: 'local'.
      const showLocal = Platform.isTV
        ? mode === 'local'
        : !authed || mode === 'local';
      setSurface({ authed, mode, showLocal, refresh: load });
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return surface;
}
