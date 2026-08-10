import '../global.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { HeroUINativeProvider } from 'heroui-native';
import { PostHogProvider } from 'posthog-react-native';
import { posthog } from '@/lib/analytics';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { NavigationBar } from 'expo-navigation-bar';
import { ObserveRoot, useObserve } from 'expo-observe';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { Platform, StatusBar as RNStatusBar } from 'react-native';
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from 'react-native-safe-area-context';
import { Uniwind } from 'uniwind';
import { AnimatedSplash } from '@/components/animated-splash';
import { AppSurfaceProvider } from '@/hooks/use-app-surface';
import i18next from '@/lib/i18n';
import { useLanguageOverride } from '@/lib/i18n/language-preference';
import { useDeviceLocale } from '@/lib/i18n/use-device-locale';
import { type AppMode, loadAppMode } from '@/lib/app-mode';
import { validateSession } from '@/lib/auth';
import { queryClient } from '@/lib/query';
import { COLORS } from '@/lib/theme';

// App dark-only. uniwind resuelve las clases de tema (text-foreground, etc.)
// según su `currentTheme`, que se fija al construirse leyendo el color scheme
// del sistema; si éste reporta unspecified/null cae a light → texto oscuro
// ilegible sobre el fondo oscuro. Appearance.setColorScheme no actualiza ese
// tema de forma fiable una vez construido uniwind, así que usamos su API propia
// setTheme('dark'), que fija el tema y notifica a los componentes de inmediato.
Uniwind.setTheme('dark');

SplashScreen.preventAutoHideAsync().catch(() => {
  /* ignore */
});
// setOptions no existe en Expo Go (solo dev/release builds); llamarlo ahí lanza
// un warning. Lo saltamos cuando corremos en Expo Go (expoGoConfig != null).
if (Constants.expoGoConfig == null) {
  SplashScreen.setOptions({ fade: true, duration: 400 });
}

if (Platform.OS === 'android') {
  RNStatusBar.setTranslucent(true);
  RNStatusBar.setBackgroundColor('transparent');
  RNStatusBar.setBarStyle('light-content');
  // Con edge-to-edge (Android 15) la barra de navegación es transparente y
  // muestra el fondo de la ventana: lo fijamos en negro para que se vea oscura,
  // y ponemos los iconos en claro (blanco) encima.
  SystemUI.setBackgroundColorAsync('#000000').catch(() => {
    /* ignore */
  });
  NavigationBar.setStyle('light');
}

function RootLayout() {
  const [authReady, setAuthReady] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [appMode, setMode] = useState<AppMode>('stream');
  const [splashDone, setSplashDone] = useState(false);

  // EAS Observe: markInteractive marca el momento en que la UI real queda
  // visible y usable (Time to Interactive). Lo llamamos al terminar el overlay
  // AnimatedSplash. Es idempotente: solo la primera llamada registra la medición.
  const { markInteractive } = useObserve();

  // Idioma efectivo: si el usuario eligió uno en Perfil (override) manda ése; si
  // no, seguimos el idioma del dispositivo. Así no forzamos idioma por defecto,
  // pero respetamos la elección manual aunque cambie el locale del sistema.
  const deviceLocale = useDeviceLocale();
  const languageOverride = useLanguageOverride();
  useEffect(() => {
    i18next.changeLanguage(languageOverride ?? deviceLocale);
  }, [languageOverride, deviceLocale]);

  // App stays portrait by default; the video player overrides to landscape.
  // En Android TV no aplica (siempre landscape), así que lo saltamos.
  useEffect(() => {
    if (Platform.isTV) return;
    ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.PORTRAIT_UP,
    ).catch(() => {
      /* ignore */
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Validamos la sesión contra el backend (Better Auth) en vez de sólo
      // comprobar que exista un token: si la sesión expiró o se revocó,
      // validateSession limpia el token y caemos al login limpiamente en lugar
      // de entrar a la app con un token muerto.
      const [valid, mode] = await Promise.all([validateSession(), loadAppMode()]);
      if (cancelled) return;
      setHasToken(valid);
      setMode(mode);
      setAuthReady(true);
      // El splash nativo lo oculta AnimatedSplash.onLayoutReady, no aquí, para
      // evitar un hueco negro antes de que el overlay se pinte.
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSplashLayoutReady = () => {
    // El overlay ya está pintado (negro + banda de video + logo), así que es
    // seguro quitar el splash nativo sin que se vea ningún hueco.
    SplashScreen.hideAsync().catch(() => {
      /* ignore */
    });
  };

  if (!authReady) return null;

  // Con sesión en modo stream abrimos SIEMPRE en la selección de perfil: en cada
  // arranque en frío se elige perfil (y se pide su PIN si lo tiene), en vez de
  // recordar el último indefinidamente. Sin sesión, o en modo local (el usuario
  // eligió "sin cuenta"/local), abrimos directo en los tabs. `initialRouteName`
  // solo aplica al lanzar, así que el picker no reaparece al cambiar de tab.
  const initialRoute =
    hasToken && appMode === 'stream' ? 'profiles' : '(tabs)';

  return (
    <PostHogProvider client={posthog}>
      <GestureHandlerRootView
        style={{ flex: 1, backgroundColor: COLORS.background }}
      >
        {/* `initialMetrics` sembra los insets sincrónicamente (constante nativa,
            sin round-trip) para que `useSafeAreaInsets()` tenga el valor correcto
            desde el primer render — evita el salto de <SafeAreaView> nativo, que
            mide un frame después y causa que el contenido "baje" a su padding. */}
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <QueryClientProvider client={queryClient}>
            <HeroUINativeProvider>
              <AppSurfaceProvider initial={{ authed: hasToken, mode: appMode }}>
                <Stack
                  initialRouteName={initialRoute}
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: COLORS.background },
                    animation: 'none',
                  }}
                />
              </AppSurfaceProvider>
              {!splashDone ? (
                <AnimatedSplash
                  onLayoutReady={handleSplashLayoutReady}
                  onFinish={() => {
                    setSplashDone(true);
                    markInteractive();
                  }}
                />
              ) : null}
            </HeroUINativeProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </PostHogProvider>
  );
}

// ObserveRoot.wrap instrumenta el layout raíz de expo-router para que EAS Observe
// mida automáticamente el Time to First Render de la app en producción.
export default ObserveRoot.wrap(RootLayout);
