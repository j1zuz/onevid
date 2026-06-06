import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

const VIDEO_SOURCE = require('../../assets/videos/god-rays.mp4');

/**
 * Banda de video "God rays" anclada arriba. Reutiliza el mismo clip del splash
 * (muted, sin controles, contentFit cover). Por defecto hace loop, pensado para
 * pantallas persistentes (p. ej. el login con QR).
 */
export function GodRaysBand({
  height,
  loop = true,
  style,
}: {
  height: number;
  loop?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const player = useVideoPlayer(VIDEO_SOURCE, (p) => {
    p.muted = true;
    p.loop = loop;
    p.play();
  });

  return (
    <VideoView
      player={player}
      style={[styles.band, { height }, style]}
      contentFit="cover"
      nativeControls={false}
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  band: { position: 'absolute', top: 0, left: 0, right: 0 },
});
