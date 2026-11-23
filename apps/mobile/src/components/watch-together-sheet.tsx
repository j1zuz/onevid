import { Button, Typography } from 'heroui-native';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tvFocusRing, useTvFocus } from '@/hooks/use-tv-focus';

/**
 * "Ver juntos" en la TV: un único QR con `onevid://watch/<id>?chat=1`, que abre
 * el chat dentro de la app (nunca el reproductor: la película sigue en la TV).
 */
export function WatchTogetherSheet({
  visible,
  appUrl,
  title,
  onClose,
}: {
  visible: boolean;
  appUrl: string | null;
  title?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const closeFocus = useTvFocus();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.card}>
          <Typography align="center" type="h4" weight="bold">
            {t('Ver juntos')}
          </Typography>
          {title ? (
            <Typography
              align="center"
              color="muted"
              numberOfLines={1}
              type="body-sm"
            >
              {title}
            </Typography>
          ) : null}
          <Typography align="center" color="muted" type="body-xs">
            {t('Escanea con la app Onevid para chatear mientras ves la TV.')}
          </Typography>

          <View style={styles.qrWrap}>
            {appUrl ? (
              <QRCode
                backgroundColor="#fff"
                color="#000"
                size={196}
                value={appUrl}
              />
            ) : null}
          </View>

          <Button
            onPress={onClose}
            style={tvFocusRing(closeFocus.focused)}
            variant="outline"
            {...closeFocus.focusProps}
          >
            <Button.Label>{t('Terminar la sala')}</Button.Label>
          </Button>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.82)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    alignItems: 'center',
    backgroundColor: '#171717',
    borderRadius: 22,
    gap: 10,
    padding: 22,
    width: '100%',
    maxWidth: 380,
  },
  qrWrap: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginVertical: 6,
    padding: 12,
  },
});
