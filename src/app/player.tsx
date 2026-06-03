import { useEvent } from 'expo';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useVideoPlayer, VideoView } from 'expo-video';
import { router, useLocalSearchParams } from 'expo-router';
import { Spinner, Typography } from 'heroui-native';
import { ArrowLeft } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_URL, getAccessToken } from '@/lib/auth';

type ResolveState =
  | { kind: 'resolving' }
  | { kind: 'ready'; url: string }
  | { kind: 'error'; message: string };

/**
 * Resolve the playable URL. Addon URLs come either as direct HTTP(S) streams or
 * as a relative `/api/torbox/resolve?...` path that 302-redirects to the final
 * CDN URL. The redirect endpoint is auth-gated, so we hit it with the bearer
 * token (redirect=0) to get the direct URL as JSON before handing it to the
 * native player.
 */
async function resolveStreamUrl(raw: string): Promise<string> {
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
    const data = (await res.json()) as { url?: string; error?: string };
    if (!data.url) {
      throw new Error(data.error ?? 'El stream no devolvió una URL.');
    }
    return data.url;
  }
  return raw;
}

export default function PlayerScreen() {
  const params = useLocalSearchParams<{ url: string; title?: string }>();
  const rawUrl = params.url ?? '';
  const title = params.title;
  const [state, setState] = useState<ResolveState>({ kind: 'resolving' });

  // Auto-rotate to landscape while the player is mounted; restore on exit.
  useEffect(() => {
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
      .then((url) => {
        if (!cancelled) setState({ kind: 'ready', url });
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
        <Player url={state.url} title={title} />
      ) : (
        <View style={styles.center}>
          {state.kind === 'resolving' ? (
            <>
              <Spinner />
              <Typography type="body-sm" color="muted">
                Preparando reproducción…
              </Typography>
            </>
          ) : (
            <Typography type="body" color="default" align="center">
              {state.message}
            </Typography>
          )}
        </View>
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

function Player({ url, title }: { url: string; title?: string }) {
  const videoRef = useRef<VideoView>(null);
  const player = useVideoPlayer(
    { uri: url, metadata: title ? { title } : undefined },
    (p) => {
      p.audioMixingMode = 'doNotMix';
      p.staysActiveInBackground = true;
      p.play();
    },
  );

  const { status, error } = useEvent(player, 'statusChange', {
    status: player.status,
  });

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

      {status === 'loading' ? (
        <View style={styles.overlay} pointerEvents="none">
          <Spinner />
        </View>
      ) : null}

      {status === 'error' ? (
        <View style={styles.overlay}>
          <Typography type="body" color="default" align="center">
            No se pudo reproducir este stream.
          </Typography>
          {error?.message ? (
            <Typography
              type="body-xs"
              color="muted"
              align="center"
              style={{ marginTop: 8, paddingHorizontal: 24 }}
            >
              {error.message}
            </Typography>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backWrap: { position: 'absolute', top: 0, left: 12 },
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
