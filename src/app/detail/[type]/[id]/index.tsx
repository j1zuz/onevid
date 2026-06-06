import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient as ExpoLinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Button,
  ScrollShadow,
  Card,
  Skeleton,
  Typography,
  useToast,
} from 'heroui-native';
import { ArrowLeft } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { GlassIcon } from '@/components/glass-icon';
import { PosterCard } from '@/components/poster-card';
import {
  apiFetch,
  type CastMember,
  type MediaMeta,
  type NetworkInfo,
  tmdbImage,
} from '@/lib/api';
import {
  getSavedStatus,
  type SavedStatus,
  setFavorite,
  setWatchlist,
} from '@/lib/saved';
import { COLORS } from '@/lib/theme';

interface EpisodeItem {
  description?: string;
  id: string;
  name: string;
  number: number;
  released?: string;
  season: number;
  thumbnail?: string;
}

interface SeriesMetaResponse extends Omit<MediaMeta, 'id' | 'type'> {
  episodes: EpisodeItem[];
  seasons: number[];
}

type DetailType = 'movie' | 'series';

export default function DetailPage() {
  const params = useLocalSearchParams<{ type: string; id: string }>();
  const type = params.type as DetailType;
  const id = params.id;
  const { height } = useWindowDimensions();
  const heroHeight = Math.round(height * 0.55);
  const queryClient = useQueryClient();

  const [seasonOverride, setSeasonOverride] = useState<number | null>(null);
  const [savingFav, setSavingFav] = useState(false);
  const [savingWatch, setSavingWatch] = useState(false);
  const { toast } = useToast();

  // Metadata del título, cacheada por (type, id): volver a abrir el mismo
  // título lo muestra al instante sin skeleton.
  const detailQuery = useQuery({
    queryKey: ['detail', type, id],
    queryFn: () => {
      const path =
        type === 'series'
          ? `/api/series-meta?id=${encodeURIComponent(id)}`
          : `/api/movie-meta?id=${encodeURIComponent(id)}`;
      return apiFetch<MediaMeta | SeriesMetaResponse>(path);
    },
    enabled: Boolean(id && type),
  });

  const series: SeriesMetaResponse | null =
    type === 'series' ? ((detailQuery.data as SeriesMetaResponse) ?? null) : null;
  const meta: MediaMeta | null = useMemo(() => {
    if (!detailQuery.data) return null;
    if (type === 'series') {
      return { id, type: 'series', ...(detailQuery.data as SeriesMetaResponse) } as MediaMeta;
    }
    return detailQuery.data as MediaMeta;
  }, [detailQuery.data, type, id]);

  const loading = detailQuery.isLoading;
  const error = detailQuery.isError
    ? detailQuery.error instanceof Error
      ? detailQuery.error.message
      : 'Error de red'
    : null;

  // Temporada seleccionada: derivada (primera por defecto) + override del user.
  // Derivar evita un setState-en-effect y un render extra.
  const selectedSeason = seasonOverride ?? series?.seasons?.[0] ?? null;

  // Estado guardado (favorito/watchlist) desde la cuenta TMDB, cacheado. La
  // verdad vive en el cache; los toggles lo actualizan de forma optimista.
  const savedQuery = useQuery({
    queryKey: ['saved', type, id],
    queryFn: () => getSavedStatus(type, id),
    enabled: Boolean(id && type),
    retry: false,
  });
  const favorite = savedQuery.data?.favorite ?? false;
  const watchlist = savedQuery.data?.watchlist ?? false;

  const toggleSaved = useCallback(
    async (kind: 'favorite' | 'watchlist') => {
      if (!id || !type) return;
      const isFav = kind === 'favorite';
      const current = isFav ? favorite : watchlist;
      const next = !current;
      const setSaving = isFav ? setSavingFav : setSavingWatch;
      const apply = isFav ? setFavorite : setWatchlist;
      const key = ['saved', type, id];

      // Optimista: escribimos el cache de ['saved', …] y lo revertimos si falla.
      const writeSaved = (value: boolean) =>
        queryClient.setQueryData<SavedStatus>(key, (prev) => ({
          favorite: prev?.favorite ?? false,
          watchlist: prev?.watchlist ?? false,
          [kind]: value,
        }));

      setSaving(true);
      writeSaved(next);
      try {
        // Enviar snapshot para que la Biblioteca lo renderice sin re-fetch.
        await apply(type, id, next, {
          name: meta?.name,
          poster: meta?.poster,
          background: meta?.background,
          year: meta?.year,
        });
        // La Biblioteca lee de ['library']; invalidar hace que se refresque en
        // segundo plano (sin skeleton) la próxima vez que se muestre.
        queryClient.invalidateQueries({ queryKey: ['library'] });
      } catch {
        writeSaved(current); // revertir
        toast.show({
          variant: 'danger',
          label: 'No se pudo guardar',
          description: 'Revisa tu conexión e intenta de nuevo.',
        });
      } finally {
        setSaving(false);
      }
    },
    [id, type, favorite, watchlist, meta, toast, queryClient],
  );

  const seasonEpisodes = useMemo(
    () =>
      series?.episodes.filter((e) => e.season === selectedSeason) ?? [],
    [series, selectedSeason],
  );

  const artParams = useMemo(
    () => ({
      background: meta?.background ?? '',
      logo: meta?.logo ?? '',
      title: meta?.name ?? '',
    }),
    [meta?.background, meta?.logo, meta?.name],
  );

  const handlePlay = useCallback(() => {
    if (!id || !type) return;
    const first = seasonEpisodes[0];
    router.push({
      pathname: '/detail/[type]/[id]/sources',
      params:
        type === 'series' && first
          ? {
              type,
              id,
              season: String(first.season),
              episode: String(first.number),
              ...artParams,
            }
          : { type, id, ...artParams },
    });
  }, [id, type, seasonEpisodes, artParams]);

  const handlePlayEpisode = useCallback(
    (ep: EpisodeItem) => {
      if (!id) return;
      router.push({
        pathname: '/detail/[type]/[id]/sources',
        params: {
          type: 'series',
          id,
          season: String(ep.season),
          episode: String(ep.number),
          ...artParams,
        },
      });
    },
    [id, artParams],
  );

  const handlePressRelated = useCallback((item: MediaMeta) => {
    router.push({
      pathname: '/detail/[type]/[id]',
      params: { type: item.type, id: item.id },
    });
  }, []);

  const playLabel =
    type === 'series' && seasonEpisodes[0]
      ? `Reproducir S${seasonEpisodes[0].season}E${seasonEpisodes[0].number}`
      : 'Reproducir';

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        {/* Hero */}
        <View style={{ height: heroHeight, width: '100%' }}>
          {meta?.background || meta?.poster ? (
            <Image
              source={tmdbImage(meta.background ?? meta.poster, 'w1280') ?? ''}
              contentFit="cover"
              transition={200}
              cachePolicy="memory-disk"
              style={{ width: '100%', height: '100%' }}
            />
          ) : (
            <Skeleton style={{ width: '100%', height: '100%' }} />
          )}
          <Svg
            pointerEvents="none"
            height={Math.round(heroHeight * 0.7)}
            width="100%"
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
          >
            <Defs>
              <LinearGradient id="detailFade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={COLORS.background} stopOpacity="0" />
                <Stop offset="0.5" stopColor={COLORS.background} stopOpacity="0.5" />
                <Stop offset="1" stopColor={COLORS.background} stopOpacity="1" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#detailFade)" />
          </Svg>
        </View>

        <SafeAreaView
          edges={['top']}
          style={{ position: 'absolute', left: 12, right: 12 }}
        >
          <Pressable
            onPress={() => router.back()}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: 'rgba(0,0,0,0.55)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ArrowLeft size={22} color="#fff" />
          </Pressable>
        </SafeAreaView>

        {/* Title + buttons */}
        <View
          style={{
            marginTop: -heroHeight * 0.35,
            paddingHorizontal: 20,
            gap: 16,
          }}
        >
          {meta?.logo ? (
            <Image
              source={meta.logo}
              contentFit="contain"
              style={{ width: '100%', height: 80, alignSelf: 'center' }}
            />
          ) : (
            <Typography type="h2" align="center" weight="bold">
              {meta?.name ?? ''}
            </Typography>
          )}

          {meta?.genres && meta.genres.length > 0 ? (
            <Typography type="body-sm" color="muted" align="center">
              {meta.genres.slice(0, 3).join(' · ')}
            </Typography>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button
              variant="primary"
              onPress={handlePlay}
              style={{
                flex: 1,
                backgroundColor: '#fff',
                flexDirection: 'row',
                gap: 8,
                paddingHorizontal: 12,
              }}
            >
              <GlassIcon name="circle-arrow-right" size={20} />
              <Typography
                type="body-sm"
                weight="semibold"
                numberOfLines={1}
                style={{ color: '#000', flexShrink: 1 }}
              >
                {playLabel}
              </Typography>
            </Button>
            <Button
              variant="secondary"
              onPress={() => toggleSaved('watchlist')}
              isDisabled={savingWatch}
              style={{
                width: 52,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <GlassIcon name="doc-folder" size={20} opacity={watchlist ? 1 : 0.6} />
            </Button>
            <Button
              variant="secondary"
              onPress={() => toggleSaved('favorite')}
              isDisabled={savingFav}
              style={{
                width: 52,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <GlassIcon name="heart" size={20} opacity={favorite ? 1 : 0.6} />
            </Button>
          </View>

          {meta?.description ? (
            <Typography type="body-sm" color="default">
              {meta.description}
            </Typography>
          ) : null}

          {error ? (
            <Card>
              <Card.Body>
                <Typography type="body-sm" color="muted" align="center">
                  {error}
                </Typography>
              </Card.Body>
            </Card>
          ) : null}
        </View>

        {/* Seasons (series only) */}
        {type === 'series' && series && series.seasons.length > 0 ? (
          <SectionTitle title="Temporadas" />
        ) : null}
        {type === 'series' && series ? (
          <ScrollShadow size={28} LinearGradientComponent={ExpoLinearGradient}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
            >
              {series.seasons.map((n) => (
                <SeasonTab
                  key={`s${n}`}
                  seasonNumber={n}
                  selected={n === selectedSeason}
                  onPress={() => setSeasonOverride(n)}
                />
              ))}
            </ScrollView>
          </ScrollShadow>
        ) : null}

        {/* Episodes of selected season */}
        {type === 'series' && selectedSeason != null && seasonEpisodes.length > 0 ? (
          <>
            <SectionTitle title={`Temporada ${selectedSeason}`} />
            <ScrollShadow size={28} LinearGradientComponent={ExpoLinearGradient}>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={seasonEpisodes}
                keyExtractor={(e) => e.id}
                contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
                renderItem={({ item }) => (
                  <EpisodeCard
                    ep={item}
                    fallbackImage={meta?.background}
                    runtime={meta?.episodeRunTime}
                    onPress={() => handlePlayEpisode(item)}
                  />
                )}
              />
            </ScrollShadow>
          </>
        ) : null}

        {/* Cast */}
        {meta?.cast && meta.cast.length > 0 ? (
          <>
            <SectionTitle title="Reparto" />
            <ScrollShadow size={28} LinearGradientComponent={ExpoLinearGradient}>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={meta.cast}
                keyExtractor={(c) => c.id}
                contentContainerStyle={{ paddingHorizontal: 20, gap: 16 }}
                renderItem={({ item }) => <CastCard person={item} />}
              />
            </ScrollShadow>
          </>
        ) : null}

        {/* Networks */}
        {meta?.networks && meta.networks.length > 0 ? (
          <>
            <SectionTitle title="Cadenas" />
            <View
              style={{
                flexDirection: 'row',
                gap: 12,
                paddingHorizontal: 20,
                flexWrap: 'wrap',
              }}
            >
              {meta.networks.map((n) => (
                <NetworkChip key={n.id} network={n} />
              ))}
            </View>
          </>
        ) : null}

        {/* Detalles */}
        {meta ? <DetailsSection meta={meta} /> : null}

        {/* Related */}
        {meta?.related && meta.related.length > 0 ? (
          <>
            <SectionTitle title="Relacionados" />
            <ScrollShadow size={28} LinearGradientComponent={ExpoLinearGradient}>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={meta.related}
                keyExtractor={(it) => `${it.type}:${it.id}`}
                contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
                renderItem={({ item }) => (
                  <PosterCard
                    item={item}
                    width={130}
                    onPress={() => handlePressRelated(item)}
                  />
                )}
              />
            </ScrollShadow>
          </>
        ) : null}

        {loading ? (
          <View style={{ paddingHorizontal: 20, gap: 8, marginTop: 16 }}>
            <Skeleton style={{ height: 24, borderRadius: 8 }} />
            <Skeleton style={{ height: 60, borderRadius: 8 }} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <Typography
      type="h4"
      weight="bold"
      style={{ paddingHorizontal: 20, marginTop: 28, marginBottom: 12 }}
    >
      {title}
    </Typography>
  );
}

function SeasonTab({
  seasonNumber,
  selected,
  onPress,
}: {
  seasonNumber: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 999,
        backgroundColor: selected ? '#fff' : 'rgba(255,255,255,0.08)',
      }}
    >
      <Typography
        type="body-sm"
        weight={selected ? 'bold' : 'medium'}
        style={{ color: selected ? '#000' : '#fff' }}
      >
        Temporada {seasonNumber}
      </Typography>
    </Pressable>
  );
}

function EpisodeCard({
  ep,
  fallbackImage,
  runtime,
  onPress,
}: {
  ep: EpisodeItem;
  fallbackImage?: string;
  runtime?: number;
  onPress: () => void;
}) {
  const CARD_W = 320;
  // Aspect ratio igual al backdrop de TMDB (16:9)
  const CARD_H = Math.round((CARD_W * 9) / 16);
  const image = tmdbImage(ep.thumbnail, 'w780') ?? tmdbImage(fallbackImage, 'w780');
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: CARD_W,
        height: CARD_H,
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: '#111',
      }}
    >
      {image ? (
        <Image
          source={image}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={200}
          style={{ width: '100%', height: '100%', position: 'absolute' }}
        />
      ) : null}

      <Svg
        pointerEvents="none"
        height="100%"
        width="100%"
        style={{ position: 'absolute' }}
      >
        <Defs>
          <LinearGradient id={`epFade${ep.id}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000" stopOpacity="0.15" />
            <Stop offset="0.4" stopColor="#000" stopOpacity="0.55" />
            <Stop offset="1" stopColor="#000" stopOpacity="0.92" />
          </LinearGradient>
        </Defs>
        <Rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill={`url(#epFade${ep.id})`}
        />
      </Svg>

      <View
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          backgroundColor: 'rgba(0,0,0,0.65)',
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 6,
        }}
      >
        <Typography type="body-xs" weight="bold">
          S{ep.season}E{ep.number}
        </Typography>
      </View>

      <View
        style={{
          position: 'absolute',
          left: 14,
          right: 14,
          bottom: 12,
          gap: 6,
        }}
      >
        <Typography type="h5" weight="bold" numberOfLines={1}>
          {ep.name}
        </Typography>
        {ep.description ? (
          <Typography type="body-xs" color="muted" numberOfLines={2}>
            {ep.description}
          </Typography>
        ) : null}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            marginTop: 2,
          }}
        >
          {runtime ? (
            <Typography type="body-xs" weight="medium">
              {formatRuntime(runtime)}
            </Typography>
          ) : null}
          {ep.released ? (
            <Typography
              type="body-xs"
              color="muted"
              style={{ marginLeft: 'auto' }}
            >
              {formatDate(ep.released)}
            </Typography>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function CastCard({ person }: { person: CastMember }) {
  return (
    <View style={{ width: 100, alignItems: 'center', gap: 6 }}>
      <View
        style={{
          width: 80,
          height: 80,
          borderRadius: 40,
          overflow: 'hidden',
          backgroundColor: '#222',
        }}
      >
        {person.profile ? (
          <Image
            source={person.profile}
            contentFit="cover"
            style={{ width: '100%', height: '100%' }}
          />
        ) : null}
      </View>
      <Typography type="body-xs" weight="semibold" align="center" numberOfLines={1}>
        {person.name}
      </Typography>
      {person.character ? (
        <Typography type="body-xs" color="muted" align="center" numberOfLines={1}>
          {person.character}
        </Typography>
      ) : null}
    </View>
  );
}

function NetworkChip({ network }: { network: NetworkInfo }) {
  return (
    <View
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.08)',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
      }}
    >
      {network.logo ? (
        <Image
          source={network.logo}
          contentFit="contain"
          style={{ width: 60, height: 24 }}
        />
      ) : (
        <Typography type="body-sm" weight="semibold">
          {network.name}
        </Typography>
      )}
    </View>
  );
}

function DetailsSection({ meta }: { meta: MediaMeta }) {
  const rows: Array<{ label: string; value: string }> = [];
  if (meta.status) rows.push({ label: 'Estado', value: meta.status });
  if (meta.releaseDate)
    rows.push({ label: 'Información de estreno', value: formatDate(meta.releaseDate) });
  else if (meta.year) rows.push({ label: 'Año', value: meta.year });
  const runtime = meta.runtime ?? meta.episodeRunTime;
  if (runtime) rows.push({ label: 'Duración', value: formatRuntime(runtime) });
  if (meta.director && meta.director.length > 0)
    rows.push({ label: 'Director', value: meta.director.join(', ') });

  if (rows.length === 0) return null;

  const titleLabel = meta.type === 'series' ? 'Detalles de la serie' : 'Detalles';

  return (
    <>
      <SectionTitle title={titleLabel} />
      <View style={{ paddingHorizontal: 20, gap: 0 }}>
        {rows.map((r, i) => (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: static rows
            key={i}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              paddingVertical: 14,
              borderBottomWidth: i === rows.length - 1 ? 0 : 1,
              borderBottomColor: 'rgba(255,255,255,0.08)',
            }}
          >
            <Typography type="body-sm" color="muted">
              {r.label}
            </Typography>
            <Typography type="body-sm" weight="medium">
              {r.value}
            </Typography>
          </View>
        ))}
      </View>
    </>
  );
}

function formatRuntime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatDate(iso: string): string {
  if (iso.length === 4) return iso;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}
