import '../global.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { HeroUINativeProvider } from 'heroui-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { NavigationBar } from 'expo-navigation-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Platform, StatusBar as RNStatusBar } from 'react-native';
import { Uniwind } from 'uniwind';
import { AnimatedSplash } from '@/components/animated-splash';
import { getAccessToken } from '@/lib/auth';
import { loadActiveProfile } from '@/lib/profiles';
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
  NavigationBar.setStyle('dark');
}

export default function RootLayout() {
  const [authReady, setAuthReady] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [splashDone, setSplashDone] = useState(false);

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
      const token = await getAccessToken();
      const profile = token ? await loadActiveProfile() : null;
      if (cancelled) return;
      setHasToken(Boolean(token));
      setHasProfile(Boolean(profile));
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

  const initialRoute = !hasToken
    ? 'index'
    : hasProfile
      ? '(tabs)'
      : 'profiles';

  return (
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: COLORS.background }}
    >
      <QueryClientProvider client={queryClient}>
        <HeroUINativeProvider>
          <Stack
            initialRouteName={initialRoute}
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: COLORS.background },
              animation: 'none',
            }}
          />
          {!splashDone ? (
            <AnimatedSplash
              onLayoutReady={handleSplashLayoutReady}
              onFinish={() => setSplashDone(true)}
            />
          ) : null}
        </HeroUINativeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
