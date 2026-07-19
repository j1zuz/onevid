import { Button, Typography } from 'heroui-native';
import { router } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GodRaysBand } from '@/components/god-rays-band';
import { StreamLoginContent } from '@/components/stream-login-content';
import { useDeviceLogin } from '@/hooks/use-device-login';
import { useTvFocus, tvFocusRing } from '@/hooks/use-tv-focus';
import { setAppMode } from '@/lib/app-mode';
import { COLORS } from '@/lib/theme';

interface StreamLoginScreenProps {
  /** Revalida `useAppSurface` tras "Continuar sin cuenta" (ver use-app-surface.tsx). */
  onContinueWithoutAccount: () => void;
}

/**
 * Login por QR a pantalla completa, centrado (como en móvil). Se muestra cuando
 * hace falta sesión y no hay alternativa local — sobre todo en TV, donde el QR
 * aparece de una vez sin que el usuario tenga que buscar el tab Perfil.
 */
export function StreamLoginScreen({
  onContinueWithoutAccount,
}: StreamLoginScreenProps) {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const { focused, focusProps } = useTvFocus();
  const onApproved = useCallback(() => {
    router.replace('/profiles');
  }, []);
  const login = useDeviceLogin(true, onApproved);

  // Permite entrar sin cuenta (requerido por la revisión de Google Play en TV):
  // fuerza modo local y refresca la surface en el momento — un router.replace
  // a /home no serviría porque esta pantalla YA vive dentro de /home.
  const handleContinueWithoutAccount = useCallback(async () => {
    await setAppMode('local');
    onContinueWithoutAccount();
  }, [onContinueWithoutAccount]);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      edges={['top', 'bottom']}
    >
      <GodRaysBand height={Math.round(height * 0.28)} />
      <View style={{ flex: 1 }} className="items-center justify-center px-6">
        <View style={{ width: '100%', maxWidth: 480, gap: 28 }}>
          <Typography type="h2" align="center" color="default">
            {t('Inicia sesión')}
          </Typography>
          <StreamLoginContent {...login} />
          <Button
            variant="ghost"
            onPress={handleContinueWithoutAccount}
            {...focusProps}
            style={[{ alignSelf: 'center' }, tvFocusRing(focused)]}
          >
            {t('Continuar sin cuenta')}
          </Button>
        </View>
      </View>
    </SafeAreaView>
  );
}
