import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { LinearGradient as ExpoLinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useObserve } from 'expo-observe';
import { ScrollShadow, Skeleton, Typography } from 'heroui-native';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import {
  ContinueWatchingRow,
  type ContinueWatchingItem,
} from '@/components/home/continue-watching-row';
import { HeroCarousel } from '@/components/home/hero-carousel';
import { sourcesQueryOptions } from '@/components/sources-list';
import { LiveTvRow } from '@/components/home/live-tv-row';
import { PosterRow } from '@/components/home/poster-row';
import { LocalVideoPicker } from '@/components/local-video-picker';
import { StreamLoginScreen } from '@/components/stream-login-screen';
import { useAppSurface } from '@/hooks/use-app-surface';
import { type FeedSection, type MediaMeta } from '@/lib/api';
import {
  continueWatchingQuery,
  feedHeroQuery,
  feedSectionsQuery,
} from '@/lib/home-feed';
import { navigateToDetail } from '@/lib/detail-nav';
import { prewarmStreamUrl } from '@/lib/stream-url';
import { COLORS } from '@/lib/theme';

// Filas de skeleton mientras llega el feed: no sabemos cuántas tiene el usuario
// hasta que responde el backend, así que mostramos un par y luego se sustituyen
// por las reales.
const SKELETON_ROWS = 2;

