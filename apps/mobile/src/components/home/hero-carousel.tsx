import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Button, Typography } from 'heroui-native';
import { GlassIcon } from '@/components/glass-icon';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTvFocus, tvFocusRing } from '@/hooks/use-tv-focus';
import { apiFetch, type MediaMeta, tmdbImage } from '@/lib/api';
import { useImageGeneration } from '@/lib/image-refresh';
import { navigateToDetail } from '@/lib/detail-nav';
import { COLORS } from '@/lib/theme';

const AUTOPLAY_MS = 5000;
const HERO_HEIGHT_RATIO = 0.72;

interface HeroCarouselProps {
  items: MediaMeta[];
}

export function HeroCarousel({ items }: HeroCarouselProps) {
  const { width, height: windowHeight } = useWindowDimensions();
  const slideHeight = Math.round(windowHeight * HERO_HEIGHT_RATIO);
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const queryClient = useQueryClient();
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
            onPressPlay={() => navigateToDetail(queryClient, item, lang)}
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
  const { t } = useTranslation();
  const playFocus = useTvFocus();
  // Fuerza recargar el backdrop al volver del reproductor (ver image-refresh).
  const imgGen = useImageGeneration();
  // En TV alineamos el contenido a la izquierda (estilo Netflix/Apple TV) y
  // mostramos la sinopsis. En móvil se mantiene centrado y sin descripción.
  const isTV = Platform.isTV;
  // En TV pedimos el backdrop en 'original' (pantalla grande, se agradece la
  // máxima calidad); en móvil 'w1280' basta y pesa menos. El placeholder 'w185'
  // se muestra al instante mientras carga la versión grande (evita hero en negro
  // si el reproductor desaloja las imágenes grandes de RAM en gama baja).
  const bg = tmdbImage(item.background ?? item.poster, isTV ? 'original' : 'w1280');
  const lowRes = tmdbImage(item.background ?? item.poster, 'w185');
  // Logo del título (imagen tipográfica de TMDB) en vez del nombre en texto.
  // El catálogo no trae logo, así que lo pedimos aparte y lo cacheamos por
  // (type,id). Si no hay logo, caemos al nombre en texto.
  const logoQuery = useQuery({
    queryKey: ['tmdb-logo', item.type, item.id],
    queryFn: () =>
      apiFetch<{ logo: string | null }>(
        `/api/tmdb-logo?type=${item.type}&id=${encodeURIComponent(item.id)}`,
      ).then((r) => r.logo),
    staleTime: 60 * 60 * 1000,
  });
  const logo = tmdbImage(logoQuery.data ?? undefined, 'w500');
  return (
    <View style={{ width, height }}>
      {bg ? (
        <Image
          source={bg}
          recyclingKey={`${imgGen}:${bg}`}
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
          alignItems: isTV ? 'flex-start' : 'center',
          paddingHorizontal: isTV ? 48 : 24,
          maxWidth: isTV ? '55%' : undefined,
          gap: 16,
        }}
      >
        {logo ? (
          <Image
            source={logo}
            contentFit="contain"
            // Anclamos el logo abajo-izquierda (TV) / abajo-centro (móvil): los
            // logos de 1 línea dejan hueco dentro de la caja con 'contain'; al
            // fijarlos abajo, la separación con la descripción es consistente y
            // no queda ese espacio grande entre logo y texto.
            contentPosition={isTV ? 'bottom left' : 'bottom center'}
            transition={200}
            cachePolicy="memory-disk"
            style={{
              width: isTV ? 280 : 190,
              height: isTV ? 96 : 70,
              alignSelf: isTV ? 'flex-start' : 'center',
            }}
          />
        ) : (
          <Typography
            type="h2"
            align={isTV ? 'start' : 'center'}
            color="default"
            weight="bold"
          >
            {item.name}
          </Typography>
        )}
        {isTV && item.description ? (
          <Typography
            type="body-sm"
            color="muted"
            align="start"
            numberOfLines={3}
            className="text-balance"
          >
            {item.description}
          </Typography>
        ) : null}
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
            {t('Reproducir')}
          </Typography>
        </Button>
      </View>
    </View>
  );
}
