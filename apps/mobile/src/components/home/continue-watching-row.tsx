import { LinearGradient } from 'expo-linear-gradient';
import { ScrollShadow, Typography } from 'heroui-native';
import { FlatList, View } from 'react-native';
import { PosterCard } from '@/components/poster-card';
import { useResponsive } from '@/hooks/use-responsive';
import type { MediaMeta } from '@/lib/api';
import { COLORS } from '@/lib/theme';

export interface ContinueWatchingItem extends MediaMeta {
  durationSec: number;
  episode: number;
  positionSec: number;
  season: number;
}

interface ContinueWatchingRowProps {
  items: ContinueWatchingItem[];
  onPressItem?: (item: ContinueWatchingItem) => void;
  title: string;
}

/**
 * "Continue watching" row: landscape thumbnails with a resume progress bar,
 * mirroring Netflix/Disney+. Rendered only when there's something to resume.
 */
export function ContinueWatchingRow({
  items,
  onPressItem,
  title,
}: ContinueWatchingRowProps) {
  // Landscape (16/9) cards, del mismo tamaño (rowCardWidth) que el resto de
  // las filas de catálogo (Tendencias, Populares, Biblioteca).
  const { rowCardWidth } = useResponsive();
  const CARD_WIDTH = rowCardWidth;

  if (items.length === 0) {
    return null;
  }

  return (
    <View className="gap-3">
      <Typography type="h4" weight="bold" style={{ paddingHorizontal: 16 }}>
        {title}
      </Typography>
      <ScrollShadow
        size={32}
        color={COLORS.background}
        LinearGradientComponent={LinearGradient}
      >
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={items}
          keyExtractor={(it) => `${it.type}:${it.id}`}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          renderItem={({ item }) => (
            <PosterCard
              item={item}
              width={CARD_WIDTH}
              landscape
              progress={
                item.durationSec > 0
                  ? item.positionSec / item.durationSec
                  : undefined
              }
              onPress={() => onPressItem?.(item)}
            />
          )}
        />
      </ScrollShadow>
    </View>
  );
}
