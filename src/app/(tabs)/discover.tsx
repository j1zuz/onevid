import { router } from 'expo-router';
import { SearchField, Skeleton, Typography } from 'heroui-native';
import { BottomSheet } from 'heroui-native/bottom-sheet';
import { Check, ChevronDown } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PosterCard } from '@/components/poster-card';
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
  const [type, setType] = useState<SelectOption>(TYPE_OPTIONS[0]);
  const [catalog, setCatalog] = useState<SelectOption>(CATALOG_OPTIONS[0]);
  const [network, setNetwork] = useState<SelectOption>(NETWORK_OPTIONS[0]);
  const [activeFilter, setActiveFilter] = useState<FilterKey | null>(null);
  const [results, setResults] = useState<MediaMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSearching = query.trim().length > 0;
  const isSheetOpen = activeFilter !== null;

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setError(null);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ q: trimmed, type: type.value });
        const data = await apiFetch<{ results: MediaMeta[] }>(
          `/api/search?${params.toString()}`,
        );
        setResults(data.results ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error de búsqueda');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [query, type.value]);

  useEffect(() => {
    if (isSearching) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      type: type.value,
      catalog: catalog.value,
    });
    if (network.value !== 'all') params.set('network', network.value);
    apiFetch<{ results: MediaMeta[] }>(
      `/api/onevid-catalog?${params.toString()}`,
    )
      .then((data) => {
        if (!cancelled) setResults(data.results ?? []);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Error de red');
          setResults([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isSearching, type.value, catalog.value, network.value]);

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

        {loading ? <SkeletonGrid /> : null}

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
            data={results}
            keyExtractor={(item) => `${item.type}:${item.id}`}
            numColumns={2}
            scrollEnabled={false}
            columnWrapperStyle={{ gap: 12 }}
            contentContainerStyle={{ gap: 16 }}
            renderItem={({ item }) => (
              <View style={{ flex: 1 / 2 }}>
                <PosterCard item={item} onPress={() => handlePressItem(item)} />
              </View>
            )}
          />
        ) : null}
      </ScrollView>

      <BottomSheet
        isOpen={isSheetOpen}
        onOpenChange={(open) => {
          if (!open) setActiveFilter(null);
        }}
      >
        <BottomSheet.Portal>
          <BottomSheet.Overlay />
          <BottomSheet.Content>
            <BottomSheet.Title>
              {activeFilter ? FILTER_TITLES[activeFilter] : ''}
            </BottomSheet.Title>
            <View style={{ marginTop: 16 }}>
              {activeOptions.map((opt) => {
                const selected = opt.value === activeSelected?.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => handlePickOption(opt)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 14,
                      paddingHorizontal: 4,
                    }}
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
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 999,
        backgroundColor: 'rgba(255,255,255,0.08)',
      }}
    >
      <Typography type="body-sm" weight="medium">
        {label}
      </Typography>
      <ChevronDown size={16} color="#fff" />
    </Pressable>
  );
}

function SkeletonGrid() {
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
      }}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder
        <View key={i} style={{ width: '48%', gap: 6 }}>
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
