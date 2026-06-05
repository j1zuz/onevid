import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { ScrollShadow, Typography } from 'heroui-native';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PosterRow } from '@/components/home/poster-row';
import type { MediaMeta } from '@/lib/api';
import { getFavorites, getWatchlistItems } from '@/lib/saved';
import { COLORS } from '@/lib/theme';

export default function LibraryTab() {
  const [favorites, setFavorites] = useState<MediaMeta[]>([]);
  const [watchlist, setWatchlist] = useState<MediaMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [favM, favS, watM, watS] = await Promise.all([
        getFavorites('movie').catch(() => []),
        getFavorites('series').catch(() => []),
        getWatchlistItems('movie').catch(() => []),
        getWatchlistItems('series').catch(() => []),
      ]);
      setFavorites(interleave(favM, favS));
      setWatchlist(interleave(watM, watS));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handlePressItem = useCallback((item: MediaMeta) => {
    router.push({
      pathname: '/detail/[type]/[id]',
      params: { type: item.type, id: item.id },
    });
  }, []);

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
        <ScrollView contentContainerStyle={{ paddingVertical: 16, gap: 20 }}>
          <View style={{ paddingHorizontal: 16, gap: 4 }}>
            <Typography type="h2">Biblioteca</Typography>
            <Typography type="body" color="muted">
              Tus títulos guardados
            </Typography>
          </View>

          <Section
            title="Favoritos"
            items={favorites}
            loading={loading}
            onPressItem={handlePressItem}
            emptyText="Aún no tienes favoritos."
          />
          <Section
            title="Ver después"
            items={watchlist}
            loading={loading}
            onPressItem={handlePressItem}
            emptyText="Tu lista de ver después está vacía."
          />
        </ScrollView>
      </ScrollShadow>
    </SafeAreaView>
  );
}

function Section({
  title,
  items,
  loading,
  onPressItem,
  emptyText,
}: {
  title: string;
  items: MediaMeta[];
  loading: boolean;
  onPressItem: (item: MediaMeta) => void;
  emptyText: string;
}) {
  if (!loading && items.length === 0) {
    return (
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        <Typography type="h4" weight="bold">
          {title}
        </Typography>
        <Typography type="body-sm" color="muted">
          {emptyText}
        </Typography>
      </View>
    );
  }
  return (
    <PosterRow
      title={title}
      items={items}
      loading={loading}
      onPressItem={onPressItem}
    />
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
