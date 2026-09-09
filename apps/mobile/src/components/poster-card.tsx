import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { PressableFeedback, Typography } from 'heroui-native';
import { View } from 'react-native';
import { useTvFocus, tvFocusRing } from '@/hooks/use-tv-focus';
import { type MediaMeta, tmdbImage } from '@/lib/api';
import { useImageGeneration } from '@/lib/image-refresh';

interface PosterCardProps {
  item: MediaMeta;
  width?: number;
  /**
   * Todas las tarjetas de contenido son horizontales (16/9) con el backdrop.
   * Pasa `landscape={false}` explícitamente para el caso raro que necesite el
   * póster vertical (2/3) original.
   */
  landscape?: boolean;
  /** Progreso de reproducción 0–1: dibuja una barra inferior ("Continuar viendo"). */
  progress?: number;
  /** Posición dentro de una lista Top 10. */
  rank?: number;
  onPress?: () => void;
}

export function PosterCard({
  item,
  width,
  landscape = true,
  progress,
  rank,
  onPress,
}: PosterCardProps) {
  const containerStyle = width != null ? { width } : undefined;
  const { focused, focusProps } = useTvFocus();
  // Cambia al salir del reproductor: fuerza a expo-image a recargar la carátula
  // (que en Android queda en gris tras la superficie de vídeo). Ver image-refresh.
  const imgGen = useImageGeneration();
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
            // `recyclingKey` atado al título: al volver del detalle/reproductor
            // las FlatList reciclan estas celdas y, sin una clave estable,
            // expo-image reutiliza la vista nativa con el bitmap ya liberado y
            // se queda en gris. Con la clave, resetea y recarga la imagen del
            // ítem correcto. El prefijo de generación fuerza además una recarga
            // al volver del reproductor (bitmap liberado por la GPU en Android).
            recyclingKey={`${imgGen}:${item.type}:${item.id}`}
            source={tmdbImage(imgPath, imgSize) ?? imgPath}
            contentFit="cover"
            transition={150}
            cachePolicy="memory-disk"
            style={{ width: '100%', height: '100%' }}
          />
        ) : null}
        {rank != null && rank >= 1 && rank <= 10 ? (
          <View
            className="overflow-hidden"
            style={{
              position: 'absolute',
              top: 4,
              left: 4,
              width: 40,
              height: 24,
              paddingTop: 0,
              paddingLeft: 4,
              borderTopLeftRadius: 6,
              alignItems: 'center',
              justifyContent: 'flex-start',
              transform: [{ skewX: '-12deg' }],
            }}
          >
            <BlurView
              intensity={85}
              tint="default"
              style={{
                position: 'absolute',
                top: -4,
                right: -4,
                bottom: -4,
                left: -4,
                backgroundColor: 'rgba(255,255,255,0.08)',
              }}
            />
            <Typography type="body" weight="medium" style={{ color: '#fff', transform: [{ skewX: '12deg' }] }}>
              #{rank}
            </Typography>
          </View>
        ) : null}
        {progress != null && progress > 0 ? (
          <View
            style={{
              position: 'absolute',
              left: 8,
              right: 8,
              bottom: 8,
              height: 3,
              borderRadius: 999,
              backgroundColor: 'rgba(0,0,0,0.5)',
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${Math.min(100, Math.max(0, progress * 100))}%`,
                height: '100%',
                borderRadius: 999,
                backgroundColor: '#fff',
              }}
            />
          </View>
        ) : null}
      </View>
      <Typography type="body-sm" weight="medium" truncate>
        {item.name}
      </Typography>
    </PressableFeedback>
  );
}
