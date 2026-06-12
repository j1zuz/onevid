import { useQuery } from '@tanstack/react-query';
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
  LayoutList,
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
  type PressableStateCallbackType,
  StatusBar as RNStatusBar,
  type StyleProp,
  StyleSheet,
  Text,
  useTVEventHandler,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { EpisodePicker } from '@/components/episode-picker';
import {
  SourcesList,
  sourcesQueryOptions,
  type StreamSource,
} from '@/components/sources-list';
import { tvFocusRing } from '@/hooks/use-tv-focus';
import { API_URL, getAccessToken } from '@/lib/auth';

// Aplica el anillo de foco de TV a un Pressable sin estado de foco propio: usa
// el render-prop de Pressable (`state.focused`, disponible en TV). Fuera de TV
// `tvFocusRing` devuelve null, así que es no-op en móvil/web.
const withRing =
  (base: StyleProp<ViewStyle>) =>
  (state: PressableStateCallbackType): StyleProp<ViewStyle> => [
    base,
    tvFocusRing((state as { focused?: boolean }).focused ?? false),
  ];

type ResolvedStream = { url: string; fileName?: string };

type ResolveState =
  | { kind: 'resolving' }
  | { kind: 'ready'; url: string; fileName?: string }
  | { kind: 'error'; message: string };

// expo-libvlc-player valida la URL con `java.net.URI(source)` (parser estricto
// RFC-2396) ANTES de pasarla a libVLC, y lanza "Invalid source, media could not
// be set" si hay caracteres ilegales sin codificar — aunque el enlace sea válido
// y `fetch`/`android.net.Uri` lo acepten. Percent-encodeamos solo esos
// caracteres (sin tocar `%` para no romper secuencias %XX ya válidas).
function sanitizeUrlForVlc(url: string): string {
  return url
    .replace(/[ "<>\\^`{|}\[\]]/g, (c) => encodeURIComponent(c))
    .replace(/[^\x00-\x7F]/g, (c) => encodeURIComponent(c));
}

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
    return { url: sanitizeUrlForVlc(data.url), fileName: data.fileName };
  }
  return { url: sanitizeUrlForVlc(raw) };
}

const SEEK_STEP_MS = 10_000;
const CONTROLS_HIDE_MS = 4_000;

