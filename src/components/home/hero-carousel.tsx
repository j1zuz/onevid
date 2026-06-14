import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Button, Typography } from 'heroui-native';
import { GlassIcon } from '@/components/glass-icon';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTvFocus, tvFocusRing } from '@/hooks/use-tv-focus';
import { type MediaMeta, tmdbImage } from '@/lib/api';
import { COLORS } from '@/lib/theme';

const AUTOPLAY_MS = 5000;
const HERO_HEIGHT_RATIO = 0.72;

interface HeroCarouselProps {
  items: MediaMeta[];
}

export function HeroCarousel({ items }: HeroCarouselProps) {
  const { width, height: windowHeight } = useWindowDimensions();
  const slideHeight = Math.round(windowHeight * HERO_HEIGHT_RATIO);
  const listRef = useRef<FlatList<MediaMeta>>(null);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const userInteractingRef = useRef(false);

  useEffect(() => {
    if (items.length < 2) return;
    const id = setInterval(() => {
      if (userInteractingRef.current) return;
      setIndex((prev) => {
        const next = (prev + 1) % items.length;
        indexRef.current = next;
        listRef.current?.scrollToOffset({
          offset: next * width,
          animated: true,
        });
        return next;
      });
    }, AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [items.length, width]);

  // Al cambiar el ancho (p. ej. volver del reproductor en horizontal a la
  // pantalla en vertical) las diapositivas se redimensionan pero el scroll
  // queda en el offset viejo y el carrusel se ve en blanco. Re-alineamos la
  // diapositiva actual al nuevo ancho.
  useEffect(() => {
    const id = setTimeout(() => {
      const i = Math.min(indexRef.current, Math.max(0, items.length - 1));
      listRef.current?.scrollToOffset({ offset: i * width, animated: false });
    }, 0);
    return () => clearTimeout(id);
  }, [width, items.length]);

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      indexRef.current = next;
      setIndex(next);
      userInteractingRef.current = false;
    },
    [width],
  );

  if (items.length === 0) return null;

  return (
    <View style={{ height: slideHeight, width: '100%' }}>
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(it) => `${it.type}:${it.id}`}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={() => {
          userInteractingRef.current = true;
        }}
        onMomentumScrollEnd={onMomentumEnd}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item }) => (
          <HeroSlide
            item={item}
            width={width}
            height={slideHeight}
            onPressPlay={() =>
              router.push({
                pathname: '/detail/[type]/[id]',
                params: { type: item.type, id: item.id },
              })
            }
          />
        )}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          bottom: 16,
          left: 0,
          right: 0,
          flexDirection: 'row',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        {items.map((it, i) => (
          <View
            key={`${it.type}:${it.id}`}
            style={{
              width: i === index ? 22 : 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: i === index ? '#fff' : 'rgba(255,255,255,0.5)',
            }}
          />
        ))}
      </View>
    </View>
  );
}

function HeroSlide({
  item,
  width,
  height,
  onPressPlay,
}: {
  item: MediaMeta;
  width: number;
  height: number;
  onPressPlay: () => void;
}) {
  const playFocus = useTvFocus();
  // 'w1280' para que el hero a pantalla completa se vea nítido en pantallas
  // HiDPI ('w780' se veía borroso). El riesgo en gama baja —que el reproductor
  // desaloje la imagen grande de RAM y deje el hero en negro— lo cubre el
  // placeholder 'w185' de abajo, que se muestra al instante mientras recarga.
  const bg = tmdbImage(item.background ?? item.poster, 'w1280');
  // Placeholder de baja resolución (w185) de la MISMA portada: es minúsculo,
  // rara vez se desaloja de RAM y se muestra al instante mientras la versión
  // grande (re)carga. Evita que la diapositiva quede en negro cuando el
  // reproductor desaloja las imágenes grandes en gama baja.
  const lowRes = tmdbImage(item.background ?? item.poster, 'w185');
  return (
    <View style={{ width, height }}>
      {bg ? (
        <Image
          source={bg}
          recyclingKey={bg}
          placeholder={lowRes}
          placeholderContentFit="cover"
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
          style={{ width: '100%', height: '100%' }}
        />
      ) : (
        <View style={{ width: '100%', height: '100%', backgroundColor: '#222' }} />
      )}
      <Svg
        pointerEvents="none"
        height={Math.round(height * 0.7)}
        width="100%"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
      >
        <Defs>
          <LinearGradient id="heroFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={COLORS.background} stopOpacity="0" />
            <Stop offset="0.4" stopColor={COLORS.background} stopOpacity="0.4" />
            <Stop offset="0.75" stopColor={COLORS.background} stopOpacity="0.85" />
            <Stop offset="1" stopColor={COLORS.background} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroFade)" />
      </Svg>
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 48,
          alignItems: 'center',
          paddingHorizontal: 24,
          gap: 16,
        }}
      >
        <Typography type="h2" align="center" color="default" weight="bold">
          {item.name}
        </Typography>
        <Typography type="body-sm" color="muted" align="center">
          {item.type === 'movie' ? 'Película' : 'Serie'}
          {item.year ? `  ·  ${item.year}` : ''}
        </Typography>
        <Button
          variant="primary"
          onPress={onPressPlay}
          {...playFocus.focusProps}
          style={[
            {
              backgroundColor: '#fff',
              minWidth: 200,
              flexDirection: 'row',
              gap: 8,
            },
            tvFocusRing(playFocus.focused),
          ]}
        >
          <GlassIcon name="circle-arrow-right" size={20} />
          <Typography type="body" weight="semibold" style={{ color: '#000' }}>
            Reproducir
          </Typography>
        </Button>
      </View>
    </View>
  );
}
