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
  // Tarjetas horizontales (16/9) en todas las plataformas. En TV el ancho se
  // calcula desde el ancho real de la pantalla para que entren ~5 tarjetas por
  // fila (con un pequeño asomo de la 6ª que invita a desplazar), en vez de un
  // ancho fijo que solo mostraba 3. Se acota para que no queden ni gigantes ni
  // diminutas en TVs de distinta densidad.
  const { posterWidth, isTV, width } = useResponsive();
  // No mostramos una fila vacía: si no está cargando y no hay items, ocultamos
  // el título por completo (evita ver "Películas/Series en tendencia" sueltos,
  // sin tarjetas, en el instante en que la app abre y el catálogo aún no llega).
  if (!loading && items.length === 0) return null;
  const cardAspectRatio = 16 / 9;
  // (ancho útil − paddings 16×2) entre 4.7 ≈ tarjetas horizontales más grandes
  // con asomo de la siguiente para mantener la pista de scroll.
  const CARD_WIDTH = isTV
    ? Math.min(360, Math.max(220, Math.round((width - 32) / 4.7)))
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
                onPress={() => onPressItem?.(item)}
              />
            )}
          />
        </ScrollShadow>
      )}
    </View>
  );
}
