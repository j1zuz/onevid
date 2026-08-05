import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { ScrollShadow, SearchField, Skeleton, Typography } from 'heroui-native';
import { Search } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '@/components/empty-state';
import { PosterCard } from '@/components/poster-card';
import { PosterRow } from '@/components/home/poster-row';
import { SetupPrompt, useSetupStatus } from '@/components/setup-prompt';
import { useAppSurface } from '@/hooks/use-app-surface';
import { useResponsive } from '@/hooks/use-responsive';
import {
  apiFetch,
  type FeedSectionsResponse,
  type MediaMeta,
} from '@/lib/api';
import { navigateToDetail } from '@/lib/detail-nav';
import { COLORS } from '@/lib/theme';

// Filas de skeleton mientras llega el feed: no sabemos cuántas trae hasta que
// responde el backend.
const SKELETON_ROWS = 2;

export default function DiscoverTab() {
  const { t, i18n } = useTranslation();
  // Idioma activo en las query keys: al cambiarlo, React Query refetchea el
  // catálogo/búsqueda en el nuevo idioma en vez de servir la cache anterior.
  const lang = i18n.language;
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const { posterColumns } = useResponsive();
  // `insets.top` viene de `initialWindowMetrics` (sembrado sincrónicamente por
  // SafeAreaProvider en _layout.tsx): a diferencia de `<SafeAreaView>` (nativo,
  // mide en un frame posterior al primer render), esto evita el salto donde el
  // contenido aparece pegado arriba y luego "baja" a su padding correcto.
  const insets = useSafeAreaInsets();

  // Buscar es parte del modo Stream: en modo local mostramos un empty state y no
  // pedimos catálogo. `surface` se revalida en cada focus.
  const surface = useAppSurface();
  const streamMode = surface?.showLocal === false;
  // El catálogo/búsqueda solo se piden en modo stream Y con setup completo (sin
  // TMDB token el backend responde 4xx; mostramos el SetupPrompt en su lugar).
  const { data: status } = useSetupStatus(streamMode);
  const catalogEnabled = streamMode && status?.setupCompleted === true;

  const isSearching = query.trim().length > 0;

  // Debounce de la búsqueda.
  useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(() => setDebouncedQuery(trimmed), 400);
    return () => clearTimeout(timer);
  }, [query]);

  // Las filas de Descubrir son las que el usuario configuró en la web (pestaña
  // "Descubrir" del paso 2), no un selector de cadena local: así esta pantalla
  // y la web muestran lo mismo. Igual que el Inicio, en una sola petición.
  const feedQuery = useQuery({
    queryKey: ['feed-sections', 'discover', lang],
    queryFn: () =>
      apiFetch<FeedSectionsResponse>(
        '/api/onevid-feed/sections?surface=discover',
      ),
    enabled: catalogEnabled && !isSearching,
  });
  const sections = feedQuery.data?.sections ?? [];
  const catalogLoading = feedQuery.isLoading;

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

  const handlePressItem = useCallback(
    (item: MediaMeta) => {
      navigateToDetail(queryClient, item, lang);
    },
    [queryClient, lang],
  );

  if (surface == null)
    return <View style={{ flex: 1, backgroundColor: COLORS.background }} />;
  // Modo local, o stream sin sesión (TV): empty state pidiendo iniciar sesión.
  if (surface.showLocal || !surface.authed)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: COLORS.background,
          paddingTop: insets.top,
        }}
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
      </View>
    );
  if (status && !status.setupCompleted) return <SetupPrompt />;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.background,
        paddingTop: insets.top,
      }}
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
                  // Evita celdas en gris al volver de otra pantalla en Android.
                  removeClippedSubviews={false}
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
              <Typography type="h2" style={{ paddingHorizontal: 16 }}>
                {t('Descubrir')}
              </Typography>

              {catalogLoading
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

              {!catalogLoading && sections.length === 0 ? (
                <Typography
                  type="body-sm"
                  color="muted"
                  align="center"
                  style={{ paddingHorizontal: 16 }}
                >
                  {t(
                    'No hay títulos para mostrar. Configura Descubrir desde la web.',
                  )}
                </Typography>
              ) : null}
            </>
          )}
        </ScrollView>
      </ScrollShadow>
    </View>
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
            style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 12 }}
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
