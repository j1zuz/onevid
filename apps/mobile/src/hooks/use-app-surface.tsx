import { useFocusEffect } from 'expo-router';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
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

type SurfaceData = Omit<AppSurface, 'refresh'>;

function computeSurface(authed: boolean, mode: AppMode): SurfaceData {
  // En TV no hay sesión implícita en modo local (a diferencia de móvil): por
  // defecto se pide login, pero el usuario puede elegir "Continuar sin cuenta"
  // en la pantalla de QR, que persiste mode: 'local'.
  const showLocal = Platform.isTV ? mode === 'local' : !authed || mode === 'local';
  return { authed, mode, showLocal };
}

const AppSurfaceContext = createContext<AppSurface | null>(null);

/**
 * Sembrado desde `_layout.tsx` con lo ya resuelto al boot (validateSession +
 * loadAppMode), montado por encima de todo el Stack. Así, cuando el usuario
 * entra a un tab por primera vez (los tabs montan perezosamente), el valor ya
 * está disponible y no hay un frame en blanco mientras se relee SecureStore.
 */
export function AppSurfaceProvider({
  initial,
  children,
}: {
  initial: { authed: boolean; mode: AppMode } | null;
  children: ReactNode;
}) {
  const [state, setState] = useState<SurfaceData | null>(
    initial ? computeSurface(initial.authed, initial.mode) : null,
  );

  const refresh = useCallback(() => {
    Promise.all([getAccessToken(), loadAppMode()]).then(([token, mode]) => {
      setState(computeSurface(Boolean(token), mode));
    });
  }, []);

  const value = useMemo<AppSurface | null>(
    () => (state ? { ...state, refresh } : null),
    [state, refresh],
  );

  return (
    <AppSurfaceContext.Provider value={value}>
      {children}
    </AppSurfaceContext.Provider>
  );
}

/**
 * Combina sesión + modo. Revalida en CADA focus del tab (para reaccionar a
 * login/logout y a cambios de modo sin remontar), pero la lectura real de
 * SecureStore vive una sola vez en `AppSurfaceProvider`: cada tab solo dispara
 * esa revalidación compartida, no una propia. Devuelve null solo si se llama
 * fuera de `AppSurfaceProvider`.
 */
export function useAppSurface(): AppSurface | null {
  const surface = useContext(AppSurfaceContext);

  useFocusEffect(
    useCallback(() => {
      surface?.refresh();
      // Deps intencionalmente solo `refresh` (no `surface` completo): `refresh`
      // es estable, así que el efecto solo corre en transiciones reales de foco.
      // Si dependiera de `surface`, cada refresh() generaría un objeto nuevo →
      // el callback cambiaría de identidad → useFocusEffect lo re-dispararía de
      // inmediato (sigue "focused") → bucle infinito de refetch.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [surface?.refresh]),
  );

  return surface;
}
