import { LinearGradient } from 'expo-linear-gradient';
import { PressableFeedback, ScrollShadow, Skeleton, Typography } from 'heroui-native';
import { ChevronRight } from 'lucide-react-native';
import { FlatList, View } from 'react-native';
import { PosterCard } from '@/components/poster-card';
import { useResponsive } from '@/hooks/use-responsive';
import { useTvFocus, tvFocusRing } from '@/hooks/use-tv-focus';
import type { MediaMeta } from '@/lib/api';
import { navigateToCatalog, parseFeedHref } from '@/lib/catalog-nav';
import { COLORS } from '@/lib/theme';

// Tope de items que se muestran en la fila del Inicio antes de "Ver todos": el
// resto (hasta 100) se ve en la grilla /catalog, igual que en la web.
const ROW_ITEM_CAP = 10;

interface PosterRowProps {
  title: string;
  items: MediaMeta[];
  loading?: boolean;
  onPressItem?: (item: MediaMeta) => void;
  /** `href` de la fila (backend) para la vista "Ver todos"; sin él no se muestra. */
  href?: string;
  /** La fila corresponde a tendencias generales de películas/series. */
  topTen?: boolean;
  /** Posiciones TMDB dentro del Top 10 combinado. */
  topTenRanks?: Record<string, number>;
}

export function PosterRow({
  title,
  items,
  loading,
  onPressItem,
  href,
  topTen = false,
  topTenRanks = {},
}: PosterRowProps) {
  // Tarjetas horizontales (16/9) del mismo tamaño que "Continuar viendo"
  // (rowCardWidth), para que todas las filas de catálogo se vean consistentes.
  const { rowCardWidth } = useResponsive();
  // No mostramos una fila vacía: si no está cargando y no hay items, ocultamos
  // el título por completo (evita ver "Películas/Series en tendencia" sueltos,
  // sin tarjetas, en el instante en que la app abre y el catálogo aún no llega).
  if (!loading && items.length === 0) return null;
  const cardAspectRatio = 16 / 9;
  const CARD_WIDTH = rowCardWidth;
  // Solo las primeras 10; el botón "Ver todos" lleva a la grilla completa.
  const shown = items.slice(0, ROW_ITEM_CAP);
  const rowParams = href ? parseFeedHref(href) : null;
  return (
    <View className="gap-3">
      {/* El inicio pinta filas de skeleton antes de saber cuántas filas tiene
          el feed del usuario ni cómo se llaman, así que sin título va también
          un skeleton en su lugar (un Typography vacío dejaría un hueco). */}
      {title ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            paddingHorizontal: 16,
          }}
        >
          <Typography type="h4" weight="bold" style={{ flexShrink: 1 }}>
            {title}
          </Typography>
          {!loading && rowParams ? (
            <SeeAllButton onPress={() => navigateToCatalog(title, rowParams)} />
          ) : null}
        </View>
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
            // En Android las celdas recortadas no siempre se re-adjuntan al
            // volver de otra pantalla y quedan en gris; lo desactivamos (las
            // filas son cortas, sin coste real de memoria).
            removeClippedSubviews={false}
            data={shown}
            keyExtractor={(it) => `${it.type}:${it.id}`}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            renderItem={({ item, index }) => (
              <PosterCard
                item={item}
                width={CARD_WIDTH}
                rank={
                  topTen
                    ? topTenRanks[`${item.type}-${item.id}`]
                    : undefined
                }
                onPress={() => onPressItem?.(item)}
              />
            )}
          />
        </ScrollShadow>
      )}
    </View>
  );
}

// Botón "Ver todos" junto al título de la fila (equivalente al de la web).
function SeeAllButton({ onPress }: { onPress: () => void }) {
  const { focused, focusProps } = useTvFocus();
  return (
    <PressableFeedback
      onPress={onPress}
      {...focusProps}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 2,
          paddingVertical: 4,
          paddingLeft: 8,
        },
        tvFocusRing(focused),
      ]}
    >
      <Typography type="body-sm" weight="medium" style={{ color: '#4f9dff' }}>
        Ver todos
      </Typography>
      <ChevronRight size={16} color="#4f9dff" />
    </PressableFeedback>
  );
}
