import { LinearGradient } from 'expo-linear-gradient';
import { ScrollShadow, Typography } from 'heroui-native';
import { useCallback } from 'react';
import { FlatList, View } from 'react-native';
import { PosterCard } from '@/components/poster-card';
import { useResponsive } from '@/hooks/use-responsive';
import type { MediaMeta } from '@/lib/api';
import { COLORS } from '@/lib/theme';

// Tope de la fila: el resto se ve en la biblioteca/historial. Evita montar
// decenas de tarjetas en un 2 GB.
const CONTINUE_ITEM_CAP = 10;

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
  const shown = items.slice(0, CONTINUE_ITEM_CAP);
  const renderItem = useCallback(
    ({ item }: { item: ContinueWatchingItem }) => (
      <PosterCard
        item={item}
        width={CARD_WIDTH}
        landscape
        progress={
          item.durationSec > 0 ? item.positionSec / item.durationSec : undefined
        }
        onPress={() => onPressItem?.(item)}
      />
    ),
    [CARD_WIDTH, onPressItem],
  );

  if (shown.length === 0) {
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
          // Evita celdas en gris al volver de otra pantalla en Android.
          removeClippedSubviews={false}
          data={shown}
          keyExtractor={(it) => `${it.type}:${it.id}`}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          initialNumToRender={Math.min(shown.length, 3)}
          maxToRenderPerBatch={3}
          updateCellsBatchingPeriod={50}
          windowSize={3}
          renderItem={renderItem}
        />
      </ScrollShadow>
    </View>
  );
}
