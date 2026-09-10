import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Skeleton, Typography } from 'heroui-native';
import { ArrowLeft } from 'lucide-react-native';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '@/components/empty-state';
import { PosterCard } from '@/components/poster-card';
import { useResponsive } from '@/hooks/use-responsive';
import { tvFocusRing, useTvFocus } from '@/hooks/use-tv-focus';
import { apiFetch, type MediaMeta } from '@/lib/api';
import { navigateToDetail } from '@/lib/detail-nav';
import { COLORS } from '@/lib/theme';
import { useWatchState } from '@/lib/watch-state';

// Cuántos items pide la vista "Ver todos" (el backend pagina TMDB hasta acá).
const VIEW_ALL_LIMIT = 100;

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/**
 * Grilla "Ver todos" de una fila del feed: pide el catálogo completo (hasta 100)
 * a `/api/onevid-catalog` y lo pinta en una rejilla. Es la contraparte móvil/TV
 * de la vista "Ver todo" de la web.
 */
export default function CatalogScreen() {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const params = useLocalSearchParams();
  const queryClient = useQueryClient();
  const { posterColumns } = useResponsive();
  const watchState = useWatchState();
  const backFocus = useTvFocus();

  const title = firstParam(params.title);
  const type = firstParam(params.type);
  const catalog = firstParam(params.catalog);
  const network = firstParam(params.network);
  const addonId = firstParam(params.addonId);
  const addonCatalogId = firstParam(params.addonCatalogId);

  const query = useQuery({
    queryKey: [
      'catalog-all',
      type,
      catalog,
      network,
      addonId,
      addonCatalogId,
      lang,
    ],
    queryFn: () => {
      // Query armada a mano: el polyfill de URLSearchParams en RN no trae `.set`.
      const parts = [
        `type=${encodeURIComponent(type)}`,
        `catalog=${encodeURIComponent(catalog)}`,
        `limit=${VIEW_ALL_LIMIT}`,
      ];
      if (network) parts.push(`network=${encodeURIComponent(network)}`);
      if (addonId) parts.push(`addonId=${encodeURIComponent(addonId)}`);
      if (addonCatalogId)
        parts.push(`addonCatalogId=${encodeURIComponent(addonCatalogId)}`);
      return apiFetch<{
        results: MediaMeta[];
        topTenRanks?: Record<string, number>;
      }>(
        `/api/onevid-catalog?${parts.join('&')}`,
      ).then((r) => ({
        items: r.results ?? [],
        topTenRanks: r.topTenRanks ?? {},
      }));
    },
    enabled: Boolean(type && catalog),
  });

  const items = query.data?.items ?? [];
  const topTenRanks = query.data?.topTenRanks ?? {};

  const handlePressItem = useCallback(
    (item: MediaMeta) => {
      navigateToDetail(queryClient, item, lang);
    },
    [queryClient, lang],
  );

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <SafeAreaView edges={['top']}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
        >
          <Pressable
            onPress={() => router.back()}
            {...backFocus.focusProps}
            style={[
              {
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: 'rgba(255,255,255,0.1)',
                alignItems: 'center',
                justifyContent: 'center',
              },
              tvFocusRing(backFocus.focused),
            ]}
          >
            <ArrowLeft size={22} color="#fff" />
          </Pressable>
          <Typography type="h3" weight="bold" numberOfLines={1} style={{ flexShrink: 1 }}>
            {title}
          </Typography>
        </View>
      </SafeAreaView>

      {query.isLoading ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 12,
            paddingHorizontal: 16,
          }}
        >
          {Array.from({ length: posterColumns * 3 }).map((_, i) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder
              key={i}
              style={{ width: `${Math.floor(100 / posterColumns) - 3}%` }}
            >
              <Skeleton style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 12 }} />
            </View>
          ))}
        </View>
      ) : items.length === 0 ? (
        <EmptyState
          title="No hay títulos para mostrar."
          description={query.isError ? 'Reintenta en un momento.' : undefined}
        />
      ) : (
        <FlatList
          // RN exige re-montar el FlatList al cambiar numColumns.
          key={posterColumns}
          data={items}
          keyExtractor={(item) => `${item.type}:${item.id}`}
          numColumns={posterColumns}
          // Evita celdas en gris al volver de otra pantalla en Android.
          removeClippedSubviews={false}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{
            gap: 16,
            paddingHorizontal: 16,
            paddingBottom: 32,
          }}
          renderItem={({ item, index }) => (
            <View style={{ flex: 1 / posterColumns }}>
              <PosterCard
                item={item}
                rank={topTenRanks[`${item.type}-${item.id}`]}
                watched={watchState.isWatched(item.type, item.id)}
                onPress={() => handlePressItem(item)}
              />
            </View>
          )}
        />
      )}
    </View>
  );
}
