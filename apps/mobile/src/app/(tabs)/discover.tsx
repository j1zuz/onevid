import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ScrollShadow, SearchField, Skeleton, Typography } from 'heroui-native';
import { Search } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '@/components/empty-state';
import { PosterCard } from '@/components/poster-card';
import { PosterRow } from '@/components/home/poster-row';
import { SetupPrompt, useSetupStatus } from '@/components/setup-prompt';
import { useAppSurface } from '@/hooks/use-app-surface';
import { useResponsive } from '@/hooks/use-responsive';
import { useTvFocus } from '@/hooks/use-tv-focus';
import { apiFetch, type MediaMeta } from '@/lib/api';
import { COLORS } from '@/lib/theme';

interface Network {
  /** ID de la cadena en TMDB (lo entiende /api/onevid-catalog?network=). */
  value: string;
  label: string;
  /** Ruta del logo en TMDB (negro sobre transparente → va en tarjeta clara). */
  logo: string;
}

// Cadenas que soportamos. Los logos son de TMDB (image.tmdb.org sirve imágenes
// sin API key); al ser negros sobre transparente se muestran en tarjeta blanca.
const NETWORKS: Network[] = [
  { value: '213', label: 'Netflix', logo: '/wwemzKWzjKYJFfCeiB57q3r4Bcm.png' },
  { value: '1024', label: 'Prime Video', logo: '/w7HfLNm9CWwRmAMU58udl2L7We7.png' },
  { value: '2739', label: 'Disney+', logo: '/1edZOYAfoyZyZ3rklNSiUpXX30Q.png' },
  { value: '2552', label: 'Apple TV+', logo: '/bngHRFi794mnMq34gfVcm9nDxN1.png' },
  { value: '49', label: 'HBO', logo: '/tuomPhY2UtuPTqqFnKMVHvSb724.png' },
  { value: '4330', label: 'Paramount+', logo: '/fi83B1oztoS47xxcemFdPMhIzK.png' },
];

const networkLogoUrl = (logo: string) => `https://image.tmdb.org/t/p/w300${logo}`;

