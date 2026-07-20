import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { ScrollShadow, Typography } from 'heroui-native';
import { Bookmark } from 'lucide-react-native';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '@/components/empty-state';
import { PosterRow } from '@/components/home/poster-row';
import { SetupPrompt, useSetupStatus } from '@/components/setup-prompt';
import { useAppSurface } from '@/hooks/use-app-surface';
import type { MediaMeta } from '@/lib/api';
import { navigateToDetail } from '@/lib/detail-nav';
import { getFavorites, getWatchlistItems } from '@/lib/saved';
import { COLORS } from '@/lib/theme';

export default function LibraryTab() {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const queryClient = useQueryClient();
  // La biblioteca es parte del modo Stream: en modo local mostramos un empty
  // state y no pedimos nada. `surface` se revalida en cada focus.
  const surface = useAppSurface();
  const streamMode = surface?.showLocal === false;
  // `insets.top` viene de `initialWindowMetrics` (sembrado sincrónicamente por
  // SafeAreaProvider en _layout.tsx): a diferencia de `<SafeAreaView>` (nativo,
  // mide en un frame posterior al primer render), esto evita el salto donde el
  // contenido aparece pegado arriba y luego "baja" a su padding correcto.
  const insets = useSafeAreaInsets();

  // Cacheado bajo ['library']: ya no recarga skeleton cada vez que entras a la
  // pestaña. La pantalla de detalle invalida esta key al guardar/quitar, así
  // que la lista se actualiza en segundo plano sin parpadeo.
  const libraryQuery = useQuery({
    enabled: streamMode,
    queryKey: ['library'],
    queryFn: async () => {
      const [favM, favS, watM, watS] = await Promise.all([
        getFavorites('movie').catch(() => []),
        getFavorites('series').catch(() => []),
        getWatchlistItems('movie').catch(() => []),
        getWatchlistItems('series').catch(() => []),
      ]);
      return {
        favorites: interleave(favM, favS),
        watchlist: interleave(watM, watS),
      };
    },
  });

  const favorites = libraryQuery.data?.favorites ?? [];
  const watchlist = libraryQuery.data?.watchlist ?? [];
  const loading = libraryQuery.isLoading;

  const handlePressItem = useCallback(
    (item: MediaMeta) => {
      navigateToDetail(queryClient, item, lang);
    },
    [queryClient, lang],
  );

  const { data: status } = useSetupStatus(streamMode);

  if (surface == null)
    return <View style={{ flex: 1, backgroundColor: COLORS.background }} />;
  // Modo local, o stream sin sesión (TV): empty state pidiendo iniciar sesión.
  if (surface.showLocal || !surface.authed)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: COLORS.background,
          paddingTop: insets.top,
        }}
      >
        <EmptyState
          icon={<Bookmark size={32} color="#9ca3af" />}
          title="Biblioteca"
          description={
            surface.authed
              ? 'Disponible en modo Stream.'
              : 'Inicia sesión para guardar tu contenido.'
          }
        />
      </View>
    );
  if (status && !status.setupCompleted) return <SetupPrompt />;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.background,
        paddingTop: insets.top,
      }}
    >
      <ScrollShadow
        style={{ flex: 1 }}
        size={28}
        LinearGradientComponent={LinearGradient}
      >
        <ScrollView contentContainerStyle={{ paddingVertical: 16, gap: 20 }}>
          <View style={{ paddingHorizontal: 16, gap: 4 }}>
            <Typography type="h2">Biblioteca</Typography>
            <Typography type="body" color="muted">
              Tus títulos guardados
            </Typography>
          </View>

          <Section
            title="Favoritos"
            items={favorites}
            loading={loading}
            onPressItem={handlePressItem}
            emptyText="Aún no tienes favoritos."
          />
          <Section
            title="Ver después"
            items={watchlist}
            loading={loading}
            onPressItem={handlePressItem}
            emptyText="Tu lista de ver después está vacía."
          />
        </ScrollView>
      </ScrollShadow>
    </View>
  );
}

function Section({
  title,
  items,
  loading,
  onPressItem,
  emptyText,
}: {
  title: string;
  items: MediaMeta[];
  loading: boolean;
  onPressItem: (item: MediaMeta) => void;
  emptyText: string;
}) {
  if (!loading && items.length === 0) {
    return (
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        <Typography type="h4" weight="bold">
          {title}
        </Typography>
        <Typography type="body-sm" color="muted">
          {emptyText}
        </Typography>
      </View>
    );
  }
  return (
    <PosterRow
      title={title}
      items={items}
      loading={loading}
      onPressItem={onPressItem}
    />
  );
}

function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
}
