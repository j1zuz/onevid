import { useQuery } from '@tanstack/react-query';
import LibVlcPlayerModule, {
  LibVlcPlayerView,
  type LibVlcPlayerViewRef,
  type MediaTracks,
  type Track,
} from 'expo-libvlc-player';
import { Image } from 'expo-image';
import * as NavigationBar from 'expo-navigation-bar';
import { router, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Slider, Typography } from 'heroui-native';
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
  type PressableStateCallbackType,
  StatusBar as RNStatusBar,
  type StyleProp,
  StyleSheet,
  Text,
  useTVEventHandler,
  useWindowDimensions,
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
  | { kind: 'resolving' } // carga inicial de la fuente
  | { kind: 'switching'; attempt: number; total: number } // probando otra fuente
  | { kind: 'ready'; url: string; fileName?: string }
  | { kind: 'exhausted'; total: number } // todas las fuentes fallaron
  | { kind: 'error'; message: string }; // error duro (sin lista, sin URL)

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

// `fetch` con tope de tiempo (AbortController). Imprescindible para que una
// sonda/redirección/resolución contra un host muerto o colgado no deje el flujo
// esperando: al vencer aborta y el caller hace fallback a otra fuente.
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function resolveStreamUrl(raw: string): Promise<ResolvedStream> {
  let url: string;
  let fileName: string | undefined;
  if (raw.startsWith('/api/')) {
    const sep = raw.includes('?') ? '&' : '?';
    const token = await getAccessToken();
    const res = await fetchWithTimeout(
      `${API_URL}${raw}${sep}redirect=0`,
      {
        headers: {
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      8_000,
    );
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
    url = sanitizeUrlForVlc(data.url);
    fileName = data.fileName;
  } else {
    url = sanitizeUrlForVlc(raw);
  }
  // Pre-resolver la redirección: muchos hosts devuelven una URL que a su vez
  // redirige (302), y libVLC no siempre la sigue limpio → fallaba antes del
  // primer fotograma, disparaba el fallback y REMONTABA el player (se veía la
  // carátula dos veces / "reinicio"). Seguimos la redirección aquí con `fetch` y
  // le entregamos a VLC la URL FINAL, así abre a la primera y sin doble arranque.
  const final = await resolveRedirect(url);
  return { url: final ? sanitizeUrlForVlc(final) : url, fileName };
}

const SEEK_STEP_MS = 10_000;
const CONTROLS_HIDE_MS = 4_000;
// Watchdog en DOS fases (las fuentes debrid/torbox tardan en arrancar):
//  • START: si en este tiempo NO hay ni una señal de vida (ninguna pista
//    detectada), la fuente está muerta/colgada → fallback.
//  • FIRST_FRAME: en cuanto VLC detecta pistas (onESAdded) la fuente es VÁLIDA y
//    solo está buffering — le damos mucho más margen para el primer fotograma en
//    vez de matarla. Antes un watchdog único de 10 s descartaba fuentes que SÍ
//    abrían (detectaban pistas) pero tardaban 12-15 s en dar imagen.
const PLAYBACK_START_TIMEOUT_MS = 20_000;
const PLAYBACK_FIRST_FRAME_TIMEOUT_MS = 30_000;
// Elección manual del usuario: le damos mucho más margen "sin pistas" antes de
// saltar, porque pidió ESA fuente explícitamente (p. ej. torbox lento de arrancar).
const PLAYBACK_MANUAL_TIMEOUT_MS = 35_000;

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
    const res = await fetchWithTimeout(
      url,
      { method: 'GET', headers: { Range: 'bytes=0-1', 'User-Agent': STREAM_UA } },
      6_000,
    );
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

// Algunos hosts entregan la URL final por redirección (302) y libVLC no siempre
// la sigue, aunque `fetch` sí lo hace. Seguimos la redirección con el mismo UA y,
// si el host responde OK con una URL distinta, devolvemos esa URL final para
// dársela directamente a VLC. Best-effort: ante cualquier fallo devolvemos null.
async function resolveRedirect(url: string): Promise<string | null> {
  try {
    // Tope corto: si el host no responde rápido, no merece la pena esperar —
    // saltamos a la siguiente fuente en vez de colgar el fallback.
    const res = await fetchWithTimeout(
      url,
      { method: 'GET', headers: { Range: 'bytes=0-1', 'User-Agent': STREAM_UA } },
      4_000,
    );
    if (res.ok && res.url && res.url !== url) return res.url;
    return null;
  } catch {
    return null;
  }
}

// Siguiente fuente no probada, buscando hacia delante desde la actual (con
// envoltura al inicio). Devuelve null cuando todas están en `tried`.
function pickNextSource(
  sources: StreamSource[],
  tried: Set<string>,
  currentUrl: string,
): StreamSource | null {
  const n = sources.length;
  if (n === 0) return null;
  const base = sources.findIndex((s) => s.url === currentUrl); // -1 si no está
  for (let k = 1; k <= n; k++) {
    const s = sources[(((base + k) % n) + n) % n];
    if (s && !tried.has(s.url)) return s;
  }
  return null;
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

  // `rawUrl` es la URL cruda de la fuente que se está intentando reproducir. El
  // auto-fallback la reapunta a la siguiente fuente cuando una falla.
  const [rawUrl, setRawUrl] = useState(params.url ?? '');
  const [state, setState] = useState<ResolveState>({ kind: 'resolving' });
  // ¿La fuente actual la eligió el usuario a mano? Le damos más paciencia antes
  // de auto-saltar (respeta su elección). El auto-fallback lo pone en false.
  const [manualSource, setManualSource] = useState(false);

  // Pedimos SIEMPRE la lista de fuentes (no solo en auto-play): la necesitamos
  // para el fallback automático también cuando se entra con una fuente concreta.
  // Comparte `queryKey` (y caché) con el prefetch del detalle y el SourcePicker,
  // así que en la práctica no hay fetch duplicado.
  const autoPlay = !params.url;
  const sourcesQuery = useQuery({
    ...sourcesQueryOptions(mediaType, mediaId ?? '', season, episode),
    enabled: Boolean(mediaId),
  });
  const sources = sourcesQuery.data?.sources ?? [];
  const canFallback = sources.length > 0;

  // Control del fallback. Refs porque los leen callbacks async (señal de fallo de
  // VLC, watchdog) y no deben capturar valores obsoletos ni provocar renders.
  const triedUrls = useRef<Set<string>>(new Set()); // fuentes ya fallidas
  // Refs "último valor" para leer en callbacks async (señal de fallo de VLC,
  // watchdog) sin capturar valores obsoletos. Se sincronizan tras cada render.
  const sourcesRef = useRef(sources);
  const rawUrlRef = useRef(rawUrl);
  const stateKindRef = useRef(state.kind);
  useEffect(() => {
    sourcesRef.current = sources;
    rawUrlRef.current = rawUrl;
    stateKindRef.current = state.kind;
  });

  // Al cambiar la lista de fuentes (p. ej. otro episodio) reiniciamos lo probado.
  useEffect(() => {
    triedUrls.current = new Set();
  }, [sourcesQuery.data]);

  // Marca la fuente actual como fallida y salta a la siguiente no probada; si no
  // quedan, agota (muestra el error final). Lee refs → estable.
  const advanceToNextSource = useCallback(() => {
    const list = sourcesRef.current;
    const raw = rawUrlRef.current;
    if (raw) triedUrls.current.add(raw);
    const next = pickNextSource(list, triedUrls.current, raw);
    if (next) {
      const attempt = Math.min(triedUrls.current.size + 1, list.length || 1);
      setManualSource(false); // el salto automático no es elección manual.
      setState({ kind: 'switching', attempt, total: list.length });
      setRawUrl(next.url);
    } else {
      setState({ kind: 'exhausted', total: list.length });
    }
  }, []);

  // Señal desde el reproductor: la fuente actual no es reproducible → siguiente.
  // (La redirección ya se resolvió en `resolveStreamUrl`, así que aquí no hay
  // reintento: o reprodujo, o saltamos de fuente. Sin remontajes extra.)
  const handleUnplayable = useCallback(() => {
    if (
      stateKindRef.current === 'switching' ||
      stateKindRef.current === 'exhausted'
    ) {
      return; // ya avanzando: ignora señales tardías del player saliente.
    }
    advanceToNextSource();
  }, [advanceToNextSource]);

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
    // No reseteamos a 'resolving' aquí: durante un salto el estado ya es
    // 'switching' (con su contador) y queremos conservarlo.
    let cancelled = false;
    resolveStreamUrl(rawUrl)
      .then(({ url, fileName }) => {
        if (cancelled) return;
        setState({ kind: 'ready', url, fileName });
      })
      .catch(() => {
        // Fallo al resolver (DNS/403 del backend): también dispara el fallback.
        if (!cancelled) advanceToNextSource();
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
    advanceToNextSource,
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
          startTimeoutMs={
            manualSource
              ? PLAYBACK_MANUAL_TIMEOUT_MS
              : PLAYBACK_START_TIMEOUT_MS
          }
          onUnplayable={canFallback ? handleUnplayable : undefined}
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
          status={
            state.kind === 'switching'
              ? `Probando otra fuente… (${state.attempt}/${state.total})`
              : undefined
          }
          error={
            state.kind === 'error'
              ? state.message
              : state.kind === 'exhausted'
                ? `Ninguna de las ${state.total} fuentes disponibles se pudo reproducir. Vuelve atrás e inténtalo más tarde.`
                : undefined
          }
        />
      )}

      {/* Botón de atrás solo durante la carga/error previo al player; ya
          reproduciendo, vive en la barra superior de controles (se oculta
          junto con ellos). */}
      {state.kind !== 'ready' ? (
        <SafeAreaView
          edges={['top']}
          style={styles.backWrap}
          pointerEvents="box-none"
        >
          <Pressable onPress={() => router.back()} style={withRing(styles.backBtn)}>
            <ArrowLeft size={22} color="#fff" />
          </Pressable>
        </SafeAreaView>
      ) : null}

      {pickerOpen && mediaId ? (
        <SourcePicker
          type={mediaType}
          id={mediaId}
          season={season}
          episode={episode}
          selectedUrl={rawUrl}
          onSelect={(s: StreamSource) => {
            setPickerOpen(false);
            // Elección explícita: la hacemos reintentar (quita su marca de
            // fallida), le damos más paciencia y el fallback continúa desde ahí.
            triedUrls.current.delete(s.url);
            setManualSource(true);
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
  selectedUrl,
}: {
  type: 'movie' | 'series';
  id: string;
  season?: string;
  episode?: string;
  onSelect: (source: StreamSource) => void;
  onClose: () => void;
  selectedUrl?: string;
}) {
  // Ancho concreto en px (no '86%'): evita que la tarjeta colapse y el texto se
  // parta a un carácter por línea en el overlay sobre el reproductor horizontal.
  const { width: winWidth } = useWindowDimensions();
  const cardWidth = Math.min(560, Math.round(winWidth * 0.86));
  return (
    <View style={styles.menuRoot}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={[styles.pickerCard, { width: cardWidth }]}>
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
          selectedUrl={selectedUrl}
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
  startTimeoutMs = PLAYBACK_START_TIMEOUT_MS,
  onUnplayable,
  onChangeSource,
  onChangeEpisode,
}: {
  url: string;
  title?: string;
  subtitle?: string;
  background?: string;
  logo?: string;
  startTimeoutMs?: number;
  onUnplayable?: () => void;
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
  // Auto-fallback: se dispara como mucho una vez por fuente. El ref se reinicia
  // solo en cada remontaje (key={url}). `startTimer` es el watchdog de arranque y
  // `firstFrameRef` deja leer el primer fotograma dentro de callbacks.
  const startTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const firedUnplayable = useRef(false);
  const firstFrameRef = useRef(false);
  const esAddedRef = useRef(false); // pistas detectadas → fuente válida

  const [playing, setPlaying] = useState(true);
  const [buffering, setBuffering] = useState(true);
  const [hasPlayed, setHasPlayed] = useState(false);
  // `firstFrame` = el vídeo ya está mostrando imagen de verdad (el tiempo
  // avanza). VLC emite "Playing" antes de pintar el primer fotograma, así que
  // no nos sirve para fundir la carátula: usamos el avance real del tiempo.
  const [firstFrame, setFirstFrame] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const [probe, setProbe] = useState<string | null>(null);

  const [time, setTime] = useState(0); // ms
  const [duration, setDuration] = useState(0); // ms
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);

  const [tracks, setTracks] = useState<MediaTracks>({
    audio: [],
    video: [],
    subtitle: [],
  });
  const [audioId, setAudioId] = useState<number | null>(null);
  const [subtitleId, setSubtitleId] = useState<number | null>(null);
  const [menu, setMenu] = useState<'audio' | 'subtitle' | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  // PiP solo se ofrece si el dispositivo lo soporta (los emuladores casi nunca
  // lo soportan), para no mostrar un botón muerto.
  const [pipSupported] = useState(() => {
    try {
      return LibVlcPlayerModule.isPictureInPictureSupported();
    } catch {
      return false;
    }
  });

  // Carátula (póster) que tapa el arranque: mejor práctica de Expo para vídeo
  // (mostrar una imagen propia y ocultarla al primer fotograma). En vez de un
  // "loading" animado, mostramos el mismo arte del detalle, estático, y lo
  // fundimos al vídeo en cuanto reproduce — así no se ve ningún loading.
  const coverOpacity = useSharedValue(1);
  const [coverGone, setCoverGone] = useState(false);
  const coverStyle = useAnimatedStyle(() => ({ opacity: coverOpacity.value }));
  // Fundimos la carátula solo cuando hay imagen real en pantalla (firstFrame),
  // no en el evento "Playing" de VLC: así nunca se ve negro ni spinner antes
  // del vídeo. La carátula (logo en pulse) cubre todo el buffering inicial.
  useEffect(() => {
    if (!firstFrame) return;
    coverOpacity.value = withTiming(0, { duration: 260 }, (finished) => {
      if (finished) runOnJS(setCoverGone)(true);
    });
  }, [firstFrame, coverOpacity]);
  // Salvaguarda: si algún stream (p. ej. un directo) no reporta avance de
  // tiempo, fundimos igualmente unos segundos después de que VLC empiece a
  // reproducir, para que la carátula nunca se quede pegada sobre el vídeo.
  useEffect(() => {
    if (!hasPlayed || firstFrame) return;
    const t = setTimeout(() => setFirstFrame(true), 4_000);
    return () => clearTimeout(t);
  }, [hasPlayed, firstFrame]);

  // Mantiene `firstFrameRef` sincronizado y cancela el watchdog en cuanto hay
  // imagen real (la fuente arrancó bien).
  useEffect(() => {
    if (firstFrame) {
      firstFrameRef.current = true;
      clearTimeout(startTimer.current);
    }
  }, [firstFrame]);

  // Reporta la fuente como no reproducible al padre (auto-fallback). Una sola vez
  // por fuente y solo si aún no se había visto imagen: un corte tras el primer
  // fotograma lo recupera VLC con http-reconnect, no queremos tirar una fuente
  // buena. No-op si no hay manejador (sin fallback posible).
  const reportUnplayable = useCallback(() => {
    if (firedUnplayable.current || firstFrameRef.current) return;
    firedUnplayable.current = true;
    clearTimeout(startTimer.current);
    onUnplayable?.();
  }, [onUnplayable]);

  // Watchdog de arranque: si la fuente no produce imagen a tiempo (host colgado),
  // la saltamos. Se reinicia por fuente gracias al remontaje (key={url}).
  useEffect(() => {
    if (!onUnplayable) return;
    startTimer.current = setTimeout(reportUnplayable, startTimeoutMs);
    return () => clearTimeout(startTimer.current);
  }, [onUnplayable, reportUnplayable, startTimeoutMs]);

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

  // --- barra de progreso (Slider de heroui-native) ---
  // Mientras se arrastra mostramos `scrubTime` y NO movemos el vídeo; al soltar
  // (`onChangeEnd`) hacemos el seek. Así el tiempo en vivo no pelea con el dedo.
  const toTime = (v: number | number[]) => (Array.isArray(v) ? v[0] : v);
  const onSlide = (v: number | number[]) => {
    setScrubbing(true);
    setScrubTime(toTime(v));
    showControls();
  };
  const onSlideEnd = (v: number | number[]) => {
    const t = toTime(v);
    if (duration) {
      playerRef.current?.seek(t, 'time');
      setTime(t);
    }
    setScrubbing(false);
    scheduleHide();
  };

  const progress = scrubbing ? scrubTime : time;
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
        // network-caching = ms de buffer antes de empezar: es el factor que más
        // pesa en "tarda en abrir". 1500 ms abre ~1,5 s más rápido que 3000 con
        // un riesgo de micro-cortes asumible (que recupera :http-reconnect; un
        // corte tras el primer fotograma NO tira la fuente). El User-Agent de
        // navegador evita 403 de hosts que rechazan el UA por defecto de VLC.
        // Tunable: subir a 2500-3000 si hay rebuffering en redes lentas.
        options={[
          ':network-caching=1500',
          ':file-caching=1500',
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
          // El tiempo avanza ⇒ hay fotogramas pintándose ⇒ ya podemos fundir
          // la carátula al vídeo (sin pasar por negro ni spinner).
          if (value > 0 && !firstFrame) setFirstFrame(true);
          if (!scrubbing) {
            setTime(value);
            // Si el tiempo avanza, NO está buffering: limpiamos el spinner ya
            // (aunque VLC siga emitiendo onBuffering, así no se queda pegado el
            // "cargando" mientras se ve la peli). setState(false) es no-op si ya
            // estaba false → barato.
            setBuffering(false);
          }
        }}
        onESAdded={(media) => {
          setTracks(media);
          setAudioId((prev) => prev ?? pickDefaultAudio(media.audio));
          // Primera detección de pistas: la fuente es VÁLIDA (abrió el
          // contenedor), solo está buffering. Rearmamos el watchdog con mucho
          // más margen para el primer fotograma en vez de matarla a los 20 s.
          if (!esAddedRef.current && media.video.length > 0) {
            esAddedRef.current = true;
            if (onUnplayable) {
              clearTimeout(startTimer.current);
              startTimer.current = setTimeout(
                reportUnplayable,
                PLAYBACK_FIRST_FRAME_TIMEOUT_MS,
              );
            }
          }
        }}
        onEncounteredError={({ message }) => {
          // Con fallback y antes del primer fotograma, el padre prueba otra
          // fuente automáticamente. Tras el primer fotograma (error fatal a
          // mitad) o sin fallback, mostramos la tarjeta de error in-place con el
          // diagnóstico y los controles (incluido "cambiar fuente"), como antes.
          if (onUnplayable && !firstFrame) {
            reportUnplayable();
            return;
          }
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

      {/* Spinner de buffering solo en re-buffering a mitad de reproducción.
          Exigir `coverGone` evita que se cuele durante el fundido inicial de
          la carátula (VLC vuelve a emitir onBuffering en esos 260 ms). */}
      {hasPlayed && coverGone && buffering && !errorMsg ? (
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
                paddingTop: insets.top + 14,
                paddingLeft: insets.left + 12,
                paddingRight: insets.right + 12,
              },
            ]}
            pointerEvents="box-none"
          >
            <Pressable
              onPress={() => router.back()}
              style={withRing(styles.backBtn)}
              hitSlop={6}
            >
              <ArrowLeft size={22} color="#fff" />
            </Pressable>
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
              {pipSupported ? (
                <Pressable
                  style={withRing(styles.actionBtn)}
                  onPress={() => playerRef.current?.startPictureInPicture?.()}
                  hitSlop={6}
                >
                  <PictureInPicture2 size={20} color="#fff" />
                </Pressable>
              ) : null}
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

            <View style={{ flex: 1, marginHorizontal: 4 }}>
              <Slider
                value={Math.min(progress, duration || 1)}
                minValue={0}
                maxValue={duration || 1}
                isDisabled={!duration}
                onChange={onSlide}
                onChangeEnd={onSlideEnd}
              >
                <Slider.Track>
                  <Slider.Fill />
                  <Slider.Thumb />
                </Slider.Track>
              </Slider>
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
  const { width: winWidth } = useWindowDimensions();
  const cardWidth = Math.min(420, Math.round(winWidth * 0.7));
  return (
    <View style={styles.menuRoot}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={[styles.menuCard, { width: cardWidth }]}>
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
  status,
}: {
  background?: string;
  logo?: string;
  title?: string;
  error?: string;
  detail?: string;
  status?: string;
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
          {status ? (
            <Typography
              type="body-sm"
              color="muted"
              align="center"
              style={{ marginTop: 16 }}
            >
              {status}
            </Typography>
          ) : null}
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
    alignItems: 'center',
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
    // El ancho se fija inline desde useWindowDimensions (ver TrackMenu).
    maxHeight: '80%',
    backgroundColor: '#161616',
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  pickerCard: {
    // El ancho se fija inline desde useWindowDimensions (ver SourcePicker).
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
  },
});
