import { Image } from 'expo-image';
import { Typography } from 'heroui-native';
import { Pressable, View } from 'react-native';
import type { MediaMeta } from '@/lib/api';

interface PosterCardProps {
  item: MediaMeta;
  width?: number;
  onPress?: () => void;
}

export function PosterCard({ item, width, onPress }: PosterCardProps) {
  const containerStyle = width != null ? { width } : undefined;
  return (
    <Pressable
      onPress={onPress}
      className="gap-1"
      style={[{ flex: width == null ? 1 : undefined }, containerStyle]}
    >
      <View
        className="w-full overflow-hidden rounded-xl bg-muted"
        style={{ aspectRatio: 2 / 3 }}
      >
        {item.poster ? (
          <Image
            source={item.poster}
            contentFit="cover"
            transition={150}
            cachePolicy="memory-disk"
            style={{ width: '100%', height: '100%' }}
          />
        ) : null}
      </View>
      <Typography type="body-sm" weight="medium" truncate>
        {item.name}
      </Typography>
      <Typography type="body-xs" color="muted">
        {item.type === 'movie' ? 'Película' : 'Serie'}
        {item.year ? ` · ${item.year}` : ''}
      </Typography>
    </Pressable>
  );
}
