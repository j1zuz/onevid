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
  // Tarjetas horizontales (16/9) del mismo tamaño que "Continuar viendo"
  // (rowCardWidth), para que todas las filas de catálogo se vean consistentes.
  const { rowCardWidth } = useResponsive();
  // No mostramos una fila vacía: si no está cargando y no hay items, ocultamos
  // el título por completo (evita ver "Películas/Series en tendencia" sueltos,
  // sin tarjetas, en el instante en que la app abre y el catálogo aún no llega).
  if (!loading && items.length === 0) return null;
  const cardAspectRatio = 16 / 9;
  const CARD_WIDTH = rowCardWidth;
  return (
    <View className="gap-3">
      {/* El inicio pinta filas de skeleton antes de saber cuántas filas tiene
          el feed del usuario ni cómo se llaman, así que sin título va también
          un skeleton en su lugar (un Typography vacío dejaría un hueco). */}
      {title ? (
        <Typography type="h4" weight="bold" style={{ paddingHorizontal: 16 }}>
          {title}
        </Typography>
      ) : (
        <Skeleton
          style={{ width: 160, height: 20, borderRadius: 6, marginHorizontal: 16 }}
        />
      )}
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
                onPress={() => onPressItem?.(item)}
              />
            )}
          />
        </ScrollShadow>
      )}
    </View>
  );
}
