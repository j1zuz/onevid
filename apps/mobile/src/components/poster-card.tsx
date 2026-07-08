import { Image } from 'expo-image';
import { PressableFeedback, Typography } from 'heroui-native';
import { View } from 'react-native';
import { useTvFocus, tvFocusRing } from '@/hooks/use-tv-focus';
import { type MediaMeta, tmdbImage } from '@/lib/api';

interface PosterCardProps {
  item: MediaMeta;
  width?: number;
  /**
   * Tarjeta horizontal (16/9) con el backdrop en vez del póster vertical (2/3).
   * Opt-in: solo las filas del Inicio en TV lo activan; las grids (discover) y
   * detalle siguen verticales.
   */
  landscape?: boolean;
  onPress?: () => void;
}

export function PosterCard({
  item,
  width,
  landscape = false,
  onPress,
}: PosterCardProps) {
  const containerStyle = width != null ? { width } : undefined;
  const { focused, focusProps } = useTvFocus();
  // En modo horizontal usamos el backdrop; si falta, caemos al póster (recortado
  // a 16/9 con cover).
  const imgPath = landscape ? (item.background ?? item.poster) : item.poster;
  const imgSize = landscape ? 'w780' : 'w500';
  return (
    <PressableFeedback
      onPress={onPress}
      {...focusProps}
      className="gap-1"
      style={[{ flex: width == null ? 1 : undefined }, containerStyle]}
    >
      <View
        className="w-full overflow-hidden rounded-xl bg-muted"
        style={[{ aspectRatio: landscape ? 16 / 9 : 2 / 3 }, tvFocusRing(focused)]}
      >
        {imgPath ? (
          <Image
            source={tmdbImage(imgPath, imgSize) ?? imgPath}
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
