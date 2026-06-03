import { Skeleton, Typography } from 'heroui-native';
import { FlatList, View } from 'react-native';
import type { MediaMeta } from '@/lib/api';
import { PosterCard } from '@/components/poster-card';

const CARD_WIDTH = 140;

interface PosterRowProps {
  title: string;
  items: MediaMeta[];
  loading?: boolean;
  onPressItem?: (item: MediaMeta) => void;
}

export function PosterRow({ title, items, loading, onPressItem }: PosterRowProps) {
  return (
    <View className="gap-3">
      <Typography type="h4" weight="bold" style={{ paddingHorizontal: 16 }}>
        {title}
      </Typography>
      {loading ? (
        <View
          style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16 }}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder
              key={i}
              style={{
                width: CARD_WIDTH,
                aspectRatio: 2 / 3,
                borderRadius: 12,
              }}
            />
          ))}
        </View>
      ) : (
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
              onPress={() => onPressItem?.(item)}
            />
          )}
        />
      )}
    </View>
  );
}
