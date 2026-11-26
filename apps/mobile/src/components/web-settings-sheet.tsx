import { Button, Typography } from 'heroui-native';
import { X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { API_URL, getAccessToken } from '@/lib/auth';

/**
 * Configuración de la cuenta dentro de la app: carga `/home/account` de la web
 * en un WebView, a pantalla completa dentro de una hoja.
 *
 * La sesión de la app es un Bearer, no una cookie, y el WebView tiene su propio
 * almacén de cookies. Antes de pintar la página se canjea el Bearer por la
 * cookie firmada de Better Auth (`/api/auth/device/cookie`) desde el propio
 * origen, así el `Set-Cookie` cae en el WebView y la página carga autenticada.
 * El token nunca viaja en la URL.
 */
export function WebSettingsSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void getAccessToken().then((value) => {
      if (!cancelled) setToken(value);
    });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const handleClose = useCallback(() => {
    setToken(null);
    onClose();
  }, [onClose]);

  return (
    <Modal
      animationType="slide"
      onRequestClose={handleClose}
      statusBarTranslucent
      visible={visible}
    >
      <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
        <View style={styles.header}>
          <Typography type="body-sm" weight="semibold">
            {t('Configuración')}
          </Typography>
          <Button onPress={handleClose} size="sm" variant="ghost">
            <X color="#e5e7eb" size={18} />
          </Button>
        </View>

        {token ? (
          <WebView
            injectedJavaScriptBeforeContentLoaded={bootstrapScript(token)}
            originWhitelist={['https://*']}
            source={{ uri: `${API_URL}/home/account` }}
            startInLoadingState
            style={styles.web}
            renderLoading={() => (
              <View style={styles.loading}>
                <ActivityIndicator color="#e5e7eb" />
              </View>
            )}
          />
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color="#e5e7eb" />
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

/**
 * Se ejecuta al inicio de cada carga del WebView.
 *
 * 1. Canjea el Bearer por la cookie de sesión (same-origin, `credentials`).
 * 2. Navega a la configuración ya autenticada.
 *
 * `sessionStorage` hace de cerrojo para no repetir el canje en cada navegación
 * interna (y evitar un bucle de recargas).
 */
function bootstrapScript(token: string): string {
  return `(function () {
    try {
      if (sessionStorage.getItem('onevid.settings.boot')) return;
      sessionStorage.setItem('onevid.settings.boot', '1');
      fetch('/api/auth/device/cookie', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: ${JSON.stringify(token)} })
      })
        .catch(function () {})
        .then(function () { location.replace('/home/account'); });
    } catch (e) {}
  })();`;
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#0A0A0A', flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomColor: '#1f1f22',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  web: { backgroundColor: '#0A0A0A', flex: 1 },
  loading: {
    alignItems: 'center',
    backgroundColor: '#0A0A0A',
    flex: 1,
    justifyContent: 'center',
  },
});
