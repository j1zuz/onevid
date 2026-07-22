import { X } from 'lucide-react-native';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Modal,
  NativeModules,
  Platform,
  Pressable,
  StyleSheet,
  TurboModuleRegistry,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tvFocusRing, useTvFocus } from '@/hooks/use-tv-focus';
import { COLORS } from '@/lib/theme';

// `react-native-webview` trae un módulo nativo (RNCWebView). Si un update OTA se
// sirve sobre un binario que NO lo incluye —p. ej. al añadir la dependencia sin
// subir el runtime version—, montar el WebView lanza
// "Invariant Violation: RNCWebViewModule could not be found" y tumba TODA la app.
// Lo cargamos con guarda y comprobamos que el módulo nativo exista; si falta,
// degradamos abriendo el tráiler en YouTube fuera de la app (el comportamiento
// previo a la reproducción in-app) en vez de crashear.
let WebViewComponent: typeof import('react-native-webview').WebView | null = null;
try {
  WebViewComponent = require('react-native-webview').WebView;
} catch {
  WebViewComponent = null;
}

function isWebViewModuleAvailable(): boolean {
  try {
    if (NativeModules.RNCWebViewModule != null) return true;
    // Nueva arquitectura: el módulo es un TurboModule. `get` (no `getEnforcing`)
    // devuelve null si el binario no lo trae, sin lanzar el invariant.
    return TurboModuleRegistry.get('RNCWebViewModule') != null;
  } catch {
    return false;
  }
}

const WEB_VIEW_AVAILABLE =
  WebViewComponent != null && isWebViewModuleAvailable();

/**
 * Reproduce el tráiler de YouTube DENTRO de la app (embed en un WebView a
 * pantalla completa), en vez de saltar a un navegador/app externa. Mismo patrón
 * que la web (`explore-movie-dialog.tsx`, iframe /embed). El embed autoplayea y
 * trae mínima interfaz de YouTube. Se cierra con el botón X o "Atrás".
 */
export function TrailerOverlay({
  trailerKey,
  visible,
  onClose,
}: {
  trailerKey: string | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { focused, focusProps } = useTvFocus();

  // El botón físico "Atrás" (control remoto de TV / gesto Android) cierra el
  // overlay en vez de salir de la pantalla de detalle.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  // Degradación cuando el WebView nativo no está disponible: al pedir el tráiler
  // lo abrimos en YouTube fuera de la app y cerramos el overlay. Así el usuario
  // sigue viendo el tráiler y la app nunca crashea por el módulo faltante.
  useEffect(() => {
    if (visible && !WEB_VIEW_AVAILABLE && trailerKey) {
      Linking.openURL(
        `https://www.youtube.com/watch?v=${encodeURIComponent(trailerKey)}`,
      ).catch(() => {
        /* ignore */
      });
      onClose();
    }
  }, [visible, trailerKey, onClose]);

  const renderLoading = useCallback(
    () => (
      <View style={styles.loading}>
        <ActivityIndicator color="#ffffff" />
      </View>
    ),
    [],
  );

  if (!trailerKey) return null;
  // Sin WebView no renderizamos el modal: el efecto de arriba ya abrió el tráiler
  // fuera de la app.
  const WebView = WebViewComponent;
  if (!(WEB_VIEW_AVAILABLE && WebView)) return null;

  // playsinline evita que iOS entre en su reproductor nativo a pantalla completa
  // apenas arranca; autoplay=1 + mediaPlaybackRequiresUserAction=false para que
  // suene sin tap (el WebView lo permite al venir de una acción del usuario).
  const uri = `https://www.youtube.com/embed/${encodeURIComponent(
    trailerKey,
  )}?autoplay=1&rel=0&playsinline=1&modestbranding=1`;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <WebView
          source={{ uri }}
          style={styles.web}
          containerStyle={{ backgroundColor: COLORS.background }}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          renderLoading={renderLoading}
        />
        <Pressable
          onPress={onClose}
          hasTVPreferredFocus={Platform.isTV}
          {...focusProps}
          style={[
            styles.close,
            { top: insets.top + 12 },
            tvFocusRing(focused),
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('Cerrar')}
        >
          <X size={24} color="#ffffff" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  web: { flex: 1, backgroundColor: COLORS.background },
  loading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
  close: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
});
