import { Image } from 'expo-image';
import { BlurTargetView, BlurView } from 'expo-blur';
import { PressableFeedback, Typography } from 'heroui-native';
import { CircleCheck } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Image as NativeImage, View } from 'react-native';
import Svg, { ClipPath, Defs, Image as SvgImage, Path } from 'react-native-svg';
import { useTvFocus, tvFocusRing } from '@/hooks/use-tv-focus';
import { type MediaMeta, tmdbImage } from '@/lib/api';
import { useImageGeneration } from '@/lib/image-refresh';

// Badge de Top 10: mismo tamaño (h-7 w-11) y misma silueta que la web.
const RANK_BADGE_W = 44;
const RANK_BADGE_H = 28;
// El `clip-path` de la web recorta el borde derecho del badge: arriba mide
// 100 % y abajo el 82 % (44 → 36). El trozo que se quita es este triángulo.
const RANK_BADGE_CUT = 8;

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
  // Tamaño real de la tarjeta, medido sólo cuando hay badge de Top 10: el blur
  // del badge es una copia de la carátula a ese tamaño, alineada con ella, para
  // que muestre la esquina (lo que hay detrás) y no la carátula entera encogida.
  const [cardSize, setCardSize] = useState<{ w: number; h: number } | null>(
    null,
  );
  // Cambia al salir del reproductor: fuerza a expo-image a recargar la carátula
  // (que en Android queda en gris tras la superficie de vídeo). Ver image-refresh.
  const imgGen = useImageGeneration();
  // En modo horizontal usamos el backdrop; si falta, caemos al póster (recortado
  // a 16/9 con cover).
  const imgPath = landscape ? (item.background ?? item.poster) : item.poster;
  const imgSize = landscape ? 'w780' : 'w500';
  const imageSource = imgPath ? (tmdbImage(imgPath, imgSize) ?? imgPath) : null;
  // Tamaño con el que se dibujan las copias del arte dentro del badge: el real
  // de la tarjeta para quedar alineadas con ella (y mientras aún no está
  // medido, el del propio badge, que dura un solo frame).
  const artW = cardSize?.w ?? RANK_BADGE_W;
  const artH = cardSize?.h ?? RANK_BADGE_H;
  return (
    <PressableFeedback
      onPress={onPress}
      {...focusProps}
      className="gap-1"
      style={[{ flex: width == null ? 1 : undefined }, containerStyle]}
    >
      <View
        className="w-full overflow-hidden bg-muted"
        onLayout={
          rank != null
            ? (e) => {
                const { width: w, height: h } = e.nativeEvent.layout;
                setCardSize((prev) =>
                  prev && Math.abs(prev.w - w) < 0.5 && Math.abs(prev.h - h) < 0.5
                    ? prev
                    : { w, h },
                );
              }
            : undefined
        }
        style={[
          {
            aspectRatio: landscape ? 16 / 9 : 2 / 3,
            // La esquina de la tarjeta conserva su radio aunque haya badge:
            // el badge se adapta a la curva en vez de cuadrarla.
            borderTopLeftRadius: 12,
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
              // 1 px de más por cada lado: al mantener pulsada la tarjeta,
              // PressableFeedback la escala (0.985) y el redondeo subpíxel
              // dejaba ver una línea del `bg-muted` del contenedor en el borde
              // inferior. Con el pequeño desborde (que recorta la tarjeta) la
              // imagen siempre cubre hasta el borde.
              style={{
                position: 'absolute',
                top: -1,
                left: -1,
                right: -1,
                bottom: -1,
              }}
            />
          ) : null}
        </BlurTargetView>
        {/* Badge de Top 10 con la MISMA forma que la web: 44x28 (h-7 w-11),
            esquina superior izquierda redondeada y borde derecho en diagonal
            (arriba ancho, abajo al 82 %). El fondo va recortado por el propio
            contenedor (rectángulo con esquina redondeada) y el "corte" diagonal
            se dibuja encima con la carátula nítida recortada a ese triángulo:
            así el badge se ve cortado como en la web, sin depender de máscaras
            ni de skew (en Android/TV el `overflow: hidden` de una vista
            transformada no recorta y el badge salía cuadrado). */}
        {rank != null && rank >= 1 && rank <= 10 ? (
          <View
            className="overflow-hidden"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: RANK_BADGE_W,
              height: RANK_BADGE_H,
              borderTopLeftRadius: 10,
            }}
          >
            {/* Copia de la carátula al tamaño real de la tarjeta y alineada
                con ella, desenfocada: el badge toma la esquina de la carátula
                (lo que hay detrás) y el color combina con la tarjeta. Se usa
                una copia con `blurRadius` en vez de `BlurView` porque en
                Android/TV el BlurView devolvía una placa gris. */}
            {imageSource ? (
              <NativeImage
                source={{ uri: imageSource }}
                resizeMode="cover"
                blurRadius={18}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: artW,
                  height: artH,
                }}
              />
            ) : null}
            {/* Tinte suave, como el bg-black/20 de la web. */}
            <View
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                backgroundColor: 'rgba(0,0,0,0.15)',
              }}
            />
            {/* Corte diagonal: carátula nítida (la misma que hay detrás del
                badge, alineada con la tarjeta) recortada al triángulo que la
                web quita con el clip-path. */}
            {imageSource ? (
              <Svg
                pointerEvents="none"
                style={{ position: 'absolute', top: 0, left: 0 }}
                width={RANK_BADGE_W}
                height={RANK_BADGE_H}
              >
                <Defs>
                  <ClipPath id="rank-cut">
                    <Path
                      d={`M${RANK_BADGE_W - RANK_BADGE_CUT} ${RANK_BADGE_H} L${RANK_BADGE_W} 0 L${RANK_BADGE_W} ${RANK_BADGE_H} Z`}
                    />
                  </ClipPath>
                </Defs>
                <SvgImage
                  href={imageSource}
                  x={0}
                  y={0}
                  width={artW}
                  height={artH}
                  preserveAspectRatio="xMidYMid slice"
                  clipPath="url(#rank-cut)"
                />
              </Svg>
            ) : null}
            <Typography
              type="body"
              weight="medium"
              numberOfLines={1}
              style={{
                color: '#fff',
                paddingTop: 1,
                paddingLeft: 6,
                lineHeight: 26,
              }}
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
