import { router } from 'expo-router';
import { Typography } from 'heroui-native';
import { ArrowLeft } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Variante WEB del reproductor. El reproductor real (`player.tsx`) importa
// `expo-libvlc-player`, un módulo SÓLO nativo que registra su vista con
// `requireNativeViewManager` de expo-modules-core. Ese registro se ejecuta al
// evaluar el módulo y LANZA en web, así que basta con que expo-router cargue la
// ruta durante el export estático (`web.output: "static"`) para tumbar el
// bundle. Metro resuelve este `.web.tsx` en lugar de `player.tsx` en el build
// web, de modo que `expo-libvlc-player` nunca entra al bundle web. onevid es
// una app nativa (móvil / Android TV) primero; en web mostramos un aviso en vez
// del reproductor.
export default function PlayerScreenWeb() {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <View
        style={[styles.backWrap, { top: insets.top + 14, left: insets.left + 12 }]}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color="#fff" />
        </Pressable>
      </View>

      <View style={styles.center}>
        <View style={styles.card}>
          <Typography type="body" weight="semibold" color="default" align="center">
            Reproductor no disponible en la web
          </Typography>
          <Typography
            type="body-sm"
            color="muted"
            align="center"
            style={{ marginTop: 6 }}
          >
            Abre onevid en la app móvil o Android TV para reproducir vídeo.
          </Typography>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    maxWidth: 520,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
  },
  backWrap: { position: 'absolute', zIndex: 10 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
