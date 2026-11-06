import { Image } from 'expo-image';
import { PressableFeedback, Typography } from 'heroui-native';
import { Tv } from 'lucide-react-native';
import { View } from 'react-native';
import { tvFocusRing, useTvFocus } from '@/hooks/use-tv-focus';
import { type LiveTvChannel, safeChannelLogo } from '@/lib/live-tv';
import { COLORS } from '@/lib/theme';

/**
 * Tarjeta de canal de Live TV con el MISMO marco que las tarjetas de Inicio
 * (`PosterCard`): 16:9, radio 12, `bg-muted`, anillo de foco en TV y título de
 * una línea debajo. Así el grid de Live TV y las filas del feed se ven
 * consistentes con el resto de la app en móvil y en TV.
 */
export function ChannelCard({
  channel,
  width,
  onPress,
}: {
  channel: LiveTvChannel;
  /** Ancho fijo en carruseles; sin él, la tarjeta ocupa la celda del grid. */
  width?: number;
  onPress: () => void;
}) {
  const { focused, focusProps } = useTvFocus();
  const logo = safeChannelLogo(channel.logo);
  const containerStyle = width != null ? { width } : undefined;

  return (
    <PressableFeedback
      accessibilityLabel={channel.name}
      accessibilityRole="button"
      onPress={onPress}
      {...focusProps}
      className="gap-1"
      style={[{ flex: width == null ? 1 : undefined }, containerStyle]}
    >
      <View
        className="w-full overflow-hidden"
        style={[
          {
            aspectRatio: 16 / 9,
            borderRadius: 12,
            backgroundColor: COLORS.surface,
          },
          tvFocusRing(focused),
        ]}
      >
        {logo ? (
          <Image
            // Igual que en PosterCard: clave estable para que una FlatList que
            // recicla celdas no reutilice un bitmap ya liberado (se veía gris
            // al volver de otra pantalla en Android).
            recyclingKey={channel.id}
            source={{ uri: logo }}
            contentFit="contain"
            transition={150}
            cachePolicy="memory-disk"
            style={{
              position: 'absolute',
              top: 10,
              left: 10,
              right: 10,
              bottom: 10,
            }}
          />
        ) : (
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Tv size={26} color="#737373" />
          </View>
        )}
      </View>
      <Typography type="body-sm" weight="medium" truncate>
        {channel.name}
      </Typography>
    </PressableFeedback>
  );
}
