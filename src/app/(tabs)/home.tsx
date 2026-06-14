import { useQuery } from '@tanstack/react-query';
import { LinearGradient as ExpoLinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ScrollShadow, Skeleton, Typography } from 'heroui-native';
import { useCallback } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { HeroCarousel } from '@/components/home/hero-carousel';
import { PosterRow } from '@/components/home/poster-row';
import { SetupPrompt, useSetupStatus } from '@/components/setup-prompt';
import { apiFetch, type MediaMeta } from '@/lib/api';
import { COLORS } from '@/lib/theme';

const HERO_TAKE = 8;

export default function HomeTab() {
  const { height: windowHeight } = useWindowDimensions();
  const heroSkeletonHeight = Math.round(windowHeight * 0.72);

  // useQuery cachea cada catálogo: al volver a Inicio se muestra al instante
  // (sin skeleton) y solo revalida en segundo plano si pasó el staleTime.
  const { data: status } = useSetupStatus();
  const moviesQuery = useQuery({
    queryKey: ['catalog', 'movie', 'trending'],
    queryFn: () =>
      apiFetch<{ results: MediaMeta[] }>(
        '/api/onevid-catalog?type=movie&catalog=trending',
      ).then((r) => r.results ?? []),
  });
  const seriesQuery = useQuery({
    queryKey: ['catalog', 'series', 'trending'],
    queryFn: () =>
      apiFetch<{ results: MediaMeta[] }>(
        '/api/onevid-catalog?type=series&catalog=trending',
      ).then((r) => r.results ?? []),
  });

  const movies = moviesQuery.data ?? [];
  const series = seriesQuery.data ?? [];
  // Solo skeleton si aún no hay datos en cache (primera carga real).
  const loading = moviesQuery.isLoading || seriesQuery.isLoading;
  const error =
    moviesQuery.isError && seriesQuery.isError
      ? 'No pudimos cargar el catálogo. Reintenta en un momento.'
      : null;

  const heroItems = interleave(movies, series).slice(0, HERO_TAKE);

  const handlePressItem = useCallback((item: MediaMeta) => {
    router.push({
      pathname: '/detail/[type]/[id]',
      params: { type: item.type, id: item.id },
    });
  }, []);

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

        <PosterRow
          title="Películas en tendencia"
          items={movies}
          loading={loading}
          onPressItem={handlePressItem}
        />
        <PosterRow
          title="Series en tendencia"
          items={series}
          loading={loading}
          onPressItem={handlePressItem}
        />

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

function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
}
