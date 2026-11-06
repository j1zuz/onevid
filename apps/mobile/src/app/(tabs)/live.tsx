import { useQuery } from '@tanstack/react-query';
import { Chip, SearchField, Typography } from 'heroui-native';
import { Radio, RefreshCw, Tv } from 'lucide-react-native';
import { useCallback, useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChannelRowsSkeleton } from '@/components/channel-row';
import { EmptyState } from '@/components/empty-state';
import { LiveTvGuide } from '@/components/live-tv-guide';
import { useAppSurface } from '@/hooks/use-app-surface';
import { tvFocusRing, useTvFocus } from '@/hooks/use-tv-focus';
import {
  type LiveTvChannel,
  liveTvChannelsQueryOptions,
  liveTvSourcesQueryOptions,
} from '@/lib/live-tv';
import { COLORS } from '@/lib/theme';

export default function LiveTvTab() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // La pestaña es parte del modo Stream (igual que Descubrir/Biblioteca).
  const surface = useAppSurface();
  const streamMode = surface?.showLocal === false;
  const catalogEnabled = streamMode && surface?.authed === true;

  const sourcesQuery = useQuery(liveTvSourcesQueryOptions(catalogEnabled));
  const sources = sourcesQuery.data ?? [];
  const [sourceId, setSourceId] = useState('');
  const [group, setGroup] = useState('');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const source = sources.find((item) => item.id === sourceId) ?? sources[0];

  const channelsQuery = useQuery(
    liveTvChannelsQueryOptions(source?.id ?? '', catalogEnabled),
  );
  const channels = useMemo(
    () => (channelsQuery.data ?? []).filter((channel) => Boolean(channel.url)),
    [channelsQuery.data],
  );

  // Canales agrupados por categoría: cada categoría se pinta como una fila
  // horizontal, igual que las filas del Inicio.
  const channelsByGroup = useMemo(() => {
    const map = new Map<string, LiveTvChannel[]>();
    for (const channel of channels) {
      const key = channel.group || t('Sin grupo');
      const list = map.get(key);
      if (list) list.push(channel);
      else map.set(key, [channel]);
    }
    return map;
  }, [channels, t]);

  const groups = useMemo(
    () => [...channelsByGroup.keys()].sort((a, b) => a.localeCompare(b)),
    [channelsByGroup],
  );

  const filtered = useMemo(() => {
    const search = deferredQuery.trim().toLocaleLowerCase();
    return channels.filter(
      (channel) =>
        (!group || channel.group === group) &&
        (!search || channel.name.toLocaleLowerCase().includes(search)),
    );
  }, [channels, deferredQuery, group]);

  const refresh = useCallback(() => {
    if (!source) {
      void sourcesQuery.refetch();
      return;
    }
    void channelsQuery.refetch();
  }, [channelsQuery, source, sourcesQuery]);

  const loading =
    sourcesQuery.isLoading || (Boolean(source) && channelsQuery.isLoading);
  const error = sourcesQuery.isError || channelsQuery.isError;

  if (surface == null)
    return <View style={{ flex: 1, backgroundColor: COLORS.background }} />;
  if (surface.showLocal)
    return (
      <EmptyState
        icon={<Tv size={32} color="#9ca3af" />}
        title="Live TV"
        description={t('Live TV está disponible en modo Stream.')}
      />
    );
  if (!surface.authed)
    return (
      <EmptyState
        icon={<Tv size={32} color="#9ca3af" />}
        title="Live TV"
        description={t('Inicia sesión para ver Live TV.')}
      />
    );

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.background,
        paddingTop: insets.top,
      }}
    >
      <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Typography type="h2" style={{ flex: 1 }}>
            Live TV
          </Typography>
          {channels.length > 0 ? (
            <Chip
              animation="disable-all"
              color="default"
              focusable={false}
              size="sm"
              style={{ alignSelf: 'center' }}
              variant="secondary"
            >
              {t('{{count}} canales', { count: channels.length })}
            </Chip>
          ) : null}
          <RefreshButton onPress={refresh} label={t('Actualizar')} />
        </View>

        {!sourcesQuery.isLoading && sources.length > 0 ? (
          <>
            <SearchField value={query} onChange={setQuery}>
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input
                  className="h-9 min-h-9 text-sm"
                  placeholder={t('Buscar canal…')}
                />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>

            {sources.length > 1 ? (
              <ChipRow>
                {sources.map((item) => (
                  <FilterChip
                    key={item.id}
                    active={item.id === source?.id}
                    label={item.name}
                    onPress={() => {
                      setSourceId(item.id);
                      setGroup('');
                    }}
                  />
                ))}
              </ChipRow>
            ) : null}

            {groups.length > 0 ? (
              <ChipRow>
                <FilterChip
                  active={!group}
                  label={t('Todas')}
                  onPress={() => setGroup('')}
                />
                {groups.map((item) => (
                  <FilterChip
                    key={item}
                    active={group === item}
                    label={item}
                    onPress={() => setGroup(item)}
                  />
                ))}
              </ChipRow>
            ) : null}
          </>
        ) : null}
      </View>

      {loading ? (
        <View style={{ flex: 1, paddingTop: 16, gap: 24 }}>
          <ChannelRowsSkeleton rows={3} />
        </View>
      ) : error ? (
        <LoadError onRetry={refresh} />
      ) : sourcesQuery.isSuccess && sources.length === 0 ? (
        <EmptyState
          icon={<Radio size={32} color="#9ca3af" />}
          title="Live TV"
          description={t('Configura Live TV desde la web para ver tus canales.')}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Tv size={32} color="#9ca3af" />}
          title={t('No hay canales disponibles')}
          description={
            channels.length === 0
              ? t(
                  'Esta fuente no devolvió canales compatibles. Comprueba su configuración o actualiza la lista.',
                )
              : t('Prueba con otra categoría o cambia la búsqueda.')
          }
        />
      ) : source ? (
        <ScrollView
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }}
          nestedScrollEnabled
          style={{ flex: 1 }}
        >
          <LiveTvGuide channels={filtered} source={source} />
        </ScrollView>
      ) : null}
    </View>
  );
}

