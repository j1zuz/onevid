import { useQuery } from '@tanstack/react-query';
import * as ScreenOrientation from 'expo-screen-orientation';
import {
  router,
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
} from 'expo-router';
import { SearchField, Typography } from 'heroui-native';
import { Radio, Tv } from 'lucide-react-native';
import {
  type ComponentRef,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  StatusBar as RNStatusBar,
  useWindowDimensions,
  ScrollView,
  type ScrollViewInstance,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '@/components/empty-state';
import { LiveTvCategoryPicker } from '@/components/live-tv-category-picker';
import {
  LiveTvGuide,
  LiveTvGuideSkeleton,
} from '@/components/live-tv-guide';
import { Player } from '@/app/player';
import { sanitizeUrlForVlc } from '@/lib/stream-url';
import { useAppSurface } from '@/hooks/use-app-surface';
import { tvFocusRing, useTvFocus } from '@/hooks/use-tv-focus';
import {
  type LiveTvChannel,
  liveTvChannelsQueryOptions,
  liveTvSourcesQueryOptions,
} from '@/lib/live-tv';
import { COLORS } from '@/lib/theme';

export default function LiveTvTab() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // La pestaña es parte del modo Stream (igual que Descubrir/Biblioteca).
  const surface = useAppSurface();
  const streamMode = surface?.showLocal === false;
  const catalogEnabled = streamMode && surface?.authed === true;

  const sourcesQuery = useQuery(liveTvSourcesQueryOptions(catalogEnabled));
  const sources = sourcesQuery.data ?? [];
  const [sourceId, setSourceId] = useState('');
  const [group, setGroup] = useState('');
  const [query, setQuery] = useState('');
  // Canal que suena arriba de la guía (sin salir del EPG para cambiar).
  const [playing, setPlaying] = useState<LiveTvChannel | null>(null);
  // Pantalla completa EN SITIO: el mismo reproductor se agranda. Navegar a
  // /player montaba otro reproductor y volvía a cargar el canal desde cero.
  const [fullscreen, setFullscreen] = useState(false);
  const navigation = useNavigation();
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  // Ancho explícito del reproductor: con `aspectRatio` y `flexShrink` Yoga podía
  // encogerlo y dejar un hueco a la derecha.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const playerWidth = Math.max(0, Math.round(windowWidth - 32));
  const searchRef = useRef<ComponentRef<typeof SearchField.Input>>(null);
  // Si el usuario toca el buscador a propósito no le quitamos el foco; solo se
  // combate el foco automático de Android.
  const searchTouchedRef = useRef(false);
  // En TV el TextInput se queda con el D-pad y no lo suelta (ni con BACK), así
  // que la pantalla dejaba de responder. El campo solo es enfocable mientras
  // se está editando: se entra con OK sobre la barra y se sale con BACK.
  const isTV = Platform.isTV;
  const [searchEditing, setSearchEditing] = useState(false);
  const searchTriggerRef = useRef<ComponentRef<typeof Pressable>>(null);
  const searchTriggerFocus = useTvFocus();
  // La Biblioteca y las filas del feed abren el canal aquí (mismo reproductor
  // embebido), pasándolo por params en vez de navegar al reproductor completo.
  const liveParams = useLocalSearchParams<{
    at?: string;
    title?: string;
    url?: string;
  }>();
  const deferredQuery = useDeferredValue(query);
  const source = sources.find((item) => item.id === sourceId) ?? sources[0];

  const channelsQuery = useQuery(
    liveTvChannelsQueryOptions(source?.id ?? '', catalogEnabled),
  );
  const channels = useMemo(
    () => (channelsQuery.data ?? []).filter((channel) => Boolean(channel.url)),
    [channelsQuery.data],
  );

  // Canales agrupados por categoría: cada categoría se pinta como una fila
  // horizontal, igual que las filas del Inicio.
  const channelsByGroup = useMemo(() => {
    const map = new Map<string, LiveTvChannel[]>();
    for (const channel of channels) {
      const key = channel.group || t('Sin grupo');
      const list = map.get(key);
      if (list) list.push(channel);
      else map.set(key, [channel]);
    }
    return map;
  }, [channels, t]);

  const groups = useMemo(
    () => [...channelsByGroup.keys()].sort((a, b) => a.localeCompare(b)),
    [channelsByGroup],
  );

  const filtered = useMemo(() => {
    const search = deferredQuery.trim().toLocaleLowerCase();
    return channels.filter(
      (channel) =>
        (!group || channel.group === group) &&
        (!search || channel.name.toLocaleLowerCase().includes(search)),
    );
  }, [channels, deferredQuery, group]);

  const refresh = useCallback(() => {
    if (!source) {
      void sourcesQuery.refetch();
      return;
    }
    void channelsQuery.refetch();
  }, [channelsQuery, source, sourcesQuery]);

  // Android enfoca el primer campo de texto al montar la pantalla (y al montar
  // vistas nuevas, como el reproductor) y abre el teclado solo. En Live TV lo
  // primero es la guía: se quita ese foco al entrar y cada vez que se abre un
  // canal, para que tocar un canal no enfoque el buscador.
  useEffect(() => {
    // En TV no hace falta: el campo no es enfocable salvo que el usuario lo
    // abra a propósito (ver `searchEditing`), así que Android no puede
    // robarle el foco ni abrir el teclado solo.
    if (Platform.isTV) return;
    // Android mueve el foco al primer EditText cuando cambia el árbol (al
    // montar el player, al desplazar la guía o al terminar de cargar el vídeo),
    // así que un solo blur no basta. Sin canal se insiste unos segundos; con un
    // canal sonando se vigila mientras dure (salvo que el usuario toque el
    // buscador, que entonces manda su intención).
    const blurSearch = () => {
      if (searchTouchedRef.current) return;
      // `TextInput.State` alcanza al input realmente enfocado aunque el ref del
      // componente compuesto no apunte al nativo.
      const focused = TextInput.State.currentlyFocusedInput?.();
      focused?.blur?.();
      searchRef.current?.blur();
      Keyboard.dismiss();
    };
    blurSearch();
    const immediate = setTimeout(blurSearch, 120);
    const interval = setInterval(blurSearch, playing ? 400 : 250);
    const stop = playing
      ? null
      : setTimeout(() => clearInterval(interval), 8000);
    return () => {
      clearTimeout(immediate);
      clearInterval(interval);
      if (stop) clearTimeout(stop);
    };
  }, [playing]);

  // TV: al entrar en modo búsqueda hay que enfocar el input a mano (el campo
  // ya está montado, `autoFocus` no aplicaría).
  useEffect(() => {
    if (!isTV || !searchEditing) return;
    const timer = setTimeout(() => searchRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [isTV, searchEditing]);

  // TV: BACK sale del buscador (primer BACK lo cierra el teclado en pantalla;
  // el siguiente llega aquí) y devuelve el foco a la barra.
  useEffect(() => {
    if (!isTV || !searchEditing) return;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        TextInput.State.currentlyFocusedInput?.()?.blur?.();
        searchRef.current?.blur();
        Keyboard.dismiss();
        setSearchEditing(false);
        setTimeout(() => {
          const trigger = searchTriggerRef.current as unknown as {
            requestTVFocus?: () => void;
            focus?: () => void;
          } | null;
          if (trigger?.requestTVFocus) trigger.requestTVFocus();
          else trigger?.focus?.();
        }, 80);
        return true;
      },
    );
    return () => subscription.remove();
  }, [isTV, searchEditing]);

  useEffect(() => {
    if (!liveParams.url) return;
    setPlaying({
      id: liveParams.url,
      name: liveParams.title || 'Live TV',
      url: liveParams.url,
      group: '',
    });
  }, [liveParams.at, liveParams.title, liveParams.url]);

  useEffect(() => {
    navigation.setOptions({
      tabBarStyle: fullscreen
        ? { display: 'none' }
        : {
            backgroundColor: COLORS.background,
            borderTopColor: '#222',
          },
    });
  }, [fullscreen, navigation]);

  useEffect(() => {
    if (!fullscreen) return;
    RNStatusBar.setHidden(true, 'fade');
    return () => RNStatusBar.setHidden(false, 'fade');
  }, [fullscreen]);

  // Pantalla completa = horizontal, igual que el reproductor de /player. Al
  // salir se devuelve la pestaña a vertical.
  // En TV la pantalla ya es horizontal fija: bloquear PORTRAIT_UP al salir
  // dejaba la app en una columna estrecha en medio del televisor.
  useEffect(() => {
    if (!fullscreen || Platform.isTV) return;
    ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.LANDSCAPE,
    ).catch(() => {
      /* el dispositivo puede no permitirlo */
    });
    return () => {
      ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP,
      ).catch(() => {
        /* ignore */
      });
    };
  }, [fullscreen]);

  // Al cambiar de pestaña se corta el directo (no debe seguir sonando por
  // detrás, como no lo hace la web al salir de la página).
  useFocusEffect(
    useCallback(() => {
      return () => setPlaying(null);
    }, []),
  );

  const closePlayer = useCallback(() => {
    setFullscreen(false);
    setPlaying(null);
  }, []);

  // TV: sin un elemento enfocado Android no mueve el foco con el D-pad, así
  // que al entrar en la pestaña (o al cerrar el reproductor) enfocamos la
  // barra de búsqueda, que es el primer control de la pantalla.
  const focusTvEntry = useCallback(() => {
    if (!isTV) return;
    let attempts = 0;
    const attempt = () => {
      const target = searchTriggerRef.current as unknown as {
        requestTVFocus?: () => void;
        focus?: () => void;
      } | null;
      // `requestTVFocus` es el comando nativo de RN-TVs que hace
      // `View.requestFocus()`; `focus()` depende de un feature flag que en
      // release está apagado y no hace nada.
      if (target?.requestTVFocus) {
        target.requestTVFocus();
        return;
      }
      if (target?.focus) {
        target.focus();
        return;
      }
      if (attempts++ < 20) setTimeout(attempt, 150);
    };
    attempt();
  }, [isTV]);

  useFocusEffect(
    useCallback(() => {
      if (!isTV) return;
      focusTvEntry();
    }, [focusTvEntry, isTV]),
  );

  useEffect(() => {
    if (!isTV || playing) return;
    const timer = setTimeout(focusTvEntry, 250);
    return () => clearTimeout(timer);
  }, [focusTvEntry, isTV, playing]);

  // Selector de categoría: barra abajo en móvil, en el encabezado de la guía en TV.
  const categoryPicker =
    groups.length > 0 ? (
      <LiveTvCategoryPicker
        group={group}
        groups={groups}
        onChange={setGroup}
        variant={Platform.isTV ? 'pill' : 'bar'}
      />
    ) : null;

  const openChannel = useCallback((channel: LiveTvChannel) => {
    setPlaying(channel);
    // La guía está desplazada cuando el usuario baja a buscar canales: el
    // reproductor se monta arriba del contenido, así que lo llevamos allí.
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  // Barra de búsqueda. En TV se pinta igual, pero el TextInput no es enfocable
  // hasta que el usuario pulsa OK sobre ella: si no, Android le da el foco al
  // entrar y el D-pad se queda atrapado dentro del campo (BACK no lo suelta).
  const searchField = (
    <SearchField value={query} onChange={setQuery}>
      <SearchField.Group>
        <SearchField.SearchIcon />
        <SearchField.Input
          ref={searchRef}
          editable={!isTV || searchEditing}
          focusable={!isTV || searchEditing}
          onBlur={() => {
            searchTouchedRef.current = false;
          }}
          onPressIn={() => {
            searchTouchedRef.current = true;
          }}
          // Sin altura fija (con `h-9` el texto quedaba pegado arriba y
          // se recortaba con la escala de fuente del sistema).
          // `includeFontPadding: false` + `textAlignVertical: center`
          // centran la línea de verdad en Android: con el padding de
          // fuente por defecto, "Search channel…" se ve unos píxeles
          // por encima del icono, que sí está centrado.
          className="min-h-11 text-sm"
          placeholder={t('Buscar canal…')}
          style={{
            includeFontPadding: false,
            paddingVertical: 0,
            textAlignVertical: 'center',
          }}
        />
        {!isTV || searchEditing ? <SearchField.ClearButton /> : null}
      </SearchField.Group>
    </SearchField>
  );

  const loading =
    sourcesQuery.isLoading || (Boolean(source) && channelsQuery.isLoading);
  const error = sourcesQuery.isError || channelsQuery.isError;

  if (surface == null)
    return <View style={{ flex: 1, backgroundColor: COLORS.background }} />;
  if (surface.showLocal)
    return (
      <EmptyState
        icon={<Tv size={32} color="#9ca3af" />}
        title="Live TV"
        description={t('Live TV está disponible en modo Stream.')}
      />
    );
  if (!surface.authed)
    return (
      <EmptyState
        icon={<Tv size={32} color="#9ca3af" />}
        title="Live TV"
        description={t('Inicia sesión para ver Live TV.')}
      />
    );

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.background,
        // En pantalla completa no debe quedar la franja del inset superior.
        paddingTop: fullscreen ? 0 : insets.top,
      }}
    >
      {fullscreen ? null : (
      <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Typography type="h2" style={{ flex: 1 }}>
            Live TV
          </Typography>
        </View>

        {!sourcesQuery.isLoading && sources.length > 0 ? (
          <>
            {isTV && !searchEditing ? (
              <Pressable
                accessibilityLabel={t('Buscar canal…')}
                accessibilityRole="search"
                // Sin esto la pantalla se queda sin foco inicial (el campo ya
                // no es enfocable) y el D-pad no responde hasta que algo tome
                // foco. Al salir de la edición el Pressable se remonta y
                // recupera el foco de forma natural.
                hasTVPreferredFocus={isTV}
                onPress={() => setSearchEditing(true)}
                ref={searchTriggerRef}
                {...searchTriggerFocus.focusProps}
                style={[
                  { borderRadius: 12 },
                  tvFocusRing(searchTriggerFocus.focused),
                ]}
              >
                {searchField}
              </Pressable>
            ) : (
              searchField
            )}

            {sources.length > 1 ? (
              <ChipRow>
                {sources.map((item) => (
                  <FilterChip
                    key={item.id}
                    active={item.id === source?.id}
                    label={item.name}
                    onPress={() => {
                      setSourceId(item.id);
                      setGroup('');
                    }}
                  />
                ))}
              </ChipRow>
            ) : null}
          </>
        ) : null}
      </View>
      )}

      {loading ? (
        <View style={{ flex: 1, paddingTop: 16 }}>
          <LiveTvGuideSkeleton />
        </View>
      ) : error ? (
        <LoadError onRetry={refresh} />
      ) : sourcesQuery.isSuccess && sources.length === 0 ? (
        <EmptyState
          icon={<Radio size={32} color="#9ca3af" />}
          title="Live TV"
          description={t('Configura Live TV desde la web para ver tus canales.')}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Tv size={32} color="#9ca3af" />}
          title={t('No hay canales disponibles')}
          description={
            channels.length === 0
              ? t(
                  'Esta fuente no devolvió canales compatibles. Comprueba su configuración o actualiza la lista.',
                )
              : t('Prueba con otra categoría o cambia la búsqueda.')
          }
        />
      ) : source ? (
        <ScrollView
          contentContainerStyle={
            fullscreen ? undefined : { paddingTop: 16, paddingBottom: 32 }
          }
          nestedScrollEnabled
          ref={scrollRef}
          // En pantalla completa no se navega la lista: el vídeo ocupa todo.
          scrollEnabled={!fullscreen}
          style={{ flex: 1 }}
        >
          {/* Un ÚNICO `Player`: se queda montado al alternar pantalla completa
              (antes había dos ramas y al entrar recargaba el directo). Va
              dentro del scroll para que el D-pad pueda bajar al EPG. */}
          {playing ? (
            <View
              style={
                fullscreen
                  ? {
                      width: windowWidth,
                      height: windowHeight,
                      backgroundColor: '#000',
                    }
                  : {
                      width: playerWidth,
                      height: Math.round((playerWidth * 9) / 16),
                      marginHorizontal: 16,
                      marginBottom: 12,
                      borderRadius: 12,
                      overflow: 'hidden',
                      backgroundColor: '#000',
                    }
              }
            >
              <Player
                key={playing.id}
                // En pantalla completa deja de ser "embebido": así el botón de
                // play toma el foco al entrar (si no, el foco caía en el rail).
                embedded={!fullscreen}
                fullscreen={fullscreen}
                live
                onBack={() => {
                  if (fullscreen) {
                    setFullscreen(false);
                    return;
                  }
                  closePlayer();
                }}
                onFullscreen={() => {
                  scrollRef.current?.scrollTo({ y: 0, animated: false });
                  setFullscreen((value) => !value);
                }}
                title={playing.name}
                url={sanitizeUrlForVlc(playing.url)}
              />
            </View>
          ) : null}
          {fullscreen ? null : (
            <LiveTvGuide
              channels={filtered}
              headerExtra={Platform.isTV ? categoryPicker : null}
              onPlayChannel={openChannel}
              source={source}
            />
          )}
        </ScrollView>
      ) : null}

      {/* En móvil el selector de categoría va fijo abajo, sobre las pestañas
          (como antes), para no comerle sitio a la guía. En TV va en el
          encabezado. */}
      {!Platform.isTV && categoryPicker && !loading && !error && source ? (
        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: 8,
            borderTopWidth: 1,
            borderTopColor: '#1f1f1f',
            backgroundColor: COLORS.background,
          }}
        >
          {categoryPicker}
        </View>
      ) : null}
    </View>
  );
}

