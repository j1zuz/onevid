import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Typography } from 'heroui-native';
import { Check, X } from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  type PressableStateCallbackType,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { tvFocusRing } from '@/hooks/use-tv-focus';
import { apiFetch, type MediaMeta, tmdbImage } from '@/lib/api';

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

const isFocused = (s: PressableStateCallbackType) =>
  (s as { focused?: boolean }).focused ?? false;

export interface EpisodeSelection {
  season: string;
  episode: string;
  episodeTitle: string;
}

/**
 * Selector de episodios dentro del reproductor (solo series). Reusa la misma
 * caché que la pantalla de detalle (queryKey ['detail','series',id]). Al elegir
 * un episodio devuelve {season, episode, episodeTitle} para que el reproductor
 * abra las fuentes de ese episodio. Foco de TV en pestañas y filas; en móvil
 * `tvFocusRing` es no-op.
 */
export function EpisodePicker({
  id,
  season,
  episode,
  onSelect,
  onClose,
}: {
  id: string;
  season?: string;
  episode?: string;
  onSelect: (next: EpisodeSelection) => void;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ['detail', 'series', id],
    queryFn: () =>
      apiFetch<SeriesMetaResponse>(
        `/api/series-meta?id=${encodeURIComponent(id)}`,
      ),
    enabled: Boolean(id),
  });
  const series = query.data;

  // Ancho concreto en px (no porcentaje): en este overlay absoluto sobre el
  // reproductor en horizontal, `width: '86%'` puede colapsar a casi 0 y el texto
  // se parte a un carácter por línea. `useWindowDimensions` da el ancho real ya
  // rotado, así que la tarjeta siempre tiene un tamaño legible.
  const { width: winWidth } = useWindowDimensions();
  const cardWidth = Math.min(560, Math.round(winWidth * 0.86));

  const [selectedSeason, setSelectedSeason] = useState(
    season ? Number(season) : null,
  );
  // Si no había temporada inicial, cae en la primera al cargar.
  const effectiveSeason = selectedSeason ?? series?.seasons[0] ?? 1;
  const eps =
    series?.episodes.filter((e) => e.season === effectiveSeason) ?? [];

  const currentSeason = season ? Number(season) : undefined;
  const currentEpisode = episode ? Number(episode) : undefined;

  return (
    <View style={styles.menuRoot}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={[styles.pickerCard, { width: cardWidth }]}>
        <View style={styles.menuHeader}>
          <Typography type="h5" weight="bold">
            Episodios
          </Typography>
          <Pressable
            onPress={onClose}
            style={(s) => [styles.menuClose, tvFocusRing(isFocused(s))]}
          >
            <X size={20} color="#fff" />
          </Pressable>
        </View>

        {series && series.seasons.length > 1 ? (
          // Fila que se ajusta sola (flexWrap) en vez de ScrollView horizontal:
          // el scroll horizontal medía mal el ancho de las pastillas y el texto
          // colapsaba a un carácter por línea. Con la tarjeta de ancho concreto,
          // las pastillas fluyen y se parten a otra fila si no caben.
          <View style={styles.seasonRow}>
            {series.seasons.map((n) => (
              <Pressable
                key={n}
                onPress={() => setSelectedSeason(n)}
                style={(s) => [
                  styles.seasonTab,
                  n === effectiveSeason && styles.seasonTabActive,
                  tvFocusRing(isFocused(s)),
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.seasonText,
                    n === effectiveSeason && styles.seasonTextActive,
                  ]}
                >
                  {`Temporada ${n}`}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {query.isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : eps.length === 0 ? (
          <View style={styles.loading}>
            <Typography color="muted">No hay episodios.</Typography>
          </View>
        ) : (
          <FlatList
            data={eps}
            keyExtractor={(e) => e.id}
            contentContainerStyle={{ paddingBottom: 8 }}
            renderItem={({ item }) => {
              const active =
                item.season === currentSeason &&
                item.number === currentEpisode;
              const thumb = tmdbImage(item.thumbnail, 'w300');
              return (
                <Pressable
                  onPress={() =>
                    onSelect({
                      season: String(item.season),
                      episode: String(item.number),
                      episodeTitle: item.name,
                    })
                  }
                  style={(s) => [styles.epRow, tvFocusRing(isFocused(s))]}
                >
                  {thumb ? (
                    <Image
                      source={thumb}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      style={styles.epThumb}
                    />
                  ) : (
                    <View style={[styles.epThumb, styles.epThumbEmpty]} />
                  )}
                  <View style={styles.epBody}>
                    <Text style={styles.epTitle} numberOfLines={1}>
                      {item.number}. {item.name}
                    </Text>
                    {item.description ? (
                      <Text style={styles.epDesc} numberOfLines={2}>
                        {item.description}
                      </Text>
                    ) : null}
                  </View>
                  {active ? <Check size={18} color="#7CFC9B" /> : null}
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  menuRoot: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 30,
  },
  pickerCard: {
    // El ancho se fija inline desde useWindowDimensions (ver componente).
    maxHeight: '88%',
    backgroundColor: '#161616',
    borderRadius: 16,
    paddingTop: 8,
    overflow: 'hidden',
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  menuClose: { padding: 4, borderRadius: 8 },
  seasonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  seasonTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  seasonTabActive: { backgroundColor: '#fff' },
  seasonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  seasonTextActive: { color: '#000', fontWeight: '700' },
  loading: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  epRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  epThumb: {
    width: 96,
    height: 54,
    borderRadius: 8,
    backgroundColor: '#222',
  },
  epThumbEmpty: { backgroundColor: '#222' },
  epBody: { flex: 1 },
  epTitle: { color: '#fff', fontSize: 14, fontWeight: '600' },
  epDesc: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    marginTop: 2,
  },
});