export default function HomeTab() {
  const { t, i18n } = useTranslation();
  // Idioma activo: entra en las query keys del catálogo para que, al cambiarlo,
  // React Query refetchee en vez de servir la cache del idioma anterior.
  const lang = i18n.language;
  const { height: windowHeight } = useWindowDimensions();
  const heroSkeletonHeight = Math.round(windowHeight * 0.72);

  // El tab Inicio es "Reproducir video" en modo local (sin sesión, o si el
  // usuario eligió modo local en Configuración) y el catálogo en modo stream.
  // `surface` es null mientras se resuelve; se revalida en cada focus.
  const surface = useAppSurface();
  const streamMode = surface?.showLocal === false;

  // TMDB usa el token global de onevid, no configuración por usuario. En cuanto
  // hay sesión stream habilitamos las queries; esperar al antiguo setup-status
  // retrasaba el feed y hacía visible el skeleton aunque ya estuviera precargado.
  const catalogEnabled = streamMode && surface?.authed === true;

  const queryClient = useQueryClient();
  const continueQuery = useQuery({
    ...continueWatchingQuery(lang),
    enabled: catalogEnabled,
    // Al re-habilitarse la query o cambiar el idioma, conservamos los datos
    // previos en vez de volver a `isLoading` (que dejaría el Inicio en skeleton
    // completo). En un cambio de perfil no hay datos previos que conservar
    // (setActiveProfile vacía el cache), así que ahí sí se re-pide desde cero.
    placeholderData: keepPreviousData,
  });
  const continueItems = useMemo(
    () => continueQuery.data ?? [],
    [continueQuery.data],
  );

  // Precalienta "Continuar viendo": ese camino entra DIRECTO al reproductor (sin
  // pasar por el detalle), así que sin esto paga la petición de fuentes + la
  // resolución de la URL del CDN al abrir. Se piden mientras el usuario decide y
  // el player arranca caliente. 4 y no 2: con la caché de fuentes en 5 min la
  // mayoría de las reanudaciones caen dentro de la ventana.
  useEffect(() => {
    if (!catalogEnabled) return;
    for (const item of (continueQuery.data ?? []).slice(0, 4)) {
      const season = item.season > 0 ? String(item.season) : undefined;
      const episode = item.episode > 0 ? String(item.episode) : undefined;
      void queryClient
        .ensureQueryData(sourcesQueryOptions(item.type, item.id, season, episode))
        .then((data) => {
          const first = data?.sources?.[0];
          if (first) prewarmStreamUrl(first.url);
        })
        .catch(() => {
          /* pre-calentar es best-effort */
        });
    }
  }, [catalogEnabled, continueQuery.data, queryClient]);
  // Al volver al Inicio (p. ej. tras salir del reproductor) refrescamos las
  // posiciones para que "Continuar viendo" refleje lo recién visto.
  useFocusEffect(
    useCallback(() => {
      if (catalogEnabled) {
        queryClient.invalidateQueries({ queryKey: ['continue-watching'] });
        // Y la marca de "visto": si el título se terminó en el reproductor, sale
        // de "Continuar viendo" y entra aquí, así que ambas caen a la vez.
        queryClient.invalidateQueries({ queryKey: ['watch-state'] });
      }
    }, [catalogEnabled, queryClient]),
  );
  // Carga progresiva: el hero viaja en su propia query (resuelve mucho antes que
  // las filas, que necesitan N catálogos de TMDB). Así el carrusel se pinta
  // primero y las filas van apareciendo debajo, sin bloquear todo con un
  // skeleton de pantalla completa.
  const heroQuery = useQuery({
    ...feedHeroQuery(lang),
    enabled: catalogEnabled,
    // Evita el skeleton al re-habilitarse la query (volver al Inicio, cambiar de
    // idioma): se conserva lo anterior mientras se revalida.
    placeholderData: keepPreviousData,
  });
  const sectionsQuery = useQuery({
    ...feedSectionsQuery(lang),
    enabled: catalogEnabled,
    placeholderData: keepPreviousData,
  });

  const sections = sectionsQuery.data?.sections ?? [];
  const heroItems = useMemo(
    () => heroQuery.data?.hero ?? [],
    [heroQuery.data?.hero],
  );
  const heroLoading = heroQuery.isLoading && heroQuery.data == null;
  const rowsLoading = sectionsQuery.isLoading && sectionsQuery.data == null;
  // "Continuar viendo" nunca tapa un hero/filas ya precargados: si aún se está
  // actualizando, simplemente aparece después.
  const error =
    sectionsQuery.isError || sectionsQuery.data?.error === 'network'
      ? t('No pudimos cargar el catálogo. Reintenta en un momento.')
      : null;

  const handlePressItem = useCallback(
    (item: MediaMeta) => {
      navigateToDetail(queryClient, item, lang);
    },
    [queryClient, lang],
  );

  // TTI por ruta (EAS Observe): Inicio está listo cuando hero y filas ya
  // pintaron, no cuando el layout raíz terminó el splash. Solo la primera vez.
  const { markInteractive } = useObserve();
  const homeTtiMarked = useRef(false);
  useEffect(() => {
    if (
      !catalogEnabled ||
      homeTtiMarked.current ||
      heroLoading ||
      rowsLoading
    ) {
      return;
    }
    homeTtiMarked.current = true;
    markInteractive();
  }, [catalogEnabled, heroLoading, markInteractive, rowsLoading]);

  // Reproducir directo desde "Continuar viendo" (sin `url` → el player toma la
  // 1ª fuente y salta a la posición guardada). Para series pasamos temporada/
  // episodio para reanudar el episodio correcto.
  const handleResume = useCallback((item: ContinueWatchingItem) => {
    router.push({
      pathname: '/player',
      params: {
        from: 'app',
        title: item.name,
        background: item.background,
        poster: item.poster,
        logo: item.logo,
        type: item.type,
        id: item.id,
        // Posición que YA conocemos (viene con la fila): el player abre el
        // medio en ese segundo con `:start-time` en vez de pedir el progreso
        // otra vez y hacer un seek después del primer fotograma.
        ...(item.positionSec > 30
          ? { resume: String(Math.floor(item.positionSec)) }
          : {}),
        ...(item.type === 'series' && item.season && item.episode
          ? {
              season: String(item.season),
              episode: String(item.episode),
            }
          : {}),
      },
    });
  }, []);

  const renderSection = useCallback(
    ({ item: section }: { item: FeedSection }) =>
      section.kind === 'live' ? (
        <LiveTvRow
          enabled={catalogEnabled}
          group={section.liveGroup}
          sourceId={section.liveSourceId}
          title={section.title}
        />
      ) : (
        <PosterRow
          items={section.items}
          href={section.href}
          onPressItem={handlePressItem}
          topTen={section.topTen}
          topTenRanks={section.topTenRanks}
          title={section.title}
        />
      ),
    [catalogEnabled, handlePressItem],
  );

  // Hero + "Continuar viendo" viven en la cabecera de la lista: siguen siempre
  // montados, pero las filas de catálogo se montan solo al acercarse.
  const listHeader = useMemo(
    () => (
      <>
        {heroLoading ? (
          <View style={{ height: heroSkeletonHeight, width: '100%' }}>
            <Skeleton style={{ width: '100%', height: '100%', borderRadius: 0 }} />
            <Svg
              pointerEvents="none"
              height={Math.round(heroSkeletonHeight * 0.7)}
              width="100%"
              style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
            >
              <Defs>
                <LinearGradient id="heroSkelFade" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={COLORS.background} stopOpacity="0" />
                  <Stop offset="0.4" stopColor={COLORS.background} stopOpacity="0.4" />
                  <Stop offset="0.75" stopColor={COLORS.background} stopOpacity="0.85" />
                  <Stop offset="1" stopColor={COLORS.background} stopOpacity="1" />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroSkelFade)" />
            </Svg>
          </View>
        ) : (
          <HeroCarousel items={heroItems} />
        )}

        {continueItems.length > 0 ? (
          <ContinueWatchingRow
            title={t('Continuar viendo')}
            items={continueItems}
            onPressItem={handleResume}
          />
        ) : null}
      </>
    ),
    [
      continueItems,
      handleResume,
      heroItems,
      heroLoading,
      heroSkeletonHeight,
      t,
    ],
  );

  // Mientras se resuelve sesión/modo no pintamos nada (evita parpadeo picker↔catálogo).
  if (surface == null)
    return <View style={{ flex: 1, backgroundColor: COLORS.background }} />;
  // Modo local: el tab Inicio muestra "Reproducir video".
  if (surface.showLocal) return <LocalVideoPicker />;

  // Stream sin sesión (caso TV, sin picker): mostramos el QR de login centrado
  // a pantalla completa, sin que el usuario tenga que ir a Perfil.
  if (!surface.authed)
    return <StreamLoginScreen onContinueWithoutAccount={surface.refresh} />;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <ScrollShadow
        style={{ flex: 1 }}
        size={36}
        color={COLORS.background}
        LinearGradientComponent={ExpoLinearGradient}
      >
      <FlatList
        data={rowsLoading ? [] : sections}
        keyExtractor={(section) => section.id}
        ListHeaderComponent={listHeader}
        // Mientras llegan las filas, 2 skeletons debajo del hero. Ya no se
        // montan todas las secciones a la vez: antes un ScrollView mantenía
        // ~7–10 filas × 10 tarjetas (p90 medido) con sus bitmaps.
        ListEmptyComponent={
          rowsLoading ? (
            <View style={{ gap: 24 }}>
              {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <PosterRow
                  items={[]}
                  // biome-ignore lint/suspicious/noArrayIndexKey: placeholder fijo
                  key={i}
                  loading
                  title=""
                />
              ))}
            </View>
          ) : undefined
        }
        ListFooterComponent={
          error && !rowsLoading ? (
            <Typography
              type="body-sm"
              color="muted"
              align="center"
              style={{ paddingHorizontal: 16 }}
            >
              {error}
            </Typography>
          ) : undefined
        }
        renderItem={renderSection}
        contentContainerStyle={{ paddingBottom: 32, gap: 24 }}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        updateCellsBatchingPeriod={50}
        windowSize={5}
        // Celdas grises al volver del player en Android: mantener el mismo
        // criterio que las filas horizontales.
        removeClippedSubviews={false}
      />
      </ScrollShadow>
    </View>
  );
}
