import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ScrollShadow, SearchField, Skeleton, Typography } from 'heroui-native';
import { BottomSheet } from 'heroui-native/bottom-sheet';
import { Check, ChevronDown } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PosterCard } from '@/components/poster-card';
import { useResponsive } from '@/hooks/use-responsive';
import { tvFocusRing } from '@/hooks/use-tv-focus';
import { apiFetch, type MediaMeta } from '@/lib/api';
import { COLORS } from '@/lib/theme';

interface SelectOption {
  value: string;
  label: string;
}

type FilterKey = 'type' | 'catalog' | 'network';

const TYPE_OPTIONS: SelectOption[] = [
  { value: 'movie', label: 'Película' },
  { value: 'series', label: 'Series' },
];

const CATALOG_OPTIONS: SelectOption[] = [
  { value: 'top', label: 'Populares' },
  { value: 'year', label: 'Estrenos' },
  { value: 'imdbrating', label: 'Destacados' },
];

const NETWORK_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'Todos los servicios' },
  { value: '213', label: 'Netflix' },
  { value: '2739', label: 'Disney+' },
  { value: '49', label: 'HBO' },
  { value: '1024', label: 'Amazon' },
  { value: '2552', label: 'Apple TV+' },
  { value: '4330', label: 'Paramount+' },
  { value: '453', label: 'Hulu' },
  { value: '6171', label: 'Max' },
];

const FILTER_TITLES: Record<FilterKey, string> = {
  type: 'Seleccionar tipo',
  catalog: 'Seleccionar catálogo',
  network: 'Seleccionar servicio',
};

const FILTER_OPTIONS: Record<FilterKey, SelectOption[]> = {
  type: TYPE_OPTIONS,
  catalog: CATALOG_OPTIONS,
  network: NETWORK_OPTIONS,
};

