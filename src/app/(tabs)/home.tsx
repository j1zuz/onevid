import { router } from 'expo-router';
import { CloudOff } from 'lucide-react-native';
import { Button, Card, Skeleton, Typography } from 'heroui-native';
import { useCallback, useEffect, useState } from 'react';
import { Linking, ScrollView, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { HeroCarousel } from '@/components/home/hero-carousel';
import { PosterRow } from '@/components/home/poster-row';
import { apiFetch, type MediaMeta } from '@/lib/api';
import { API_URL } from '@/lib/auth';
import { COLORS } from '@/lib/theme';

interface SetupStatus {
  setupCompleted: boolean;
  hasTmdbToken: boolean;
  hasTorboxKey: boolean;
  addonsCount: number;
}

const SETUP_URL = `${API_URL}/home/1vid`;
const HERO_TAKE = 8;

export default function HomeTab() {
  const { height: windowHeight } = useWindowDimensions();
  const heroSkeletonHeight = Math.round(windowHeight * 0.72);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [movies, setMovies] = useState<MediaMeta[]>([]);
  const [series, setSeries] = useState<MediaMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([
      apiFetch<SetupStatus>('/api/onevid-setup-complete'),
      apiFetch<{ results: MediaMeta[] }>(
        '/api/onevid-catalog?type=movie&catalog=top',
      ),
      apiFetch<{ results: MediaMeta[] }>(
        '/api/onevid-catalog?type=series&catalog=top',
      ),
    ])
      .then(([statusRes, moviesRes, seriesRes]) => {
        if (cancelled) return;
        if (statusRes.status === 'fulfilled') setStatus(statusRes.value);
        if (moviesRes.status === 'fulfilled')
          setMovies(moviesRes.value.results ?? []);
        if (seriesRes.status === 'fulfilled')
          setSeries(seriesRes.value.results ?? []);
        const catalogFailed =
          moviesRes.status === 'rejected' && seriesRes.status === 'rejected';
        if (catalogFailed) {
          setError('No pudimos cargar el catálogo. Reintenta en un momento.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const heroItems = interleave(movies, series).slice(0, HERO_TAKE);

  const handlePressItem = useCallback((item: MediaMeta) => {
    router.push({
      pathname: '/detail/[type]/[id]',
      params: { type: item.type, id: item.id },
    });
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
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

        {status && !status.setupCompleted ? (
          <View style={{ paddingHorizontal: 16 }}>
            <Card>
              <Card.Body className="items-center gap-4 py-6">
                <CloudOff size={48} color="#888" />
                <View className="items-center gap-2">
                  <Typography type="h5" align="center">
                    Configura 1vid para empezar
                  </Typography>
                  <Typography type="body-sm" color="muted" align="center">
                    Aún no completaste la configuración. Abre hackw.tech en tu
                    navegador, agrega tu token de TMDB, tu API key de TorBox y
                    al menos un addon.
                  </Typography>
                </View>
                <Button onPress={() => Linking.openURL(SETUP_URL)}>
                  Configurar en hackw.tech
                </Button>
              </Card.Body>
            </Card>
          </View>
        ) : null}

        <PosterRow
          title="Películas populares"
          items={movies}
          loading={loading}
          onPressItem={handlePressItem}
        />
        <PosterRow
          title="Series populares"
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
