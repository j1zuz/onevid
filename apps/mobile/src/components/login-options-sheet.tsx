import { Image } from 'expo-image';
import { router } from 'expo-router';
import { BottomSheet, Button, Typography, useToast } from 'heroui-native';
import * as WebBrowser from 'expo-web-browser';
import { QrCode } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useDeviceLogin } from '@/hooks/use-device-login';
import { useTvFocus, tvFocusRing } from '@/hooks/use-tv-focus';

/**
 * Bottom sheet de "Iniciar sesión" (como el de la web): continuar con Google o
 * activar el dispositivo por código. Google usa el device-flow: abrimos la
 * página de aprobación en el navegador y seguimos haciendo polling hasta que se
 * confirme (ahí es donde se elige la cuenta de Google).
 */
export function LoginOptionsSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [openingBrowser, setOpeningBrowser] = useState(false);
  const googleFocus = useTvFocus();
  const codeFocus = useTvFocus();

  const onApproved = useCallback(() => {
    onClose();
    router.replace('/profiles');
  }, [onClose]);

  const login = useDeviceLogin(visible, onApproved);

  const handleGoogle = useCallback(async () => {
    if (openingBrowser) return;
    setOpeningBrowser(true);
    try {
      // Reutiliza el código ya pedido al abrir el sheet; si caducó o no llegó,
      // pide uno nuevo antes de abrir el navegador.
      const data =
        login.phase === 'waiting' && login.codeData
          ? login.codeData
          : await login.requestCode();
      if (!data) {
        toast.show({
          variant: 'danger',
          label: t('No pudimos iniciar sesión'),
          description: t('Revisa tu conexión e intenta de nuevo.'),
        });
        return;
      }
      await WebBrowser.openBrowserAsync(data.verification_uri_complete);
    } finally {
      setOpeningBrowser(false);
    }
  }, [login, openingBrowser, t, toast]);

  // El código va a la pantalla con QR + código (se aprueba en /device).
  const handleCode = useCallback(() => {
    onClose();
    router.push('/login');
  }, [onClose]);

  return (
    <BottomSheet
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <BottomSheet.Portal>
        <BottomSheet.Overlay />
        <BottomSheet.Content>
          <View style={styles.body}>
            <View style={styles.badge}>
              <Image
                source={require('../../assets/images/onevid-icon.png')}
                contentFit="cover"
                style={{ width: 46, height: 46, borderRadius: 14 }}
              />
            </View>

            <View style={{ alignItems: 'center', gap: 6 }}>
              <BottomSheet.Title className="text-center">
                {t('Iniciar sesión')}
              </BottomSheet.Title>
              <BottomSheet.Description className="text-center">
                {t('Continúa para iniciar sesión o crear una cuenta.')}
              </BottomSheet.Description>
            </View>

            <Button
              variant="outline"
              onPress={handleGoogle}
              isDisabled={openingBrowser}
              {...googleFocus.focusProps}
              style={[
                { width: '100%', flexDirection: 'row', gap: 10 },
                tvFocusRing(googleFocus.focused),
              ]}
            >
              <GoogleIcon size={18} />
              <Button.Label>
                {openingBrowser ? t('Abriendo…') : t('Continuar con Google')}
              </Button.Label>
            </Button>

            <View style={styles.divider}>
              <View style={styles.line} />
              <View style={styles.or}>
                <Typography type="body-xs" color="muted">
                  {t('o')}
                </Typography>
              </View>
              <View style={styles.line} />
            </View>

            <Button
              variant="outline"
              onPress={handleCode}
              {...codeFocus.focusProps}
              style={[
                { width: '100%', flexDirection: 'row', gap: 10 },
                tvFocusRing(codeFocus.focused),
              ]}
            >
              <QrCode size={18} color="#e5e7eb" />
              <Button.Label>{t('Activar por código')}</Button.Label>
            </Button>
          </View>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}

/** "G" oficial de Google (4 colores) para el botón de continuar con Google. */
function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
        fill="#EA4335"
      />
      <Path
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
        fill="#4285F4"
      />
      <Path
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
        fill="#FBBC05"
      />
      <Path
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
        fill="#34A853"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  body: {
    alignItems: 'center',
    gap: 16,
    paddingTop: 4,
  },
  badge: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  or: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
});
