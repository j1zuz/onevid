import { Typography } from 'heroui-native';
import { router } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StreamLoginContent } from '@/components/stream-login-content';
import { useDeviceLogin } from '@/hooks/use-device-login';

/**
 * Drawer (bottom sheet) con el login por QR (device-code flow) para entrar al
 * modo Stream. Se abre desde el tab Perfil/Configuración (móvil). La lógica de
 * red solo corre mientras `visible`.
 */
export function StreamLoginSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const onApproved = useCallback(() => {
    onClose();
    router.replace('/profiles');
  }, [onClose]);
  const login = useDeviceLogin(visible, onApproved);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Typography type="h4" weight="bold" align="center">
              {t('Iniciar sesión')}
            </Typography>
          </View>

          <StreamLoginContent {...login} />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: '#161616',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 24,
    gap: 20,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#3f3f46',
    marginBottom: 4,
  },
  header: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
});
