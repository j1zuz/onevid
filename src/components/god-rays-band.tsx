import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { COLORS } from '@/lib/theme';

const VIDEO_SOURCE = require('../../assets/videos/god-rays.mp4');

/**
 * Banda de video "God rays" anclada arriba. Reutiliza el mismo clip del splash
 * (muted, sin controles, contentFit cover). Por defecto hace loop, pensado para
 * pantallas persistentes (p. ej. el login con QR).
 *
 * Lleva un degradado al color de fondo en su borde inferior para que el video
 * se funda con la pantalla y no se vea un corte duro (sobre todo en TV).
 */
export function GodRaysBand({
  height,
  loop = true,
  fadeColor = COLORS.background,
  style,
}: {
  height: number;
  loop?: boolean;
  fadeColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const player = useVideoPlayer(VIDEO_SOURCE, (p) => {
    p.muted = true;
    p.loop = loop;
    p.play();
  });

  return (
    <View style={[styles.band, { height }, style]} pointerEvents="none">
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['transparent', fadeColor]}
        style={styles.fade}
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  band: { position: 'absolute', top: 0, left: 0, right: 0 },
  // El degradado cubre la mitad inferior de la banda y termina en el color de
  // fondo, eliminando el borde visible entre el video y la pantalla.
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
});
