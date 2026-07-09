import { LinearGradient } from 'expo-linear-gradient';
import { ScrollShadow, Skeleton, Typography } from 'heroui-native';
import { FlatList, View } from 'react-native';
import type { MediaMeta } from '@/lib/api';
import { PosterCard } from '@/components/poster-card';
import { useResponsive } from '@/hooks/use-responsive';
import { COLORS } from '@/lib/theme';

interface PosterRowProps {
  title: string;
  items: MediaMeta[];
  loading?: boolean;
  onPressItem?: (item: MediaMeta) => void;
}

export function PosterRow({ title, items, loading, onPressItem }: PosterRowProps) {
  // En TV las tarjetas del Inicio son horizontales (16/9); en móvil verticales
  // (2/3). En TV el ancho se calcula desde el ancho real de la pantalla para que
  // entren ~5 tarjetas por fila (con un pequeño asomo de la 6ª que invita a
  // desplazar), en vez de un ancho fijo que solo mostraba 3. Se acota para que no
  // queden ni gigantes ni diminutas en TVs de distinta densidad.
  const { posterWidth, isTV, width } = useResponsive();
  const cardAspectRatio = isTV ? 16 / 9 : 2 / 3;
  // (ancho útil − paddings 16×2) entre 5.3 ≈ 5 tarjetas + asomo de la siguiente.
  const CARD_WIDTH = isTV
    ? Math.min(320, Math.max(180, Math.round((width - 32) / 5.3)))
    : posterWidth;
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
                aspectRatio: cardAspectRatio,
                borderRadius: 12,
              }}
            />
          ))}
        </View>
      ) : (
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
                landscape={isTV}
                onPress={() => onPressItem?.(item)}
              />
            )}
          />
        </ScrollShadow>
      )}
    </View>
  );
}
