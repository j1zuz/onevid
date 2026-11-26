import { Skeleton, Typography } from 'heroui-native';
import { X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { API_URL, getAccessToken } from '@/lib/auth';

/**
 * Configuración de la cuenta dentro de la app: `/home/account` de la web en un
 * WebView, dentro de una hoja inferior.
 *
 * La sesión de la app es un Bearer, no una cookie, y el WebView tiene su propio
 * almacén. Antes de pintar la página se canjea el Bearer por la cookie firmada
 * de Better Auth (`/api/auth/device/cookie`) desde el propio origen, así el
 * `Set-Cookie` cae en el WebView. El token nunca viaja en la URL.
 *
 * El WebView arranca invisible y solo se muestra cuando la página final
 * (`/home/account`) terminó de cargar: así nunca se ve el header de la web ni
 * el salto de la redirección. Mientras tanto se pinta un esqueleto.
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
  const [ready, setReady] = useState(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // El script avisa cuando la sesión ya está canjeada; hasta entonces la
  // primera carga (sin cookie) no debe revelarse.
  const authReady = useRef(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void getAccessToken().then((value) => {
      if (!cancelled) setToken(value);
    });
    // Red de seguridad: si el canje falla (token caducado) la página final no
    // llega nunca; a los 7 s mostramos lo que haya para no dejar el esqueleto.
    revealTimer.current = setTimeout(() => setReady(true), 7000);
    return () => {
      cancelled = true;
      if (revealTimer.current) clearTimeout(revealTimer.current);
    };
  }, [visible]);

  const handleClose = useCallback(() => {
    setToken(null);
    setReady(false);
    authReady.current = false;
    onClose();
  }, [onClose]);

  return (
    <Modal
      animationType="slide"
      onRequestClose={handleClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.root}>
        <Pressable onPress={handleClose} style={StyleSheet.absoluteFill} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Typography type="body-sm" weight="semibold">
              {t('Configuración')}
            </Typography>
            <Pressable hitSlop={8} onPress={handleClose} style={styles.close}>
              <X color="#e5e7eb" size={18} />
            </Pressable>
          </View>

          <View style={styles.body}>
            {token ? (
              <WebView
                injectedJavaScriptBeforeContentLoaded={bootstrapScript(token)}
                onLoadEnd={(event) => {
                  // Solo revelamos la página definitiva y con la sesión ya
                  // canjeada: la intermedia (portada, tras el redirect) no debe
                  // llegar a verse.
                  if (
                    authReady.current &&
                    event.nativeEvent.url.includes('/home/account')
                  ) {
                    if (revealTimer.current) clearTimeout(revealTimer.current);
                    setReady(true);
                  }
                }}
                onMessage={(event) => {
                  if (event.nativeEvent.data === 'ready') {
                    authReady.current = true;
                  }
                }}
                originWhitelist={['https://*']}
                source={{ uri: `${API_URL}/home/account` }}
                style={[styles.web, { opacity: ready ? 1 : 0 }]}
              />
            ) : null}

            {!ready ? (
              <View pointerEvents="none" style={styles.skeletonWrap}>
                <Skeleton style={{ borderRadius: 8, height: 22, width: '55%' }} />
                <Skeleton style={{ borderRadius: 14, height: 52, width: '100%' }} />
                <Skeleton style={{ borderRadius: 14, height: 52, width: '100%' }} />
                <Skeleton style={{ borderRadius: 14, height: 52, width: '100%' }} />
                <Skeleton style={{ borderRadius: 14, height: 52, width: '100%' }} />
                <Skeleton style={{ borderRadius: 14, height: 52, width: '100%' }} />
              </View>
            ) : null}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

/** Oculta el header de la web y los bordes laterales dentro de la hoja. */
const EMBED_CSS = `
  main > section.sticky { display: none !important; }
  main { border-left: 0 !important; border-right: 0 !important; }
  main > div > h1 { display: none !important; }
  body { background: #0A0A0A !important; }
`;

/**
 * Se ejecuta al inicio de cada carga del WebView.
 *
 * - Inyecta el CSS del modo incrustado (en la primera carga el <head> puede no
 *   existir todavía, así que se reintenta en DOMContentLoaded).
 * - Canjea el Bearer por la cookie de sesión y navega a la configuración.
 *
 * `sessionStorage` evita repetir el canje en cada navegación interna.
 */
function bootstrapScript(token: string): string {
  return `(function () {
    var css = ${JSON.stringify(EMBED_CSS)};
    function inject() {
      try {
        var style = document.createElement('style');
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
      } catch (e) {}
    }
    inject();
    document.addEventListener('DOMContentLoaded', inject);

    function notify() {
      try { window.ReactNativeWebView.postMessage('ready'); } catch (e) {}
    }

    try {
      // Segunda carga (ya con cookie): avisamos y dejamos que React Native
      // revele el WebView cuando termine de pintar.
      if (sessionStorage.getItem('onevid.settings.boot')) {
        document.addEventListener('DOMContentLoaded', notify);
        return;
      }
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
  root: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0A0A0A',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    height: '88%',
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: '#3f3f46',
    borderRadius: 999,
    height: 4,
    marginTop: 10,
    width: 44,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  close: {
    alignItems: 'center',
    backgroundColor: '#1f1f22',
    borderRadius: 999,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  body: { flex: 1 },
  web: { backgroundColor: '#0A0A0A', flex: 1 },
  skeletonWrap: {
    backgroundColor: '#0A0A0A',
    bottom: 0,
    gap: 12,
    left: 0,
    padding: 16,
    position: 'absolute',
    right: 0,
    top: 0,
  },
});
