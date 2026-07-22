import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { COLORS } from '@/lib/theme';

// Cuánto esperamos antes de destapar el splash nativo y mostrar el spinner. Si
// el arranque termina antes (caso normal), este gate se desmonta y AnimatedSplash
// oculta el splash nativo como siempre, sin cambiar la experiencia de apertura.
// Si el arranque se demora, tras este umbral el usuario ve un spinner en vez de
// quedarse mirando el splash negro nativo.
const SHOW_SPINNER_AFTER_MS = 800;

// Pantalla de arranque visible: reemplaza el `return null` que dejaba solo el
// splash negro nativo mientras RootLayout valida la sesión. Se renderiza FUERA
// del árbol de providers (HeroUI, etc.), así que usa solo primitivos de RN.
export function BootGate({
  error,
  onRetry,
}: {
  error: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    // Con error destapamos el splash nativo de inmediato para mostrar el mensaje
    // y el botón de reintentar; sin error esperamos un poco para no perturbar la
    // apertura normal (que suele resolverse en <1s).
    if (error) {
      SplashScreen.hideAsync().catch(() => {
        /* ignore */
      });
      return;
    }
    const timer = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {
        /* ignore */
      });
    }, SHOW_SPINNER_AFTER_MS);
    return () => clearTimeout(timer);
  }, [error]);

  return (
    <View style={styles.root}>
      {error ? (
        <View style={styles.center}>
          <Text style={styles.title}>{t('No pudimos iniciar la app')}</Text>
          <Text style={styles.subtitle}>
            {t('Revisa tu conexión e intenta de nuevo.')}
          </Text>
          <Pressable
            accessibilityLabel={t('Reintentar')}
            accessibilityRole="button"
            onPress={onRetry}
            style={styles.retry}
          >
            <Text style={styles.retryText}>{t('Reintentar')}</Text>
          </Pressable>
        </View>
      ) : (
        <ActivityIndicator color="#ffffff" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    padding: 24,
  },
  center: { alignItems: 'center', gap: 12 },
  title: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    textAlign: 'center',
  },
  retry: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
  },
  retryText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
});
