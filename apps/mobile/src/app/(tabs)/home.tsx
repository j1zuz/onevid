import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { LinearGradient as ExpoLinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { ScrollShadow, Skeleton, Typography } from 'heroui-native';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import {
  ContinueWatchingRow,
  type ContinueWatchingItem,
} from '@/components/home/continue-watching-row';
import { HeroCarousel } from '@/components/home/hero-carousel';
import { PosterRow } from '@/components/home/poster-row';
import { LocalVideoPicker } from '@/components/local-video-picker';
import { StreamLoginScreen } from '@/components/stream-login-screen';
import { useAppSurface } from '@/hooks/use-app-surface';
import { type MediaMeta } from '@/lib/api';
import {
  continueWatchingQuery,
  feedHeroQuery,
  feedSectionsQuery,
} from '@/lib/home-feed';
import { navigateToDetail } from '@/lib/detail-nav';
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
  const continueItems = continueQuery.data ?? [];
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
  const heroItems = heroQuery.data?.hero ?? [];
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

  // Reproducir directo desde "Continuar viendo" (sin `url` → el player toma la
  // 1ª fuente y salta a la posición guardada). Para series pasamos temporada/
  // episodio para reanudar el episodio correcto.
  const handleResume = useCallback((item: ContinueWatchingItem) => {
    router.push({
      pathname: '/player',
      params: {
        title: item.name,
        background: item.background,
        poster: item.poster,
        logo: item.logo,
        type: item.type,
        id: item.id,
        ...(item.type === 'series' && item.season && item.episode
          ? {
              season: String(item.season),
              episode: String(item.episode),
            }
          : {}),
      },
    });
  }, []);

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
      <ScrollView contentContainerStyle={{ paddingBottom: 32, gap: 24 }}>
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

        {rowsLoading
          ? Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <PosterRow
                items={[]}
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholder fijo
                key={i}
                loading
                title=""
              />
            ))
          : sections.map((section) => (
              <PosterRow
                items={section.items}
                href={section.href}
                key={section.id}
                onPressItem={handlePressItem}
                topTen={section.topTen}
                topTenRanks={section.topTenRanks}
                title={section.title}
              />
            ))}

        {error && !rowsLoading ? (
          <Typography
            type="body-sm"
            color="muted"
            align="center"
            style={{ paddingHorizontal: 16 }}
          >
            {error}
          </Typography>
        ) : null}
      </ScrollView>
      </ScrollShadow>
    </View>
  );
}
