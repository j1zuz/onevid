import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GodRaysBand } from '@/components/god-rays-band';
import { LoginOptionsSheet } from '@/components/login-options-sheet';
import { useAppSurface } from '@/hooks/use-app-surface';
import { useTvFocus, tvFocusRing } from '@/hooks/use-tv-focus';
import { setAppMode } from '@/lib/app-mode';
import { COLORS } from '@/lib/theme';

// Wordmark "onevid" (letras), el mismo del splash/overlay de arranque.
const LOGO_SOURCE = require('../../assets/images/onevid-text.png');
const LOGO_ASPECT = 1568 / 622;

/**
 * Puerta de entrada sin sesión: en vez de caer directo al modo local, se ofrece
 * iniciar sesión (login por código de dispositivo, /login) o continuar sin
 * cuenta (modo local).
 */
export default function WelcomeScreen() {
  const { t } = useTranslation();
  const { height, width } = useWindowDimensions();
  const surface = useAppSurface();
  const loginFocus = useTvFocus();
  const guestFocus = useTvFocus();
  const [leaving, setLeaving] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const buttonWidth = Platform.isTV ? Math.min(width * 0.52, 520) : '100%';

  // "Continuar sin cuenta" = modo local, sin salir de la app.
  const handleGuest = useCallback(async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await setAppMode('local');
      await surface?.refresh();
      router.replace('/home');
    } finally {
      setLeaving(false);
    }
  }, [leaving, surface]);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      edges={['top', 'bottom']}
    >
      <GodRaysBand height={Math.round(height * 0.32)} />

      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 28,
          gap: 14,
        }}
      >
        <Image
          source={LOGO_SOURCE}
          contentFit="contain"
          style={{ width: 260, aspectRatio: LOGO_ASPECT }}
        />
      </View>

      <View
        style={{
          alignItems: 'center',
          paddingHorizontal: 20,
          paddingBottom: 16,
          gap: 10,
        }}
      >
        <Pressable
          accessibilityRole="button"
          focusable={Platform.isTV}
          hasTVPreferredFocus={Platform.isTV}
          onPress={() => setLoginOpen(true)}
          onFocus={loginFocus.focusProps.onFocus}
          onBlur={loginFocus.focusProps.onBlur}
          style={[
            {
              alignItems: 'center',
              backgroundColor: '#0879d1',
              borderRadius: 24,
              justifyContent: 'center',
              minHeight: 46,
              paddingHorizontal: 20,
              width: buttonWidth,
            },
            tvFocusRing(loginFocus.focused),
          ]}
        >
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
            {t('Iniciar sesión')}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          focusable={Platform.isTV}
          onFocus={guestFocus.focusProps.onFocus}
          onBlur={guestFocus.focusProps.onBlur}
          onPress={handleGuest}
          disabled={leaving}
          style={[
            {
              alignItems: 'center',
              backgroundColor: 'rgba(255,255,255,0.08)',
              borderRadius: 24,
              justifyContent: 'center',
              minHeight: 46,
              paddingHorizontal: 20,
              width: buttonWidth,
            },
            tvFocusRing(guestFocus.focused),
          ]}
        >
          <Text style={{ color: '#0879d1', fontSize: 16, fontWeight: '600' }}>
            {leaving ? t('Entrando…') : t('Continuar sin cuenta')}
          </Text>
        </Pressable>
      </View>

      <LoginOptionsSheet
        visible={loginOpen}
        onClose={() => setLoginOpen(false)}
      />
    </SafeAreaView>
  );
}