function RefreshButton({
  onPress,
  label,
}: {
  onPress: () => void;
  label: string;
}) {
  const { focused, focusProps } = useTvFocus();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      {...focusProps}
      hitSlop={8}
      style={[
        {
          width: 36,
          height: 36,
          borderRadius: 999,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: COLORS.surface,
        },
        tvFocusRing(focused),
      ]}
    >
      <RefreshCw size={17} color="#e5e5e5" />
    </Pressable>
  );
}

function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      contentContainerStyle={{ gap: 8, paddingRight: 8 }}
      showsHorizontalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

function FilterChip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const { focused, focusProps } = useTvFocus();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      {...focusProps}
      style={[
        {
          borderRadius: 999,
          paddingHorizontal: 14,
          paddingVertical: 8,
          backgroundColor: active ? '#ffffff' : COLORS.surface,
        },
        tvFocusRing(focused),
      ]}
    >
      <Typography
        type="body-sm"
        weight={active ? 'semibold' : 'medium'}
        numberOfLines={1}
        style={{ color: active ? '#0a0a0a' : '#d4d4d4' }}
      >
        {label}
      </Typography>
    </Pressable>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const { focused, focusProps } = useTvFocus();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
        gap: 12,
      }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 999,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: COLORS.surface,
        }}
      >
        <Radio size={32} color="#9ca3af" />
      </View>
      <Typography type="h5" align="center">
        {t('No se pudo cargar Live TV')}
      </Typography>
      <Typography type="body-sm" color="muted" align="center">
        {t('Comprueba tu conexión y que la fuente siga disponible.')}
      </Typography>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        {...focusProps}
        style={[
          {
            marginTop: 4,
            borderRadius: 999,
            paddingHorizontal: 18,
            paddingVertical: 10,
            backgroundColor: COLORS.surface,
          },
          tvFocusRing(focused),
        ]}
      >
        <Typography type="body-sm" weight="semibold">
          {t('Reintentar')}
        </Typography>
      </Pressable>
    </View>
  );
}
