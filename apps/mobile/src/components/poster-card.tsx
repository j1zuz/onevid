import { Image } from 'expo-image';
import { BlurTargetView, BlurView } from 'expo-blur';
import { PressableFeedback, Typography } from 'heroui-native';
import { CircleCheck } from 'lucide-react-native';
import { useRef } from 'react';
import { Image as NativeImage, View } from 'react-native';
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
  /** Título ya terminado: dibuja el check de "visto". */
  watched?: boolean;
  onPress?: () => void;
}

export function PosterCard({
  item,
  width,
  landscape = true,
  progress,
  rank,
  watched,
  onPress,
}: PosterCardProps) {
  const containerStyle = width != null ? { width } : undefined;
  const { focused, focusProps } = useTvFocus();
  const blurTargetRef = useRef<View>(null);
  // Cambia al salir del reproductor: fuerza a expo-image a recargar la carátula
  // (que en Android queda en gris tras la superficie de vídeo). Ver image-refresh.
  const imgGen = useImageGeneration();
  // En modo horizontal usamos el backdrop; si falta, caemos al póster (recortado
  // a 16/9 con cover).
  const imgPath = landscape ? (item.background ?? item.poster) : item.poster;
  const imgSize = landscape ? 'w780' : 'w500';
  const imageSource = imgPath ? (tmdbImage(imgPath, imgSize) ?? imgPath) : null;
  return (
    <PressableFeedback
      onPress={onPress}
      {...focusProps}
      className="gap-1"
      style={[{ flex: width == null ? 1 : undefined }, containerStyle]}
    >
      <View
        className="w-full overflow-hidden bg-muted"
        style={[
          {
            aspectRatio: landscape ? 16 / 9 : 2 / 3,
            // El badge nace en (0,0). Si conservamos el radio de la tarjeta en
            // esta esquina, el propio recorte deja visible una cuña de imagen
            // que parece margen. Con ranking esa esquina pertenece al badge.
            borderTopLeftRadius: rank != null ? 0 : 12,
            borderTopRightRadius: 12,
            borderBottomRightRadius: 12,
            borderBottomLeftRadius: 12,
          },
          tvFocusRing(focused),
        ]}
      >
        <BlurTargetView
          ref={blurTargetRef}
          style={{ width: '100%', height: '100%' }}
        >
          {imageSource ? (
            <Image
              // `recyclingKey` atado al título: al volver del detalle/reproductor
              // las FlatList reciclan estas celdas y, sin una clave estable,
              // expo-image reutiliza la vista nativa con el bitmap ya liberado y
              // se queda en gris. Con la clave, resetea y recarga la imagen del
              // ítem correcto. El prefijo de generación fuerza además una recarga
              // al volver del reproductor (bitmap liberado por la GPU en Android).
              recyclingKey={`${imgGen}:${item.type}:${item.id}`}
              source={imageSource}
              contentFit="cover"
              transition={150}
              cachePolicy="memory-disk"
              style={{ width: '100%', height: '100%' }}
            />
          ) : null}
        </BlurTargetView>
        {/* Badge de Top 10, con la MISMA forma que la web: bordes superior e
            izquierdo rectos y solo el derecho en diagonal. Antes se inclinaba
            todo el contenedor con skewX, que torcía también el borde izquierdo
            y el número. Aquí el recuadro exterior recorta recto y la diagonal la
            pone el relleno inclinado de dentro, que sobresale por la izquierda
            (fuera del recorte) para que ese lado siga viéndose recto. */}
        {rank != null && rank >= 1 && rank <= 10 ? (
          <View
            className="overflow-hidden"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: 50,
              height: 32,
              justifyContent: 'flex-start',
            }}
          >
            <View
              style={{
                position: 'absolute',
                top: -6,
                bottom: -6,
                left: -24,
                // Dejamos libre el extremo derecho: al inclinar este relleno se
                // forma una diagonal visible en vez de volver a cubrir todo el
                // rectángulo exterior.
                right: 8,
                overflow: 'hidden',
                transform: [{ skewX: '-18deg' }],
              }}
            >
              {/* En Android BlurView devolvía una placa gris en FlatList incluso
                  con BlurTargetView. Una copia desenfocada del mismo backdrop es
                  determinista en móvil y TV y conserva colores/textura reales. */}
              {imageSource ? (
                <NativeImage
                  source={{ uri: imageSource }}
                  resizeMode="cover"
                  blurRadius={4}
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0,
                  }}
                />
              ) : null}
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  bottom: 0,
                  left: 0,
                  backgroundColor: 'rgba(0,0,0,0.12)',
                }}
              />
            </View>
            <Typography
              type="body"
              weight="medium"
              style={{ color: '#fff', paddingTop: 3, paddingLeft: 7 }}
            >
              #{rank}
            </Typography>
          </View>
        ) : null}
        {/* Ya visto: check en la esquina opuesta al Top 10, para que un título
            pueda llevar los dos sin pisarse. */}
        {watched ? (
          <View
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              width: 24,
              height: 24,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            <BlurView
              blurTarget={blurTargetRef}
              blurMethod="dimezisBlurViewSdk31Plus"
              intensity={60}
              tint="dark"
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                backgroundColor: 'rgba(0,0,0,0.45)',
              }}
            />
            <CircleCheck size={16} color="#fff" />
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
