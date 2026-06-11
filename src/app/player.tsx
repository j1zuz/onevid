import {
  LibVlcPlayerView,
  type LibVlcPlayerViewRef,
  type MediaTracks,
  type Track,
} from 'expo-libvlc-player';
import { Image } from 'expo-image';
import * as NavigationBar from 'expo-navigation-bar';
import { router, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Typography } from 'heroui-native';
import {
  ArrowLeft,
  Captions,
  Check,
  Languages,
  ListVideo,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  X,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  StatusBar as RNStatusBar,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { SourcesList, type StreamSource } from '@/components/sources-list';
import { tvFocusRing } from '@/hooks/use-tv-focus';
import { API_URL, getAccessToken } from '@/lib/auth';

// Anillo de foco para botones del reproductor en TV. Patrón Pressable-callback:
// `style={focusStyle(base)}` añade el borde azul al enfocar con el control
// remoto. Fuera de TV `tvFocusRing` devuelve null, así que es un no-op.
function focusStyle(base: StyleProp<ViewStyle>) {
  return (state: { focused?: boolean }): StyleProp<ViewStyle> => [
    base,
    tvFocusRing(state.focused ?? false),
  ];
}

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

const SEEK_STEP_MS = 10_000;
const CONTROLS_HIDE_MS = 4_000;

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Elige por defecto la pista de audio en español; si no hay, la primera.
function pickDefaultAudio(audio: Track[]): number | null {
  if (audio.length === 0) return null;
  const es = audio.find((t) =>
    /espa|castell|spanish|latino|\bes\b|lat/i.test(t.name ?? ''),
  );
  return (es ?? audio[0]).id;
}

export default function PlayerScreen() {
  const params = useLocalSearchParams<{
    url: string;
    title?: string;
    background?: string;
    logo?: string;
    type?: string;
    id?: string;
    season?: string;
    episode?: string;
    episodeTitle?: string;
  }>();
  const title = params.title;
  const background = params.background || undefined;
  const logo = params.logo || undefined;
  // type/id permiten reabrir la lista de fuentes desde el reproductor.
  const mediaType = params.type === 'series' ? 'series' : 'movie';
  const mediaId = params.id || undefined;
  const canChangeSource = Boolean(mediaId);
  // Subtítulo: para series "S1E1 · Nombre del episodio".
  const subtitle =
    mediaType === 'series' && params.season && params.episode
      ? `S${params.season}E${params.episode}${
          params.episodeTitle ? ` · ${params.episodeTitle}` : ''
        }`
      : undefined;

  // `rawUrl` es estado: al elegir otra fuente lo cambiamos y se re-resuelve.
  const [rawUrl, setRawUrl] = useState(params.url ?? '');
  const [state, setState] = useState<ResolveState>({ kind: 'resolving' });
  const [pickerOpen, setPickerOpen] = useState(false);

  // Auto-rotate to landscape while the player is mounted; restore on exit.
  // En TV la pantalla ya es landscape fija, así que no tocamos la orientación.
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

  // Pantalla completa inmersiva: oculta barra de estado y de navegación mientras
  // el reproductor está montado; las restaura al salir.
  useEffect(() => {
    RNStatusBar.setHidden(true, 'fade');
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('hidden').catch(() => {
        /* ignore */
      });
    }
    return () => {
      RNStatusBar.setHidden(false, 'fade');
      if (Platform.OS === 'android') {
        NavigationBar.setVisibilityAsync('visible').catch(() => {
          /* ignore */
        });
      }
    };
  }, []);

  useEffect(() => {
    if (!rawUrl) {
      setState({ kind: 'error', message: 'Falta la URL del stream.' });
      return;
    }
    let cancelled = false;
    setState({ kind: 'resolving' });
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
          key={state.url}
          url={state.url}
          title={title}
          subtitle={subtitle}
          background={background}
          logo={logo}
          onChangeSource={canChangeSource ? () => setPickerOpen(true) : undefined}
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
        <Pressable
          onPress={() => router.back()}
          style={focusStyle(styles.backBtn)}
        >
          <ArrowLeft size={22} color="#fff" />
        </Pressable>
      </SafeAreaView>

      {pickerOpen && mediaId ? (
        <SourcePicker
          type={mediaType}
          id={mediaId}
          season={params.season || undefined}
          episode={params.episode || undefined}
          onSelect={(s: StreamSource) => {
            setPickerOpen(false);
            setRawUrl(s.url);
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </View>
  );
}

function SourcePicker({
  type,
  id,
  season,
  episode,
  onSelect,
  onClose,
}: {
  type: 'movie' | 'series';
  id: string;
  season?: string;
  episode?: string;
  onSelect: (source: StreamSource) => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.menuRoot}>
      <Pressable
        focusable={false}
        style={StyleSheet.absoluteFill}
        onPress={onClose}
      />
      <View style={styles.pickerCard}>
        <View style={styles.menuHeader}>
          <Typography type="h5" weight="bold">
            Cambiar fuente
          </Typography>
          <Pressable onPress={onClose} style={focusStyle(styles.menuClose)}>
            <X size={20} color="#fff" />
          </Pressable>
        </View>
        <SourcesList
          type={type}
          id={id}
          season={season}
          episode={episode}
          onSelect={onSelect}
        />
      </View>
    </View>
  );
}

function Player({
  url,
  title,
  subtitle,
  background,
  logo,
  onChangeSource,
}: {
  url: string;
  title?: string;
  subtitle?: string;
  background?: string;
  logo?: string;
  onChangeSource?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const playerRef = useRef<LibVlcPlayerViewRef>(null);
  const bufferTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const [playing, setPlaying] = useState(true);
  const [buffering, setBuffering] = useState(true);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);

  const [time, setTime] = useState(0); // ms
  const [duration, setDuration] = useState(0); // ms
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);
  const barWidth = useRef(1);

  const [tracks, setTracks] = useState<MediaTracks>({
    audio: [],
    video: [],
    subtitle: [],
  });
  const [audioId, setAudioId] = useState<number | null>(null);
  const [subtitleId, setSubtitleId] = useState<number | null>(null);
  const [menu, setMenu] = useState<'audio' | 'subtitle' | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);

  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
  }, []);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    scheduleHide();
    return () => {
      clearTimeout(hideTimer.current);
      clearTimeout(bufferTimer.current);
    };
  }, [scheduleHide]);

  const togglePlay = useCallback(() => {
    if (playing) playerRef.current?.pause();
    else playerRef.current?.play();
    showControls();
  }, [playing, showControls]);

  const skip = useCallback(
    (deltaMs: number) => {
      const next = Math.max(0, Math.min(time + deltaMs, duration || time + deltaMs));
      playerRef.current?.seek(next, 'time');
      setTime(next);
      showControls();
    },
    [time, duration, showControls],
  );

  // --- barra de progreso arrastrable ---
  const onBarLayout = (e: LayoutChangeEvent) => {
    barWidth.current = Math.max(1, e.nativeEvent.layout.width);
  };
  const fractionFromX = (x: number) =>
    Math.max(0, Math.min(x / barWidth.current, 1));
  const beginScrub = (e: GestureResponderEvent) => {
    if (!duration) return;
    setScrubbing(true);
    setScrubTime(fractionFromX(e.nativeEvent.locationX) * duration);
    showControls();
  };
  const moveScrub = (e: GestureResponderEvent) => {
    if (!duration) return;
    setScrubTime(fractionFromX(e.nativeEvent.locationX) * duration);
  };
  const endScrub = () => {
    if (duration) {
      playerRef.current?.seek(scrubTime, 'time');
      setTime(scrubTime);
    }
    setScrubbing(false);
    scheduleHide();
  };

  const progress = scrubbing ? scrubTime : time;
  const pct = duration > 0 ? Math.min(progress / duration, 1) : 0;
  const showArt = !hasPlayed || !!errorMsg;

  return (
    <>
      <LibVlcPlayerView
        ref={playerRef}
        style={StyleSheet.absoluteFill}
        // `null` libera el player (no crear media con URL vacía → evita el
        // error nativo "media could not be set").
        source={url?.trim() ? url : null}
        // Caching de red más alto + reconexión HTTP → menos cortes y recupera
        // fuentes que cierran la conexión a mitad. El User-Agent de navegador
        // evita que hosts que rechazan el UA por defecto de VLC respondan 403
        // (la causa más común de "media could not be set"). Tunable.
        options={[
          ':network-caching=3000',
          ':file-caching=3000',
          ':http-reconnect',
          ':http-user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        ]}
        contentFit="contain"
        autoplay
        pictureInPicture
        tracks={{
          audio: audioId ?? undefined,
          subtitle: subtitleId ?? undefined,
        }}
        onBuffering={() => {
          setBuffering(true);
          clearTimeout(bufferTimer.current);
          // VLC dispara Buffering repetidamente; lo limpiamos con un tope.
          bufferTimer.current = setTimeout(() => setBuffering(false), 1_200);
        }}
        onPlaying={() => {
          setBuffering(false);
          setPlaying(true);
          setHasPlayed(true);
          setErrorMsg(null);
          setRawError(null);
        }}
        onPaused={() => setPlaying(false)}
        onStopped={() => setPlaying(false)}
        onFirstPlay={({ length }) => setDuration(length)}
        onTimeChanged={({ value }) => {
          if (!scrubbing) setTime(value);
        }}
        onESAdded={(media) => {
          setTracks(media);
          setAudioId((prev) => prev ?? pickDefaultAudio(media.audio));
        }}
        onEncounteredError={({ message }) => {
          setErrorMsg(humanizePlaybackError(message));
          setRawError(message || 'EncounteredError (sin mensaje)');
        }}
      />

      {/* Capa táctil para mostrar/ocultar controles. focusable={false} para que
          el D-pad de TV no se quede atrapado en esta capa a pantalla completa. */}
      {!showArt ? (
        <Pressable
          focusable={false}
          style={StyleSheet.absoluteFill}
          onPress={() =>
            controlsVisible ? setControlsVisible(false) : showControls()
          }
        />
      ) : null}

      {/* Spinner de buffering durante la reproducción */}
      {hasPlayed && buffering && !errorMsg ? (
        <View style={styles.bufferWrap} pointerEvents="none">
          <BufferingPulse />
        </View>
      ) : null}

      {showArt ? (
        <LoadingArt
          background={background}
          logo={logo}
          title={title}
          error={errorMsg ?? undefined}
          detail={rawError ?? undefined}
        />
      ) : null}

      {/* Controles */}
      {!showArt && controlsVisible ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {/* Arriba: título (izquierda) + acciones (derecha) */}
          <View
            style={[
              styles.topBar,
              {
                paddingTop: insets.top + 6,
                paddingLeft: insets.left + 60,
                paddingRight: insets.right + 12,
              },
            ]}
            pointerEvents="box-none"
          >
            <View style={styles.topTitleBlock} pointerEvents="none">
              {title ? (
                <Text style={styles.topTitle} numberOfLines={1}>
                  {title}
                </Text>
              ) : null}
              {subtitle ? (
                <Text style={styles.topSubtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <View style={styles.topActions}>
              {tracks.audio.length > 0 ? (
                <Pressable
                  style={focusStyle(styles.actionBtn)}
                  onPress={() => {
                    setMenu('audio');
                    showControls();
                  }}
                  hitSlop={6}
                >
                  <Languages size={20} color="#fff" />
                </Pressable>
              ) : null}
              {tracks.subtitle.length > 0 ? (
                <Pressable
                  style={focusStyle(styles.actionBtn)}
                  onPress={() => {
                    setMenu('subtitle');
                    showControls();
                  }}
                  hitSlop={6}
                >
                  <Captions size={20} color="#fff" />
                </Pressable>
              ) : null}
              {onChangeSource ? (
                <Pressable
                  style={focusStyle(styles.actionBtn)}
                  onPress={() => {
                    onChangeSource();
                    showControls();
                  }}
                  hitSlop={6}
                >
                  <ListVideo size={20} color="#fff" />
                </Pressable>
              ) : null}
              <Pressable
                style={focusStyle(styles.actionBtn)}
                onPress={() => playerRef.current?.startPictureInPicture?.()}
                hitSlop={6}
              >
                <PictureInPicture2 size={20} color="#fff" />
              </Pressable>
            </View>
          </View>

          {/* Centro: retroceder 10s · play/pausa · adelantar 10s */}
          <View style={styles.centerRow} pointerEvents="box-none">
            <Pressable
              style={focusStyle(styles.ctrlBtn)}
              onPress={() => skip(-SEEK_STEP_MS)}
              hitSlop={8}
            >
              <RotateCcw size={26} color="#fff" />
            </Pressable>
            <Pressable
              style={focusStyle(styles.playBtn)}
              onPress={togglePlay}
              hitSlop={8}
              hasTVPreferredFocus
            >
              {playing ? (
                <Pause size={32} color="#fff" fill="#fff" />
              ) : (
                <Play size={32} color="#fff" fill="#fff" />
              )}
            </Pressable>
            <Pressable
              style={focusStyle(styles.ctrlBtn)}
              onPress={() => skip(SEEK_STEP_MS)}
              hitSlop={8}
            >
              <RotateCw size={26} color="#fff" />
            </Pressable>
          </View>

          {/* Barra inferior tipo "pill" */}
          <View
            style={[
              styles.pill,
              {
                left: insets.left + 16,
                right: insets.right + 16,
                bottom: insets.bottom + 14,
              },
            ]}
          >
            <Text style={styles.timeText}>{formatTime(progress)}</Text>

            <View
              style={styles.barTouch}
              onLayout={onBarLayout}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={beginScrub}
              onResponderMove={moveScrub}
              onResponderRelease={endScrub}
              onResponderTerminate={endScrub}
            >
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${pct * 100}%` }]} />
                <View style={[styles.barThumb, { left: `${pct * 100}%` }]} />
              </View>
            </View>

            <Text style={styles.timeText}>{formatTime(duration)}</Text>
          </View>
        </View>
      ) : null}

      {/* Menú de selección de pista */}
      {menu ? (
        <TrackMenu
          kind={menu}
          tracks={menu === 'audio' ? tracks.audio : tracks.subtitle}
          selectedId={menu === 'audio' ? audioId : subtitleId}
          allowOff={menu === 'subtitle'}
          onSelect={(id) => {
            if (menu === 'audio') setAudioId(id);
            else setSubtitleId(id);
            setMenu(null);
            showControls();
          }}
          onClose={() => {
            setMenu(null);
            showControls();
          }}
        />
      ) : null}
    </>
  );
}

function TrackMenu({
  kind,
  tracks,
  selectedId,
  allowOff,
  onSelect,
  onClose,
}: {
  kind: 'audio' | 'subtitle';
  tracks: Track[];
  selectedId: number | null;
  allowOff: boolean;
  onSelect: (id: number | null) => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.menuRoot}>
      <Pressable
        focusable={false}
        style={StyleSheet.absoluteFill}
        onPress={onClose}
      />
      <View style={styles.menuCard}>
        <View style={styles.menuHeader}>
          <Text style={styles.menuTitle}>
            {kind === 'audio' ? 'Pista de audio' : 'Subtítulos'}
          </Text>
          <Pressable onPress={onClose} style={focusStyle(styles.menuClose)}>
            <X size={20} color="#fff" />
          </Pressable>
        </View>
        {allowOff ? (
          <Pressable
            style={focusStyle(styles.menuItem)}
            onPress={() => onSelect(null)}
            hasTVPreferredFocus={selectedId == null}
          >
            <Text style={styles.menuItemText}>Desactivados</Text>
            {selectedId == null ? <Check size={18} color="#7CFC9B" /> : null}
          </Pressable>
        ) : null}
        {tracks.map((t) => (
          <Pressable
            key={t.id}
            style={focusStyle(styles.menuItem)}
            onPress={() => onSelect(t.id)}
            hasTVPreferredFocus={selectedId === t.id}
          >
            <Text style={styles.menuItemText} numberOfLines={1}>
              {t.name || `Pista ${t.id}`}
            </Text>
            {selectedId === t.id ? <Check size={18} color="#7CFC9B" /> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function humanizePlaybackError(raw?: string): string {
  const e = (raw ?? '').toLowerCase();
  // VLC: "Invalid source, media could not be set" / 403 → el host suele
  // bloquear la reproducción (UA/Referer) o el enlace ya expiró.
  if (
    e.includes('invalid source') ||
    e.includes('could not be set') ||
    e.includes('403') ||
    e.includes('forbidden')
  ) {
    return 'La fuente bloqueó la reproducción o el enlace expiró. Vuelve atrás y elige otra.';
  }
  if (e.includes('404') || e.includes('http') || e.includes('not found')) {
    return 'La fuente no está disponible o expiró. Vuelve atrás y elige otra.';
  }
  if (e.includes('network') || e.includes('timeout') || e.includes('connect')) {
    return 'Problema de conexión al cargar el stream. Revisa tu red e intenta otra fuente.';
  }
  return 'No se pudo reproducir esta fuente. Intenta con otra.';
}

function BufferingPulse() {
  const pulse = useSharedValue(0.4);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return <Animated.View style={[styles.spinner, style]} />;
}

function LoadingArt({
  background,
  logo,
  title,
  error,
  detail,
}: {
  background?: string;
  logo?: string;
  title?: string;
  error?: string;
  detail?: string;
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
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {/* Velo sutil solo para legibilidad del logo/errores (sin blur). */}
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
          {detail ? (
            <Text style={styles.errorDetail} selectable numberOfLines={4}>
              {detail}
            </Text>
          ) : null}
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
  errorDetail: {
    marginTop: 14,
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlign: 'center',
  },
  bufferWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: '#fff',
    borderTopColor: 'transparent',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  topTitleBlock: {
    flex: 1,
  },
  topTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 6,
  },
  topSubtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 6,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  centerRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 36,
  },
  ctrlBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  playBtn: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  pill: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 30,
    backgroundColor: 'rgba(18,18,18,0.72)',
  },
  timeText: {
    color: '#fff',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    minWidth: 42,
    textAlign: 'center',
  },
  barTouch: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  barTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
  },
  barFill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#fff',
  },
  barThumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    marginLeft: -7,
    backgroundColor: '#fff',
  },
  menuRoot: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 30,
  },
  menuCard: {
    width: '70%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: '#161616',
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  pickerCard: {
    width: '86%',
    maxWidth: 560,
    maxHeight: '88%',
    backgroundColor: '#161616',
    borderRadius: 16,
    paddingTop: 8,
    overflow: 'hidden',
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  menuTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  menuClose: { padding: 4 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
  },
  menuItemText: { color: '#fff', fontSize: 14, flex: 1 },
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
