import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { SetupPrompt, useSetupStatus } from '@/components/setup-prompt';
import { StreamLoginScreen } from '@/components/stream-login-screen';
import { useAppSurface } from '@/hooks/use-app-surface';
import { type MediaMeta } from '@/lib/api';
import { continueWatchingQuery, feedSectionsQuery } from '@/lib/home-feed';
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

  // El catálogo solo se pide en modo stream Y con setup completo: sin TMDB token
  // el backend responde 4xx; en ese caso mostramos el SetupPrompt.
  const { data: status } = useSetupStatus(streamMode);
  const catalogEnabled = streamMode && status?.setupCompleted === true;

  const queryClient = useQueryClient();
  const continueQuery = useQuery({
    ...continueWatchingQuery(lang),
    enabled: catalogEnabled,
  });
  const continueItems = continueQuery.data ?? [];
  // Al volver al Inicio (p. ej. tras salir del reproductor) refrescamos las
  // posiciones para que "Continuar viendo" refleje lo recién visto.
  useFocusEffect(
    useCallback(() => {
      if (catalogEnabled) {
        queryClient.invalidateQueries({ queryKey: ['continue-watching'] });
      }
    }, [catalogEnabled, queryClient]),
  );
  // Una sola petición para todo el feed: el backend resuelve las filas que el
  // usuario configuró en la web (más el hero) y las devuelve ya con sus items,
  // en vez de que la app pida fila por fila.
  const feedQuery = useQuery({
    ...feedSectionsQuery(lang),
    enabled: catalogEnabled,
  });

  const sections = feedQuery.data?.sections ?? [];
  const heroItems = feedQuery.data?.hero ?? [];
  // Solo skeleton si aún no hay datos en cache (primera carga real). Incluye
  // continueQuery para que todo el contenido aparezca en un solo bloque en vez
  // de revelarse fila por fila conforme cada query resuelve (efecto cascada).
  const loading = feedQuery.isLoading || continueQuery.isLoading;
  const error =
    feedQuery.isError || feedQuery.data?.error === 'network'
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

  if (status && !status.setupCompleted) return <SetupPrompt />;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <ScrollShadow
        style={{ flex: 1 }}
        size={36}
        color={COLORS.background}
        LinearGradientComponent={ExpoLinearGradient}
      >
      <ScrollView contentContainerStyle={{ paddingBottom: 32, gap: 24 }}>
        {loading ? (
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

        {loading
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
                title={section.title}
              />
            ))}

        {error && !loading ? (
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
