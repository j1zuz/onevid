import { useEvent } from 'expo';
import { Image } from 'expo-image';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useVideoPlayer, VideoView } from 'expo-video';
import { router, useLocalSearchParams } from 'expo-router';
import { Typography } from 'heroui-native';
import { ArrowLeft } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_URL, getAccessToken } from '@/lib/auth';

type ResolvedStream = { url: string; fileName?: string };

type ResolveState =
  | { kind: 'resolving' }
  | { kind: 'ready'; url: string; fileName?: string }
  | { kind: 'error'; message: string };

async function resolveStreamUrl(raw: string): Promise<ResolvedStream> {
  if (raw.startsWith('/api/')) {
    const sep = raw.includes('?') ? '&' : '?';
    const token = await getAccessToken();
    const res = await fetch(`${API_URL}${raw}${sep}redirect=0`, {
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      throw new Error(`No se pudo resolver el stream (HTTP ${res.status})`);
    }
    const data = (await res.json()) as {
      url?: string;
      fileName?: string;
      error?: string;
    };
    if (!data.url) {
      throw new Error(data.error ?? 'El stream no devolvió una URL.');
    }
    return { url: data.url, fileName: data.fileName };
  }
  return { url: raw };
}

// Equivalente nativo de getMimeType() de la web: la web le pasa el MIME explícito
// al <video> de video.js; aquí le pasamos el `contentType` de expo-video para que
// ExoPlayer/Media3 sepa tratar la URL aunque venga sin extensión (caso típico de
// las URLs resueltas por TorBox). Detectamos sobre el fileName (extensión fiable)
// y, si no hay, sobre la URL.
function getContentType(
  url: string,
  fileName?: string,
): 'auto' | 'progressive' | 'hls' | 'dash' {
  const hay = `${fileName ?? ''} ${url}`.toLowerCase();
  if (/\.m3u8(\?|$)/.test(hay) || hay.includes('.m3u8')) return 'hls';
  if (/\.mpd(\?|$)/.test(hay) || hay.includes('.mpd')) return 'dash';
  if (/\.(mp4|mkv|webm|avi|mov|m4v|ts)(\?|$)/.test(hay)) return 'progressive';
  return 'auto';
}

export default function PlayerScreen() {
  const params = useLocalSearchParams<{
    url: string;
    title?: string;
    background?: string;
    logo?: string;
  }>();
  const rawUrl = params.url ?? '';
  const title = params.title;
  const background = params.background || undefined;
  const logo = params.logo || undefined;
  const [state, setState] = useState<ResolveState>({ kind: 'resolving' });

  // Auto-rotate to landscape while the player is mounted; restore on exit.
  // En Android TV la pantalla ya es landscape fija, así que no tocamos la
  // orientación.
  useEffect(() => {
    if (Platform.isTV) return;
    ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.LANDSCAPE,
    ).catch(() => {
      /* ignore */
    });
    return () => {
      ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP,
      ).catch(() => {
        /* ignore */
      });
    };
  }, []);

  useEffect(() => {
    if (!rawUrl) {
      setState({ kind: 'error', message: 'Falta la URL del stream.' });
      return;
    }
    let cancelled = false;
    resolveStreamUrl(rawUrl)
      .then(({ url, fileName }) => {
        if (!cancelled) setState({ kind: 'ready', url, fileName });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'error',
            message:
              e instanceof Error ? e.message : 'No pudimos abrir el stream.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [rawUrl]);

  return (
    <View style={styles.root}>
      {state.kind === 'ready' ? (
        <Player
          url={state.url}
          fileName={state.fileName}
          title={title}
          background={background}
          logo={logo}
        />
      ) : (
        <LoadingArt
          background={background}
          logo={logo}
          title={title}
          error={state.kind === 'error' ? state.message : undefined}
        />
      )}

      <SafeAreaView
        edges={['top']}
        style={styles.backWrap}
        pointerEvents="box-none"
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color="#fff" />
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

function Player({
  url,
  fileName,
  title,
  background,
  logo,
}: {
  url: string;
  fileName?: string;
  title?: string;
  background?: string;
  logo?: string;
}) {
  const videoRef = useRef<VideoView>(null);
  const player = useVideoPlayer(
    {
      uri: url,
      contentType: getContentType(url, fileName),
      metadata: title ? { title } : undefined,
    },
    (p) => {
      p.audioMixingMode = 'doNotMix';
      p.staysActiveInBackground = true;
      p.muted = false;
      p.volume = 1.0;
      p.play();
    },
  );

  const { status, error } = useEvent(player, 'statusChange', {
    status: player.status,
  });

  // Some streams don't auto-select an audio track (Audio: None). If the player
  // exposes decodable tracks but none is active, pick the first one.
  useEffect(() => {
    if (status !== 'readyToPlay') return;
    try {
      if (!player.audioTrack && player.availableAudioTracks.length > 0) {
        player.audioTrack = player.availableAudioTracks[0];
      }
    } catch {
      /* ignore */
    }
  }, [status, player]);

  const showArt = status !== 'readyToPlay';

  return (
    <>
      <VideoView
        ref={videoRef}
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls
        allowsPictureInPicture
        fullscreenOptions={{ enable: true }}
      />

      {showArt ? (
        <LoadingArt
          background={background}
          logo={logo}
          title={title}
          error={
            status === 'error'
              ? humanizePlaybackError(error?.message)
              : undefined
          }
        />
      ) : null}
    </>
  );
}

function humanizePlaybackError(raw?: string): string {
  const e = (raw ?? '').toLowerCase();
  // Solo un codec/decodificador genuino: HEVC/H.265, NAL malformado o un
  // decodificador que el dispositivo no tiene.
  if (
    e.includes('hevc') ||
    e.includes('h265') ||
    e.includes('h.265') ||
    e.includes('nal') ||
    e.includes('decoder') ||
    e.includes('codec')
  ) {
    return 'Esta fuente usa un codec que tu dispositivo no puede reproducir (suele ser HEVC/x265). Prueba con otra fuente, preferiblemente H.264/x264.';
  }
  if (e.includes('source error') || e.includes('http') || e.includes('404')) {
    return 'La fuente no está disponible o expiró. Vuelve atrás y elige otra.';
  }
  if (e.includes('network') || e.includes('timeout')) {
    return 'Problema de conexión al cargar el stream. Revisa tu red e intenta otra fuente.';
  }
  // 'format', 'container', 'extractor', 'malformed' → casi siempre detección de
  // contenedor, no un codec real. Mensaje neutro.
  return 'No se pudo abrir esta fuente. Intenta con otra.';
}

function LoadingArt({
  background,
  logo,
  title,
  error,
}: {
  background?: string;
  logo?: string;
  title?: string;
  error?: string;
}) {
  const pulse = useSharedValue(0.55);

  useEffect(() => {
    if (error) return;
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(pulse);
  }, [error, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View style={styles.artRoot} pointerEvents={error ? 'auto' : 'none'}>
      {background ? (
        <Image
          source={background}
          contentFit="cover"
          cachePolicy="memory-disk"
          style={[StyleSheet.absoluteFill, { opacity: 0.4 }]}
          blurRadius={20}
        />
      ) : null}
      <View style={styles.artScrim} />

      {error ? (
        <View style={styles.artCenter}>
          <Typography type="body" weight="semibold" color="default" align="center">
            No se pudo reproducir
          </Typography>
          <Typography
            type="body-sm"
            color="muted"
            align="center"
            style={{ marginTop: 8 }}
          >
            {error}
          </Typography>
        </View>
      ) : (
        <Animated.View style={[styles.artCenter, pulseStyle]}>
          {logo ? (
            <Image
              source={logo}
              contentFit="contain"
              style={{ width: '60%', height: 120 }}
            />
          ) : (
            <Typography type="h2" weight="bold" align="center">
              {title ?? ''}
            </Typography>
          )}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  artRoot: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  artScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  artCenter: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  backWrap: { position: 'absolute', top: 0, left: 12, zIndex: 10 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
});
