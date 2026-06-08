import { Image } from 'expo-image';
import { PressableFeedback, Typography } from 'heroui-native';
import { View } from 'react-native';
import { useTvFocus, tvFocusRing } from '@/hooks/use-tv-focus';
import { type MediaMeta, tmdbImage } from '@/lib/api';

interface PosterCardProps {
  item: MediaMeta;
  width?: number;
  onPress?: () => void;
}

export function PosterCard({ item, width, onPress }: PosterCardProps) {
  const containerStyle = width != null ? { width } : undefined;
  const { focused, focusProps } = useTvFocus();
  return (
    <PressableFeedback
      onPress={onPress}
      {...focusProps}
      className="gap-1"
      style={[{ flex: width == null ? 1 : undefined }, containerStyle]}
    >
      <View
        className="w-full overflow-hidden rounded-xl bg-muted"
        style={[{ aspectRatio: 2 / 3 }, tvFocusRing(focused)]}
      >
        {item.poster ? (
          <Image
            source={tmdbImage(item.poster, 'w500') ?? item.poster}
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
    </PressableFeedback>
  );
}