export default function DiscoverTab() {
  const { t, i18n } = useTranslation();
  // Idioma activo en las query keys: al cambiarlo, React Query refetchea el
  // catálogo/búsqueda en el nuevo idioma en vez de servir la cache anterior.
  const lang = i18n.language;
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [network, setNetwork] = useState<Network>(NETWORKS[0]);
  const { posterColumns, isTV } = useResponsive();

  // Buscar es parte del modo Stream: en modo local mostramos un empty state y no
  // pedimos catálogo. `surface` se revalida en cada focus.
  const surface = useAppSurface();
  const streamMode = surface?.showLocal === false;
  // El catálogo/búsqueda solo se piden en modo stream Y con setup completo (sin
  // TMDB token el backend responde 4xx; mostramos el SetupPrompt en su lugar).
  const { data: status } = useSetupStatus(streamMode);
  const catalogEnabled = streamMode && status?.setupCompleted === true;

  const isSearching = query.trim().length > 0;

  // Tarjetas de cadenas en el slider horizontal: más grandes en TV.
  const cardW = isTV ? 200 : 132;

  // Debounce de la búsqueda.
  useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(() => setDebouncedQuery(trimmed), 400);
    return () => clearTimeout(timer);
  }, [query]);

  // Populares de la cadena seleccionada (películas y series), cacheadas por red.
  const moviesQuery = useQuery({
    queryKey: ['catalog', 'movie', 'top', network.value, lang],
    queryFn: () =>
      apiFetch<{ results: MediaMeta[] }>(
        `/api/onevid-catalog?type=movie&catalog=top&network=${network.value}`,
      ).then((r) => r.results ?? []),
    enabled: catalogEnabled && !isSearching,
  });
  const seriesQuery = useQuery({
    queryKey: ['catalog', 'series', 'top', network.value, lang],
    queryFn: () =>
      apiFetch<{ results: MediaMeta[] }>(
        `/api/onevid-catalog?type=series&catalog=top&network=${network.value}`,
      ).then((r) => r.results ?? []),
    enabled: catalogEnabled && !isSearching,
  });

  // Búsqueda: cubre películas y series, intercaladas.
  const searchMoviesQuery = useQuery({
    queryKey: ['search', debouncedQuery, 'movie', lang],
    queryFn: () =>
      apiFetch<{ results: MediaMeta[] }>(
        `/api/search?q=${encodeURIComponent(debouncedQuery)}&type=movie`,
      ).then((r) => r.results ?? []),
    enabled: catalogEnabled && isSearching && debouncedQuery.length > 0,
  });
  const searchSeriesQuery = useQuery({
    queryKey: ['search', debouncedQuery, 'series', lang],
    queryFn: () =>
      apiFetch<{ results: MediaMeta[] }>(
        `/api/search?q=${encodeURIComponent(debouncedQuery)}&type=series`,
      ).then((r) => r.results ?? []),
    enabled: catalogEnabled && isSearching && debouncedQuery.length > 0,
  });

  const searchResults = interleave(
    searchMoviesQuery.data ?? [],
    searchSeriesQuery.data ?? [],
  );
  const searchLoading =
    searchMoviesQuery.isLoading ||
    searchSeriesQuery.isLoading ||
    debouncedQuery !== query.trim();
  const searchError =
    !searchLoading &&
    searchMoviesQuery.isError &&
    searchSeriesQuery.isError
      ? t('Error de búsqueda')
      : null;

  const handlePressItem = useCallback((item: MediaMeta) => {
    router.push({
      pathname: '/detail/[type]/[id]',
      params: { type: item.type, id: item.id },
    });
  }, []);

  if (surface == null)
    return <View style={{ flex: 1, backgroundColor: COLORS.background }} />;
  // Modo local, o stream sin sesión (TV): empty state pidiendo iniciar sesión.
  if (surface.showLocal || !surface.authed)
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: COLORS.background }}
        edges={['top']}
      >
        <EmptyState
          icon={<Search size={32} color="#9ca3af" />}
          title={t('Buscar')}
          description={
            surface.authed
              ? t('Disponible en modo Stream.')
              : t('Inicia sesión para buscar tu contenido.')
          }
        />
      </SafeAreaView>
    );
  if (status && !status.setupCompleted) return <SetupPrompt />;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      edges={['top']}
    >
      <ScrollShadow
        style={{ flex: 1 }}
        size={28}
        color={COLORS.background}
        LinearGradientComponent={LinearGradient}
      >
        <ScrollView
          contentContainerStyle={{ gap: 16, paddingVertical: 16, paddingBottom: 32 }}
        >
          <View style={{ paddingHorizontal: 16, gap: 16 }}>
            <Typography type="h2">{t('Buscar')}</Typography>
            <SearchField value={query} onChange={setQuery}>
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder={t('Buscar películas, series…')} />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
          </View>

          {isSearching ? (
            <View style={{ paddingHorizontal: 16, gap: 16 }}>
              {searchLoading ? <SkeletonGrid columns={posterColumns} /> : null}

              {!searchLoading && searchError ? (
                <Typography type="body-sm" color="muted" align="center">
                  {searchError}
                </Typography>
              ) : null}

              {!searchLoading && !searchError && searchResults.length === 0 ? (
                <Typography type="body" color="muted" align="center">
                  {t('No encontramos nada para «{{query}}».', { query: query.trim() })}
                </Typography>
              ) : null}

              {!searchLoading && searchResults.length > 0 ? (
                <FlatList
                  // RN exige re-montar el FlatList al cambiar numColumns.
                  key={posterColumns}
                  data={searchResults}
                  keyExtractor={(item) => `${item.type}:${item.id}`}
                  numColumns={posterColumns}
                  scrollEnabled={false}
                  columnWrapperStyle={{ gap: 12 }}
                  contentContainerStyle={{ gap: 16 }}
                  renderItem={({ item }) => (
                    <View style={{ flex: 1 / posterColumns }}>
                      <PosterCard
                        item={item}
                        onPress={() => handlePressItem(item)}
                      />
                    </View>
                  )}
                />
              ) : null}
            </View>
          ) : (
            <>
              <View style={{ gap: 12 }}>
                <Typography type="h2" style={{ paddingHorizontal: 16 }}>
                  {t('Descubrir')}
                </Typography>
                <ScrollShadow
                  size={32}
                  color={COLORS.background}
                  LinearGradientComponent={LinearGradient}
                >
                  <FlatList
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    data={NETWORKS}
                    keyExtractor={(n) => n.value}
                    contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
                    renderItem={({ item }) => (
                      <NetworkCard
                        network={item}
                        width={cardW}
                        selected={item.value === network.value}
                        onPress={() => setNetwork(item)}
                      />
                    )}
                  />
                </ScrollShadow>
              </View>

              {/* La cadena (network de TMDB) aplica a series; muchas no tienen
                  películas asociadas. Ocultamos cada fila si no hay resultados. */}
              {moviesQuery.isLoading || (moviesQuery.data?.length ?? 0) > 0 ? (
                <PosterRow
                  title={t('Películas populares')}
                  items={moviesQuery.data ?? []}
                  loading={moviesQuery.isLoading}
                  onPressItem={handlePressItem}
                />
              ) : null}
              {seriesQuery.isLoading || (seriesQuery.data?.length ?? 0) > 0 ? (
                <PosterRow
                  title={t('Series populares')}
                  items={seriesQuery.data ?? []}
                  loading={seriesQuery.isLoading}
                  onPressItem={handlePressItem}
                />
              ) : null}

              {!moviesQuery.isLoading &&
              !seriesQuery.isLoading &&
              (moviesQuery.data?.length ?? 0) === 0 &&
              (seriesQuery.data?.length ?? 0) === 0 ? (
                <Typography
                  type="body-sm"
                  color="muted"
                  align="center"
                  style={{ paddingHorizontal: 16 }}
                >
                  {t('No hay títulos para esta cadena.')}
                </Typography>
              ) : null}
            </>
          )}
        </ScrollView>
      </ScrollShadow>
    </SafeAreaView>
  );
}