// User-Agent de navegador: evita 403 de hosts que rechazan el UA por defecto de
// VLC. Se usa tanto en las opciones de libVLC como en la sonda de diagnóstico,
// para que ambos vean exactamente la misma respuesta del host.
const STREAM_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Diagnóstico: consulta la URL ya resuelta (1 byte) para ver qué devuelve el
// host realmente (código HTTP, tipo de contenido, tamaño, redirección). Cuando
// VLC dice "Invalid source, media could not be set" sin pistas, el fallo es de
// red/enlace y esto revela la causa concreta (403 bloqueado, página HTML de
// error, enlace caducado, etc.).
async function probeStreamUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-1', 'User-Agent': STREAM_UA },
    });
    const ct = res.headers.get('content-type') ?? '—';
    const size =
      res.headers.get('content-range') ??
      res.headers.get('content-length') ??
      '—';
    const redirect =
      res.url && res.url !== url ? `\n→ redirige a: ${res.url}` : '';
    return `Diagnóstico: HTTP ${res.status} · ${ct} · ${size}${redirect}`;
  } catch (e) {
    return `Diagnóstico: sin respuesta del host (${
      e instanceof Error ? e.message : 'error de red'
    }).`;
  }
}

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
  const canChangeEpisode = mediaType === 'series' && Boolean(mediaId);

  // Temporada/episodio son estado: al elegir otro episodio se actualizan (y con
  // ellos el subtítulo y las fuentes que pide el SourcePicker).
  const [season, setSeason] = useState(params.season || undefined);
  const [episode, setEpisode] = useState(params.episode || undefined);
  const [episodeTitle, setEpisodeTitle] = useState(
    params.episodeTitle || undefined,
  );
  // Subtítulo: para series "S1E1 · Nombre del episodio".
  const subtitle =
    mediaType === 'series' && season && episode
      ? `S${season}E${episode}${episodeTitle ? ` · ${episodeTitle}` : ''}`
      : undefined;

  // `rawUrl` es estado: al elegir otra fuente lo cambiamos y se re-resuelve.
  const [rawUrl, setRawUrl] = useState(params.url ?? '');
  const [state, setState] = useState<ResolveState>({ kind: 'resolving' });

  // Si llegamos SIN `url`, reproducimos la 1ª fuente disponible: la pedimos aquí
  // con la misma `queryKey` que el SourcePicker (comparte caché con el prefetch
  // del detalle, sin fetch duplicado) y, al resolver, fijamos `rawUrl`. Mientras
  // tanto `LoadingArt` cubre la espera, así que no hay parpadeo del selector.
  const autoPlay = !params.url;
  const sourcesQuery = useQuery({
    ...sourcesQueryOptions(mediaType, mediaId ?? '', season, episode),
    enabled: autoPlay && Boolean(mediaId),
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [episodePickerOpen, setEpisodePickerOpen] = useState(false);

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
      // Sin URL directa: esperamos la 1ª fuente del auto-play.
      if (!autoPlay || !mediaId) {
        setState({ kind: 'error', message: 'Falta la URL del stream.' });
        return;
      }
      if (sourcesQuery.isError) {
        setState({
          kind: 'error',
          message:
            sourcesQuery.error instanceof Error
              ? sourcesQuery.error.message
              : 'No pudimos cargar las fuentes.',
        });
        return;
      }
      const first = sourcesQuery.data?.sources[0];
      if (first) {
        setRawUrl(first.url); // re-dispara este efecto ya con URL.
        return;
      }
      if (sourcesQuery.data) {
        // Respondió, pero ningún addon devolvió fuentes.
        setState({ kind: 'error', message: 'Sin fuentes disponibles' });
        return;
      }
      setState({ kind: 'resolving' }); // fuentes aún cargando.
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
  }, [
    rawUrl,
    autoPlay,
    mediaId,
    sourcesQuery.isError,
    sourcesQuery.error,
    sourcesQuery.data,
  ]);

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
          onChangeEpisode={
            canChangeEpisode ? () => setEpisodePickerOpen(true) : undefined
          }
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
        <Pressable onPress={() => router.back()} style={withRing(styles.backBtn)}>
          <ArrowLeft size={22} color="#fff" />
        </Pressable>
      </SafeAreaView>

      {pickerOpen && mediaId ? (
        <SourcePicker
          type={mediaType}
          id={mediaId}
          season={season}
          episode={episode}
          onSelect={(s: StreamSource) => {
            setPickerOpen(false);
            setRawUrl(s.url);
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}

      {episodePickerOpen && mediaId ? (
        <EpisodePicker
          id={mediaId}
          season={season}
          episode={episode}
          onSelect={({ season: s, episode: e, episodeTitle: t }) => {
            setSeason(s);
            setEpisode(e);
            setEpisodeTitle(t);
            setEpisodePickerOpen(false);
            // Tras elegir episodio, abrimos las fuentes de ese episodio.
            setPickerOpen(true);
          }}
          onClose={() => setEpisodePickerOpen(false)}
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
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.pickerCard}>
        <View style={styles.menuHeader}>
          <Typography type="h5" weight="bold">
            Cambiar fuente
          </Typography>
          <Pressable onPress={onClose} style={withRing(styles.menuClose)}>
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
  onChangeEpisode,
}: {
  url: string;
  title?: string;
  subtitle?: string;
  background?: string;
  logo?: string;
  onChangeSource?: () => void;
  onChangeEpisode?: () => void;
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
  const [probe, setProbe] = useState<string | null>(null);

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

  // Carátula (póster) que tapa el arranque: mejor práctica de Expo para vídeo
  // (mostrar una imagen propia y ocultarla al primer fotograma). En vez de un
  // "loading" animado, mostramos el mismo arte del detalle, estático, y lo
  // fundimos al vídeo en cuanto reproduce — así no se ve ningún loading.
  const coverOpacity = useSharedValue(1);
  const [coverGone, setCoverGone] = useState(false);
  const coverStyle = useAnimatedStyle(() => ({ opacity: coverOpacity.value }));
  useEffect(() => {
    if (!hasPlayed) return;
    coverOpacity.value = withTiming(0, { duration: 260 }, (finished) => {
      if (finished) runOnJS(setCoverGone)(true);
    });
  }, [hasPlayed, coverOpacity]);

  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
  }, []);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  // En TV no hay toque para revelar los controles: cualquier evento del mando
  // los muestra y reinicia el auto-ocultado. No-op fuera de TV.
  useTVEventHandler((evt) => {
    if (evt?.eventType && evt.eventType !== 'focus' && evt.eventType !== 'blur') {
      showControls();
    }
  });

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
  // Mientras carga mostramos el arte (logo). En error NO ocultamos el player:
  // dejamos sus controles normales (incluido "cambiar fuente") y mostramos el
  // error en el centro, seleccionable para copiarlo.
  const showLoading = !hasPlayed && !errorMsg;
  const controlsShown = !!errorMsg || controlsVisible;
  const tracksInfo = errorMsg ? describeTracks(tracks) : undefined;

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
          `:http-user-agent=${STREAM_UA}`,
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
          setProbe(null);
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
          // Sonda del enlace: revela la causa real (403/HTML/caducado/redirección).
          setProbe('Comprobando enlace…');
          probeStreamUrl(url).then(setProbe);
        }}
      />

      {/* Capa táctil para mostrar/ocultar controles (solo en reproducción
          normal: en error los controles quedan fijos). */}
      {!showLoading && !errorMsg ? (
        <Pressable
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

      {/* Carátula que tapa el arranque y se funde al vídeo (sin loading visible) */}
      {!coverGone && !errorMsg ? (
        <Animated.View
          style={[StyleSheet.absoluteFill, coverStyle]}
          pointerEvents="none"
        >
          <LoadingArt background={background} logo={logo} title={title} />
        </Animated.View>
      ) : null}

      {/* Fondo del póster detrás de los controles si falla antes de reproducir
          (el vídeo aún está en negro). */}
      {errorMsg && background ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Image
            source={background}
            contentFit="cover"
            cachePolicy="memory-disk"
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.artScrim} />
        </View>
      ) : null}

      {/* Controles (se mantienen visibles mientras haya error) */}
      {!showLoading && controlsShown ? (
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
                  style={withRing(styles.actionBtn)}
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
                  style={withRing(styles.actionBtn)}
                  onPress={() => {
                    setMenu('subtitle');
                    showControls();
                  }}
                  hitSlop={6}
                >
                  <Captions size={20} color="#fff" />
                </Pressable>
              ) : null}
              {onChangeEpisode ? (
                <Pressable
                  style={withRing(styles.actionBtn)}
                  onPress={() => {
                    onChangeEpisode();
                    showControls();
                  }}
                  hitSlop={6}
                >
                  <LayoutList size={20} color="#fff" />
                </Pressable>
              ) : null}
              {onChangeSource ? (
                <Pressable
                  style={withRing(styles.actionBtn)}
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
                style={withRing(styles.actionBtn)}
                onPress={() => playerRef.current?.startPictureInPicture?.()}
                hitSlop={6}
              >
                <PictureInPicture2 size={20} color="#fff" />
              </Pressable>
            </View>
          </View>

          {/* Centro: si hay error, el mensaje (seleccionable para copiarlo);
              si no, retroceder 10s · play/pausa · adelantar 10s. */}
          {errorMsg ? (
            <View style={styles.centerRow} pointerEvents="box-none">
              <View style={styles.errorBox} pointerEvents="auto">
                <Typography type="body" weight="semibold" align="center">
                  No se pudo reproducir
                </Typography>
                <Typography
                  type="body-sm"
                  color="muted"
                  align="center"
                  style={{ marginTop: 6 }}
                >
                  {errorMsg}
                </Typography>
                {rawError ? (
                  <Text style={styles.errorDetail} selectable>
                    {rawError}
                  </Text>
                ) : null}
                {tracksInfo ? (
                  <Text style={styles.tracksDetail} selectable>
                    {tracksInfo}
                  </Text>
                ) : null}
                {probe ? (
                  <Text style={styles.tracksDetail} selectable>
                    {probe}
                  </Text>
                ) : null}
                <Text style={styles.urlDetail} selectable numberOfLines={3}>
                  {url}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.centerRow} pointerEvents="box-none">
              <Pressable
                style={withRing(styles.ctrlBtn)}
                onPress={() => skip(-SEEK_STEP_MS)}
                hitSlop={8}
              >
                <RotateCcw size={26} color="#fff" />
              </Pressable>
              <Pressable
                style={withRing(styles.playBtn)}
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
                style={withRing(styles.ctrlBtn)}
                onPress={() => skip(SEEK_STEP_MS)}
                hitSlop={8}
              >
                <RotateCw size={26} color="#fff" />
              </Pressable>
            </View>
          )}

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
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.menuCard}>
        <View style={styles.menuHeader}>
          <Text style={styles.menuTitle}>
            {kind === 'audio' ? 'Pista de audio' : 'Subtítulos'}
          </Text>
          <Pressable onPress={onClose} style={withRing(styles.menuClose)}>
            <X size={20} color="#fff" />
          </Pressable>
        </View>
        {allowOff ? (
          <Pressable style={withRing(styles.menuItem)} onPress={() => onSelect(null)}>
            <Text style={styles.menuItemText}>Desactivados</Text>
            {selectedId == null ? <Check size={18} color="#7CFC9B" /> : null}
          </Pressable>
        ) : null}
        {tracks.map((t) => (
          <Pressable
            key={t.id}
            style={withRing(styles.menuItem)}
            onPress={() => onSelect(t.id)}
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
  // "Invalid source, media could not be set" lo lanza expo-libvlc-player cuando
  // la URL no pasa el parser estricto java.net.URI (caracteres ilegales sin
  // codificar) — NO es bloqueo del host (el enlace suele estar vivo). Ya saneamos
  // la URL antes de reproducir, así que esto debería ser raro.
  if (e.includes('invalid source') || e.includes('could not be set')) {
    return 'El reproductor no pudo abrir esta fuente (URL con formato no válido). Intenta con otra.';
  }
  // 403/forbidden → el host bloquea la reproducción (UA/Referer) o el enlace expiró.
  if (e.includes('403') || e.includes('forbidden')) {
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

// Resumen de las pistas (códecs) detectadas por VLC antes del fallo. Sirve para
// verificar si la fuente falla por un códec de vídeo/audio concreto o si ni
// siquiera llegó a abrir pistas (apunta a red/enlace).
function describeTracks(tracks?: MediaTracks): string | undefined {
  if (!tracks) return undefined;
  const fmt = (list: Track[]) =>
    list.map((t) => t.name?.trim() || `pista ${t.id}`).join(', ');
  const lines: string[] = [];
  if (tracks.video.length) lines.push(`Vídeo: ${fmt(tracks.video)}`);
  if (tracks.audio.length) lines.push(`Audio: ${fmt(tracks.audio)}`);
  if (tracks.subtitle.length) lines.push(`Subtítulos: ${fmt(tracks.subtitle)}`);
  if (lines.length === 0) {
    return 'No se detectaron pistas antes del fallo (posible problema de red, enlace o resolución, no de códec).';
  }
  return lines.join('\n');
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
        // Mismo tipo de tarjeta que los errores de reproducción dentro del
        // player, para que "Sin fuentes disponibles" se vea igual que todo lo
        // demás (no texto suelto sobre el arte).
        <View style={styles.artCenter}>
          <View style={styles.errorBox}>
            <Typography type="body" weight="semibold" color="default" align="center">
              No se pudo reproducir
            </Typography>
            <Typography
              type="body-sm"
              color="muted"
              align="center"
              style={{ marginTop: 6 }}
            >
              {error}
            </Typography>
            {detail ? (
              <Text style={styles.errorDetail} selectable numberOfLines={4}>
                {detail}
              </Text>
            ) : null}
          </View>
        </View>
      ) : (
        // Logo pulsando mientras carga (como antes). Esta carátula tapa el
        // arranque del vídeo y se funde a él al primer fotograma.
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
  tracksDetail: {
    marginTop: 10,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    textAlign: 'center',
  },
  urlDetail: {
    marginTop: 10,
    color: 'rgba(255,255,255,0.35)',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlign: 'center',
  },
  errorBox: {
    maxWidth: 520,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
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