export default function DiscoverTab() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [type, setType] = useState<SelectOption>(TYPE_OPTIONS[0]);
  const [catalog, setCatalog] = useState<SelectOption>(CATALOG_OPTIONS[0]);
  const [network, setNetwork] = useState<SelectOption>(NETWORK_OPTIONS[0]);
  const [activeFilter, setActiveFilter] = useState<FilterKey | null>(null);
  const { posterColumns } = useResponsive();

  const isSearching = query.trim().length > 0;

  // Debounce de la búsqueda: la query (cacheada) solo dispara con el texto ya
  // estabilizado.
  useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(() => setDebouncedQuery(trimmed), 400);
    return () => clearTimeout(timer);
  }, [query]);

  // Catálogo (modo navegación). Cacheado por type/catalog/network → cambiar de
  // filtro y volver no re-fetchea.
  const browseQuery = useQuery({
    queryKey: ['catalog', type.value, catalog.value, network.value],
    queryFn: () => {
      const params = new URLSearchParams({
        type: type.value,
        catalog: catalog.value,
      });
      if (network.value !== 'all') params.set('network', network.value);
      return apiFetch<{ results: MediaMeta[] }>(
        `/api/onevid-catalog?${params.toString()}`,
      ).then((r) => r.results ?? []);
    },
    enabled: !isSearching,
  });

  // Búsqueda. Cacheada por término + tipo.
  const searchQuery = useQuery({
    queryKey: ['search', debouncedQuery, type.value],
    queryFn: () => {
      const params = new URLSearchParams({
        q: debouncedQuery,
        type: type.value,
      });
      return apiFetch<{ results: MediaMeta[] }>(
        `/api/search?${params.toString()}`,
      ).then((r) => r.results ?? []);
    },
    enabled: isSearching && debouncedQuery.length > 0,
  });

  const activeQuery = isSearching ? searchQuery : browseQuery;
  const results = activeQuery.data ?? [];
  // En búsqueda, también mostramos skeleton mientras el debounce no alcanzó al
  // texto actual.
  const loading = isSearching
    ? searchQuery.isLoading || debouncedQuery !== query.trim()
    : browseQuery.isLoading;
  const error =
    !loading && activeQuery.isError
      ? activeQuery.error instanceof Error
        ? activeQuery.error.message
        : isSearching
          ? 'Error de búsqueda'
          : 'Error de red'
      : null;

  const breadcrumb = useMemo(() => {
    const parts = [type.label, catalog.label];
    if (network.value !== 'all') parts.push(network.label);
    return parts.join(' · ');
  }, [type.label, catalog.label, network.value, network.label]);

  const handlePressItem = useCallback((item: MediaMeta) => {
    router.push({
      pathname: '/detail/[type]/[id]',
      params: { type: item.type, id: item.id },
    });
  }, []);

  const handlePickOption = useCallback(
    (opt: SelectOption) => {
      if (!activeFilter) return;
      if (activeFilter === 'type') setType(opt);
      else if (activeFilter === 'catalog') setCatalog(opt);
      else if (activeFilter === 'network') setNetwork(opt);
      setActiveFilter(null);
    },
    [activeFilter],
  );

  const activeOptions = activeFilter ? FILTER_OPTIONS[activeFilter] : [];
  // Altura fija por cantidad de opciones → el sheet abre directo, sin el salto
  // del dynamic sizing. (título+padding ~96 + ~52 por item, tope ~85% pantalla)
  const sheetHeight = Math.min(96 + activeOptions.length * 52, 560);
  const activeSelected =
    activeFilter === 'type'
      ? type
      : activeFilter === 'catalog'
        ? catalog
        : activeFilter === 'network'
          ? network
          : null;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      edges={['top']}
    >
      <ScrollShadow
        style={{ flex: 1 }}
        size={28}
        LinearGradientComponent={LinearGradient}
      >
      <ScrollView
        contentContainerStyle={{
          gap: 16,
          paddingHorizontal: 16,
          paddingVertical: 16,
          paddingBottom: 32,
        }}
      >
        <Typography type="h2">Buscar</Typography>

        <SearchField value={query} onChange={setQuery}>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Buscar películas, series…" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>

        {!isSearching ? (
          <>
            <Typography type="h2">Descubrir</Typography>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingRight: 16 }}
            >
              <FilterChip
                label={type.label}
                onPress={() => setActiveFilter('type')}
              />
              <FilterChip
                label={catalog.label}
                onPress={() => setActiveFilter('catalog')}
              />
              <FilterChip
                label={network.label}
                onPress={() => setActiveFilter('network')}
              />
            </ScrollView>

            <Typography type="body-sm" color="muted">
              {breadcrumb}
            </Typography>
          </>
        ) : null}

        {loading ? <SkeletonGrid columns={posterColumns} /> : null}

        {!loading && error ? (
          <Typography type="body-sm" color="muted" align="center">
            {error}
          </Typography>
        ) : null}

        {!loading && !error && isSearching && results.length === 0 ? (
          <Typography type="body" color="muted" align="center">
            No encontramos nada para «{query.trim()}».
          </Typography>
        ) : null}

        {!loading && results.length > 0 ? (
          <FlatList
            // RN exige re-montar el FlatList al cambiar numColumns.
            key={posterColumns}
            data={results}
            keyExtractor={(item) => `${item.type}:${item.id}`}
            numColumns={posterColumns}
            scrollEnabled={false}
            columnWrapperStyle={{ gap: 12 }}
            contentContainerStyle={{ gap: 16 }}
            renderItem={({ item }) => (
              <View style={{ flex: 1 / posterColumns }}>
                <PosterCard item={item} onPress={() => handlePressItem(item)} />
              </View>
            )}
          />
        ) : null}
      </ScrollView>
      </ScrollShadow>

      {/* Sólo se monta cuando hay un filtro activo → no puede abrirse solo. */}
      {activeFilter ? (
        <BottomSheet
          isOpen
          onOpenChange={(open) => {
            if (!open) setActiveFilter(null);
          }}
        >
          <BottomSheet.Portal>
            <BottomSheet.Overlay />
            <BottomSheet.Content
              enableDynamicSizing={false}
              snapPoints={[sheetHeight]}
            >
              <BottomSheet.Title>
                {FILTER_TITLES[activeFilter]}
              </BottomSheet.Title>
              <View style={{ marginTop: 16 }}>
                {activeOptions.map((opt) => {
                  const selected = opt.value === activeSelected?.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => handlePickOption(opt)}
                      style={(s) => [
                        {
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingVertical: 14,
                          paddingHorizontal: 12,
                          borderRadius: 12,
                        },
                        tvFocusRing((s as { focused?: boolean }).focused ?? false),
                      ]}
                    >
                      <Typography
                        type="body"
                        weight={selected ? 'semibold' : 'medium'}
                      >
                        {opt.label}
                      </Typography>
                      {selected ? <Check size={20} color="#fff" /> : null}
                    </Pressable>
                  );
                })}
              </View>
            </BottomSheet.Content>
          </BottomSheet.Portal>
        </BottomSheet>
      ) : null}
    </SafeAreaView>
  );
}

function FilterChip({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={(s) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 999,
          backgroundColor: 'rgba(255,255,255,0.08)',
        },
        tvFocusRing((s as { focused?: boolean }).focused ?? false),
      ]}
    >
      <Typography type="body-sm" weight="medium">
        {label}
      </Typography>
      <ChevronDown size={16} color="#fff" />
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