function NetworkCard({
  network,
  width,
  selected,
  onPress,
}: {
  network: Network;
  width: number;
  selected: boolean;
  onPress: () => void;
}) {
  const { focused, focusProps } = useTvFocus();
  // En TV el anillo sigue al foco del D-pad; en móvil (sin foco) marcamos la
  // cadena seleccionada con el mismo anillo azul.
  const ringed = focused || (!Platform.isTV && selected);
  return (
    <Pressable
      onPress={onPress}
      {...focusProps}
      style={{
        width,
        aspectRatio: 3 / 2,
        borderRadius: 14,
        backgroundColor: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        borderWidth: 3,
        borderColor: ringed ? '#4f9dff' : 'transparent',
      }}
    >
      <Image
        source={networkLogoUrl(network.logo)}
        contentFit="contain"
        cachePolicy="memory-disk"
        transition={150}
        style={{ width: '100%', height: '100%' }}
      />
    </Pressable>
  );
}

function SkeletonGrid({ columns = 2 }: { columns?: number }) {
  // Ancho por celda dejando ~3% de gap entre columnas.
  const itemWidth = `${Math.floor(100 / columns) - 3}%` as `${number}%`;
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
      }}
    >
      {Array.from({ length: columns * 3 }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder
        <View key={i} style={{ width: itemWidth, gap: 6 }}>
          <Skeleton
            style={{ width: '100%', aspectRatio: 2 / 3, borderRadius: 12 }}
          />
          <Skeleton style={{ height: 14, borderRadius: 4 }} />
          <Skeleton style={{ height: 10, width: '60%', borderRadius: 4 }} />
        </View>
      ))}
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
