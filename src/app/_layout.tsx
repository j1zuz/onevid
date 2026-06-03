import '../global.css';
import { HeroUINativeProvider } from 'heroui-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { NavigationBar } from 'expo-navigation-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Platform, StatusBar as RNStatusBar } from 'react-native';
import { getAccessToken } from '@/lib/auth';
import { COLORS } from '@/lib/theme';

SplashScreen.preventAutoHideAsync().catch(() => {
  /* ignore */
});

if (Platform.OS === 'android') {
  RNStatusBar.setTranslucent(true);
  RNStatusBar.setBackgroundColor('transparent');
  RNStatusBar.setBarStyle('light-content');
  NavigationBar.setStyle('dark');
}

export default function RootLayout() {
  const [authReady, setAuthReady] = useState(false);
  const [hasToken, setHasToken] = useState(false);

  // App stays portrait by default; the video player overrides to landscape.
  useEffect(() => {
    ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.PORTRAIT_UP,
    ).catch(() => {
      /* ignore */
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    getAccessToken().then((token) => {
      if (cancelled) return;
      setHasToken(Boolean(token));
      setAuthReady(true);
      SplashScreen.hideAsync().catch(() => {
        /* ignore */
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!authReady) return null;

  return (
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: COLORS.background }}
    >
      <HeroUINativeProvider>
        <Stack
          initialRouteName={hasToken ? '(tabs)' : 'index'}
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: COLORS.background },
            animation: 'none',
          }}
        />
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
