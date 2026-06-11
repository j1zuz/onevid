import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const VIDEO_SOURCE = require('../../assets/videos/god-rays.mp4');
// Logo onevid (mismo que el splash nativo) para que no haya salto al revelar.
const LOGO_SOURCE = require('../../assets/images/onevid.png');

const LOGO_WIDTH = 200; // = imageWidth del splash nativo → sin salto
const TOP_BAND_RATIO = 0.28; // banda de video en el ~28% superior
const MAX_DURATION_MS = 2500; // fallback si el video no reporta fin
const FADE_OUT_MS = 400;

type Props = {
  /** Se llama al terminar el fade → el padre desmonta el overlay. */
  onFinish: () => void;
  /** Overlay ya pintado → el padre puede ocultar el splash nativo sin hueco. */
  onLayoutReady?: () => void;
};

const REVEAL_FALLBACK_MS = 700; // si onFirstFrameRender no dispara, revelar igual

export function AnimatedSplash({ onFinish, onLayoutReady }: Props) {
  const { height } = useWindowDimensions();
  const opacity = useSharedValue(1);
  const finishedRef = useRef(false);
  const revealedRef = useRef(false);

  const player = useVideoPlayer(VIDEO_SOURCE, (p) => {
    p.muted = true;
    p.loop = false;
    p.play();
  });

  // Oculta el splash nativo (el padre llama hideAsync) SOLO cuando el primer
  // frame del video ya está pintado. Así, al desaparecer el splash nativo, el
  // icono y el video aparecen a la vez (no el icono primero y el video después).
  // Se ejecuta una sola vez.
  const reveal = useCallback(() => {
    if (revealedRef.current) return;
    revealedRef.current = true;
    onLayoutReady?.();
  }, [onLayoutReady]);

  const beginFadeOut = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    opacity.value = withTiming(0, { duration: FADE_OUT_MS }, (done) => {
      if (done) runOnJS(onFinish)();
    });
  }, [onFinish, opacity]);

  // Fin del clip → fade
  useEffect(() => {
    const sub = player.addListener('playToEnd', () => beginFadeOut());
    return () => sub?.remove();
  }, [player, beginFadeOut]);

  // Fallback de revelado: en TV onFirstFrameRender puede no emitirse, así que
  // cuando el player llega a readyToPlay (ya hay frame disponible) revelamos
  // igual. Si falla, revelamos y arrancamos el fade para no quedarnos colgados.
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') reveal();
      if (status === 'error') {
        reveal();
        beginFadeOut();
      }
    });
    return () => sub?.remove();
  }, [player, reveal, beginFadeOut]);

  // Tope de seguridad: nunca dejar el splash nativo colgado esperando un frame.
  useEffect(() => {
    const t = setTimeout(reveal, REVEAL_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [reveal]);

  // Tope duro de tiempo
  useEffect(() => {
    const t = setTimeout(beginFadeOut, MAX_DURATION_MS);
    return () => clearTimeout(t);
  }, [beginFadeOut]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.overlay, overlayStyle]}>
      <View
        style={[styles.videoBand, { height: height * TOP_BAND_RATIO }]}
        pointerEvents="none"
      >
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
          onFirstFrameRender={reveal}
          pointerEvents="none"
        />
        {/* Degradado a negro para que el video se funda con el fondo del splash
            y no quede un corte visible. */}
        <LinearGradient
          colors={['transparent', '#000000']}
          style={styles.videoFade}
          pointerEvents="none"
        />
      </View>
      <Image source={LOGO_SOURCE} style={styles.logo} contentFit="contain" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000',
    zIndex: 100,
    elevation: 100, // Android: encima del Stack
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoBand: { position: 'absolute', top: 0, left: 0, right: 0 },
  videoFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  logo: { width: LOGO_WIDTH, aspectRatio: 1 },
});
