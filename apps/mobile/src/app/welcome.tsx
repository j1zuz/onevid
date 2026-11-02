import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Button } from 'heroui-native';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View } from 'react-native';
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
  const { height } = useWindowDimensions();
  const surface = useAppSurface();
  const loginFocus = useTvFocus();
  const guestFocus = useTvFocus();
  const [leaving, setLeaving] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

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

      <View style={{ paddingHorizontal: 20, paddingBottom: 16, gap: 10 }}>
        <Button
          variant="primary"
          size="md"
          onPress={() => setLoginOpen(true)}
          {...loginFocus.focusProps}
          style={[{ width: '100%' }, tvFocusRing(loginFocus.focused)]}
        >
          {t('Iniciar sesión')}
        </Button>

        <Button
          variant="secondary"
          size="md"
          onPress={handleGuest}
          isDisabled={leaving}
          {...guestFocus.focusProps}
          style={[{ width: '100%' }, tvFocusRing(guestFocus.focused)]}
        >
          {leaving ? t('Entrando…') : t('Continuar sin cuenta')}
        </Button>
      </View>

      <LoginOptionsSheet
        visible={loginOpen}
        onClose={() => setLoginOpen(false)}
      />
    </SafeAreaView>
  );
}