function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      contentContainerStyle={{ gap: 8, paddingRight: 8 }}
      showsHorizontalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

function FilterChip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const { focused, focusProps } = useTvFocus();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      {...focusProps}
      style={[
        {
          borderRadius: 999,
          paddingHorizontal: 14,
          paddingVertical: 8,
          backgroundColor: active ? '#ffffff' : COLORS.surface,
        },
        tvFocusRing(focused),
      ]}
    >
      <Typography
        type="body-sm"
        weight={active ? 'semibold' : 'medium'}
        numberOfLines={1}
        style={{ color: active ? '#0a0a0a' : '#d4d4d4' }}
      >
        {label}
      </Typography>
    </Pressable>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const { focused, focusProps } = useTvFocus();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
        gap: 12,
      }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 999,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: COLORS.surface,
        }}
      >
        <Radio size={32} color="#9ca3af" />
      </View>
      <Typography type="h5" align="center">
        {t('No se pudo cargar Live TV')}
      </Typography>
      <Typography type="body-sm" color="muted" align="center">
        {t('Comprueba tu conexión y que la fuente siga disponible.')}
      </Typography>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        {...focusProps}
        style={[
          {
            marginTop: 4,
            borderRadius: 999,
            paddingHorizontal: 18,
            paddingVertical: 10,
            backgroundColor: COLORS.surface,
          },
          tvFocusRing(focused),
        ]}
      >
        <Typography type="body-sm" weight="semibold">
          {t('Reintentar')}
        </Typography>
      </Pressable>
    </View>
  );
}
