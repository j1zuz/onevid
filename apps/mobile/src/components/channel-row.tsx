import { LinearGradient } from 'expo-linear-gradient';
import { ScrollShadow, Skeleton, Typography } from 'heroui-native';
import { FlatList, View } from 'react-native';
import { ChannelCard } from '@/components/channel-card';
import { useResponsive } from '@/hooks/use-responsive';
import {
  type LiveTvChannel,
  playLiveTvChannel,
} from '@/lib/live-tv';
import { COLORS } from '@/lib/theme';

/**
 * Fila horizontal de canales, con el mismo aspecto que las filas de Inicio
 * (`PosterRow`): título h4, tarjetas del ancho `rowCardWidth` y scroll
 * horizontal con el degradado de borde de `ScrollShadow`.
 */
export function ChannelRow({
  title,
  channels,
}: {
  title: string;
  channels: LiveTvChannel[];
}) {
  const { rowCardWidth } = useResponsive();
  if (channels.length === 0) return null;

  return (
    <View style={{ gap: 12 }}>
      <Typography
        type="h4"
        weight="bold"
        numberOfLines={1}
        style={{ paddingHorizontal: 16 }}
      >
        {title}
      </Typography>
      <ScrollShadow
        size={32}
        color={COLORS.background}
        LinearGradientComponent={LinearGradient}
      >
        <FlatList
          horizontal
          data={channels}
          keyExtractor={(channel) => channel.id}
          showsHorizontalScrollIndicator={false}
          // Igual que en Inicio: evita celdas en gris al volver de otra
          // pantalla en Android.
          removeClippedSubviews={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={5}
          renderItem={({ item }) => (
            <ChannelCard
              channel={item}
              width={rowCardWidth}
              onPress={() => playLiveTvChannel(item)}
            />
          )}
        />
      </ScrollShadow>
    </View>
  );
}

/** Placeholder de filas mientras llegan los canales. */
export function ChannelRowsSkeleton({ rows = 3 }: { rows?: number }) {
  const { rowCardWidth } = useResponsive();
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder estático
        <View key={rowIndex} style={{ gap: 12 }}>
          <Skeleton
            style={{
              width: 160,
              height: 20,
              borderRadius: 6,
              marginHorizontal: 16,
            }}
          />
          <View
            style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16 }}
          >
            {Array.from({ length: 4 }).map((_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholder estático
              <View key={index} style={{ width: rowCardWidth, gap: 4 }}>
                <Skeleton
                  style={{
                    width: '100%',
                    aspectRatio: 16 / 9,
                    borderRadius: 12,
                  }}
                />
                <Skeleton style={{ height: 14, borderRadius: 4 }} />
              </View>
            ))}
          </View>
        </View>
      ))}
    </>
  );
}
