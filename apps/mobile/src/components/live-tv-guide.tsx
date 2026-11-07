import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Button, Skeleton, Typography } from 'heroui-native';
import {
  Bookmark,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Heart,
} from 'lucide-react-native';
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { tvFocusRing, useTvFocus } from '@/hooks/use-tv-focus';
import type { SavedStatus } from '@/lib/saved';
import { getLiveSavedStatuses, setFavorite, setWatchlist } from '@/lib/saved';
import {
  formatGuideRange,
  formatGuideTime,
  getGuidePage,
  getGuideWindowStart,
  getProgrammeLayout,
  GUIDE_TICKS,
  GUIDE_TICK_MS,
  GUIDE_WINDOW_MS,
  liveTvGuideQueryOptions,
  type ProgrammeLayout,
} from '@/lib/live-tv-guide';
import {
  type LiveTvChannel,
  type LiveTvGuideRow,
  type LiveTvProgramme,
  type LiveTvSourceSummary,
  buildLiveSavedId,
  playLiveTvChannel,
  safeChannelLogo,
} from '@/lib/live-tv';
import { COLORS } from '@/lib/theme';

const BORDER = 'rgba(255,255,255,0.10)';
const GRID_LINE = 'rgba(255,255,255,0.06)';
const BLOCK_BG = '#1b1b1b';
const BLOCK_BORDER = 'rgba(255,255,255,0.14)';
const ACCENT = '#4f9dff';
// Clave centinela de "Todas": `group` vacío significa sin filtro.
const ALL_GROUPS_KEY = '__all_groups__';

interface SelectedProgramme {
  channel: LiveTvChannel;
  programme: LiveTvProgramme;
}


/**
 * Esqueleto de la guía con la MISMA forma que el contenido real (cabecera con
 * "Canal", columnas de horas y filas de canales). Antes se pintaba el esqueleto
 * de filas del feed (tarjetas 16:9), que no se parecía a un EPG.
 */
export function LiveTvGuideSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <View style={{ gap: 12 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 16,
        }}
      >
        <Skeleton style={{ width: 150, height: 22, borderRadius: 6 }} />
        <View style={{ flex: 1 }} />
        <Skeleton style={{ width: 32, height: 32, borderRadius: 999 }} />
        <Skeleton style={{ width: 64, height: 32, borderRadius: 999 }} />
        <Skeleton style={{ width: 32, height: 32, borderRadius: 999 }} />
      </View>
      <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: BORDER }}>
        <View
          style={{
            flexDirection: 'row',
            height: 40,
            backgroundColor: '#141414',
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderColor: BORDER,
          }}
        >
          <View
            style={{
              width: 160,
              justifyContent: 'center',
              paddingHorizontal: 10,
              borderRightWidth: StyleSheet.hairlineWidth,
              borderColor: BORDER,
            }}
          >
            <Skeleton style={{ width: 44, height: 10, borderRadius: 4 }} />
          </View>
          {Array.from({ length: 3 }).map((_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholder estático
            <View
              key={index}
              style={{
                flex: 1,
                justifyContent: 'center',
                paddingHorizontal: 8,
                borderLeftWidth: StyleSheet.hairlineWidth,
                borderColor: BORDER,
              }}
            >
              <Skeleton style={{ width: 46, height: 10, borderRadius: 4 }} />
            </View>
          ))}
        </View>
        {Array.from({ length: rows }).map((_, row) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholder estático
          <View
            key={row}
            style={{
              flexDirection: 'row',
              height: 84,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderColor: BORDER,
            }}
          >
            <View
              style={{
                width: 160,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 8,
                borderRightWidth: StyleSheet.hairlineWidth,
                borderColor: BORDER,
              }}
            >
              <Skeleton style={{ width: 64, height: 36, borderRadius: 6 }} />
              <Skeleton style={{ flex: 1, height: 12, borderRadius: 4 }} />
            </View>
            <View style={{ flex: 1, padding: 6 }}>
              <Skeleton style={{ flex: 1, borderRadius: 8 }} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export function LiveTvGuide({
  source,
  channels,
  onPlayChannel = playLiveTvChannel,
  headerExtra,
}: {
  source: LiveTvSourceSummary;
  channels: LiveTvChannel[];
  /**
   * Qué hacer al tocar un canal o "Ver" en un programa. Por defecto navega al
   * reproductor a pantalla completa; la pestaña de Live TV lo sobreescribe para
   * reproducir arriba de la guía y poder cambiar de canal sin salir (como la web).
   */
  onPlayChannel?: (channel: LiveTvChannel) => void;
  /** Selector de categoría que se pinta a la derecha del encabezado (TV). */
  headerExtra?: ReactNode;
}) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const isTV = Platform.isTV;
  // Ancho de la columna de canales y de cada tramo de 30 min. En TV se ven
  // menos tramos pero más grandes, como la guía de la web.
  const channelWidth = isTV ? 230 : 160;
  const visibleCells = isTV ? GUIDE_TICKS : 2;
  const cellWidth = isTV
    ? Math.max(120, Math.round((width - channelWidth) / visibleCells))
    : 150;
  const timelineWidth = cellWidth * GUIDE_TICKS;
  const rowBaseHeight = isTV ? 96 : 84;
  const programmeHeight = isTV ? 76 : 64;

  const [page, setPage] = useState(0);
  const [windowStart, setWindowStart] = useState(() =>
    getGuideWindowStart(Date.now()),
  );
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<SelectedProgramme | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const pageData = getGuidePage(channels, page);
  const visibleChannels = pageData.channels;
  const windowEnd = windowStart + GUIDE_WINDOW_MS;
  const ticks = useMemo(
    () =>
      Array.from(
        { length: GUIDE_TICKS },
        (_, index) => windowStart + index * GUIDE_TICK_MS,
      ),
    [windowStart],
  );
  const channelIds = visibleChannels.map((channel) => channel.id);
  const guideQuery = useQuery(
    liveTvGuideQueryOptions(
      source.id,
      channelIds,
      windowStart,
      windowEnd,
      source.hasEpg,
    ),
  );
  const rows = useMemo(() => {
    const map = new Map<string, LiveTvGuideRow>();
    for (const row of guideQuery.data ?? []) map.set(row.channelId, row);
    return map;
  }, [guideQuery.data]);
  const loading = source.hasEpg && guideQuery.isLoading;
  const nowPosition =
    now >= windowStart && now < windowEnd
      ? ((now - windowStart) / GUIDE_WINDOW_MS) * 100
      : null;

  const savedIds = visibleChannels.map((channel) =>
    buildLiveSavedId(source.id, channel.id),
  );
  const savedKey = savedIds.join('|');
  const savedQuery = useQuery({
    queryKey: ['live-tv-saved', savedKey] as const,
    queryFn: () => getLiveSavedStatuses(savedIds),
    enabled: savedIds.length > 0,
    staleTime: 60_000,
  });
  const [savedOverrides, setSavedOverrides] = useState<
    Record<string, SavedStatus>
  >({});
  const statusFor = (channel: LiveTvChannel): SavedStatus => {
    const mediaId = buildLiveSavedId(source.id, channel.id);
    return (
      savedOverrides[mediaId] ??
      savedQuery.data?.[mediaId] ?? { favorite: false, watchlist: false }
    );
  };
  const toggleSaved = useCallback(
    async (channel: LiveTvChannel, kind: keyof SavedStatus) => {
      const mediaId = buildLiveSavedId(source.id, channel.id);
      const current =
        savedOverrides[mediaId] ??
        savedQuery.data?.[mediaId] ?? {
          favorite: false,
          watchlist: false,
        };
      const next = !current[kind];
      setSavedOverrides((previous) => ({
        ...previous,
        [mediaId]: { ...current, [kind]: next },
      }));
      try {
        const apply = kind === 'favorite' ? setFavorite : setWatchlist;
        await apply('live', mediaId, next, {
          name: channel.name,
          poster: channel.logo,
          background: channel.logo,
        });
      } catch {
        setSavedOverrides((previous) => ({
          ...previous,
          [mediaId]: current,
        }));
      }
    },
    [savedOverrides, savedQuery.data, source.id],
  );

  const goNow = () => {
    const instant = Date.now();
    setNow(instant);
    setWindowStart(getGuideWindowStart(instant));
  };

  return (
    <View style={{ gap: 12 }}>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 16,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <CalendarDays size={16} color="#a3a3a3" />
          <Typography type="h5" weight="bold">
            {t('Guía de Live TV')}
          </Typography>
        </View>
        <View style={{ flex: 1 }} />
        {headerExtra}
        <FocusButton
          accessibilityLabel={t('Tres horas anteriores')}
          className="h-8 w-8 px-0"
          onPress={() => setWindowStart((value) => value - GUIDE_WINDOW_MS)}
          size="sm"
          variant="ghost"
        >
          <ChevronLeft size={16} color="#fff" />
        </FocusButton>
        <FocusButton
          className="h-8 px-3"
          onPress={goNow}
          size="sm"
          variant="secondary"
        >
          {t('Ahora')}
        </FocusButton>
        <FocusButton
          accessibilityLabel={t('Tres horas siguientes')}
          className="h-8 w-8 px-0"
          onPress={() => setWindowStart((value) => value + GUIDE_WINDOW_MS)}
          size="sm"
          variant="ghost"
        >
          <ChevronRight size={16} color="#fff" />
        </FocusButton>
      </View>

      {!source.hasEpg ? (
        <Typography
          type="body-sm"
          color="muted"
          style={{ paddingHorizontal: 16 }}
        >
          {t('Esta fuente no tiene una guía de programación configurada.')}
        </Typography>
      ) : guideQuery.isError ? (
        <View style={{ paddingHorizontal: 16, gap: 8 }}>
          <Typography type="body-sm" color="muted">
            {t('No se pudo cargar la guía de Live TV.')}
          </Typography>
          <FocusButton
            onPress={() => void guideQuery.refetch()}
            size="sm"
            variant="secondary"
            style={{ alignSelf: 'flex-start' }}
          >
            {t('Reintentar guía')}
          </FocusButton>
        </View>
      ) : null}

      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
      >
        <View style={{ width: channelWidth + timelineWidth }}>
          <View
            style={{
              flexDirection: 'row',
              height: 40,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderColor: BORDER,
              backgroundColor: '#141414',
            }}
          >
            <View
              style={{
                width: channelWidth,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 10,
                borderRightWidth: StyleSheet.hairlineWidth,
                borderColor: BORDER,
              }}
            >
              <Typography type="body-xs" weight="semibold">
                {t('Canal')}
              </Typography>
              {channels.length > 0 ? (
                <View
                  style={{
                    marginLeft: 'auto',
                    borderRadius: 6,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: 'rgba(255,255,255,0.25)',
                    paddingHorizontal: 4,
                    paddingVertical: 1,
                  }}
                >
                  <Typography
                    type="body-xs"
                    color="muted"
                    style={{ fontSize: 9 }}
                  >
                    {t('{{count}} canales', { count: channels.length })}
                  </Typography>
                </View>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', width: timelineWidth }}>
              {ticks.map((tick) => (
                <View
                  key={tick}
                  style={{
                    width: cellWidth,
                    justifyContent: 'center',
                    paddingHorizontal: 8,
                    borderLeftWidth: StyleSheet.hairlineWidth,
                    borderColor: BORDER,
                  }}
                >
                  <Typography type="body-xs" weight="semibold">
                    {formatGuideTime(tick)}
                  </Typography>
                </View>
              ))}
            </View>
          </View>

          {visibleChannels.map((channel) => {
            const row = rows.get(channel.id);
            const rowError =
              source.hasEpg && !loading && (!row || row.error === true);
            const layout =
              row && !row.error
                ? getProgrammeLayout(row.programmes, windowStart, windowEnd)
                : [];
            const lanes =
              Math.max(0, ...layout.map((item) => item.lane)) + 1;
            const rowHeight = Math.max(
              rowBaseHeight,
              lanes * programmeHeight + 8,
            );
            return (
              <GuideRow
                cellWidth={cellWidth}
                channel={channel}
                channelWidth={channelWidth}
                hasEpg={source.hasEpg}
                height={rowHeight}
                key={channel.id}
                layout={layout}
                loading={loading}
                now={now}
                nowPosition={nowPosition}
                onSelectProgramme={(programme) =>
                  setSelected({ channel, programme })
                }
                onPlay={() => onPlayChannel(channel)}
                onToggleFavorite={() => void toggleSaved(channel, 'favorite')}
                onToggleWatchlist={() => void toggleSaved(channel, 'watchlist')}
                programmeHeight={programmeHeight}
                rowError={rowError}
                saved={statusFor(channel)}
                timelineWidth={timelineWidth}
              />
            );
          })}
        </View>
      </ScrollView>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          paddingHorizontal: 16,
        }}
      >
        <FocusButton
          className="h-8 px-3"
          isDisabled={pageData.page === 0}
          onPress={() => setPage(pageData.page - 1)}
          size="sm"
          variant="secondary"
        >
          {t('Anterior')}
        </FocusButton>
        <FocusButton
          className="h-8 px-3"
          isDisabled={pageData.page + 1 >= pageData.pageCount}
          onPress={() => setPage(pageData.page + 1)}
          size="sm"
          variant="secondary"
        >
          {t('Siguiente')}
        </FocusButton>
      </View>


      <ProgrammeModal
        onClose={() => setSelected(null)}
        onWatch={(channel) => {
          setSelected(null);
          onPlayChannel(channel);
        }}
        selected={selected}
      />
    </View>
  );
}

function GuideRow({
  channel,
  layout,
  cellWidth,
  channelWidth,
  timelineWidth,
  height,
  programmeHeight,
  rowError,
  loading,
  now,
  nowPosition,
  onSelectProgramme,
  onPlay,
  saved,
  onToggleFavorite,
  onToggleWatchlist,
  hasEpg,
}: {
  channel: LiveTvChannel;
  layout: ProgrammeLayout[];
  cellWidth: number;
  channelWidth: number;
  timelineWidth: number;
  height: number;
  programmeHeight: number;
  rowError: boolean;
  loading: boolean;
  now: number;
  nowPosition: number | null;
  onSelectProgramme: (programme: LiveTvProgramme) => void;
  /** Reproduce este canal (arriba de la guía, no a pantalla completa). */
  onPlay: () => void;
  saved: SavedStatus;
  onToggleFavorite: () => void;
  onToggleWatchlist: () => void;
  hasEpg: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View
      style={{
        flexDirection: 'row',
        height,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: BORDER,
      }}
    >
      <ChannelCell
        channel={channel}
        height={height}
        onPlay={onPlay}
        onToggleFavorite={onToggleFavorite}
        onToggleWatchlist={onToggleWatchlist}
        saved={saved}
        width={channelWidth}
      />
      <View style={{ width: timelineWidth, height }}>
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, flexDirection: 'row' }}
        >
          {Array.from({ length: GUIDE_TICKS }).map((_, index) => (
            <View
              key={index}
              style={{
                flex: 1,
                borderLeftWidth: StyleSheet.hairlineWidth,
                borderColor: GRID_LINE,
              }}
            />
          ))}
        </View>

        {loading ? (
          <View style={{ padding: 8, width: cellWidth }}>
            <Skeleton style={{ height: 44, borderRadius: 8 }} />
          </View>
        ) : rowError ? (
          <View
            style={{
              width: cellWidth,
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 8,
            }}
          >
            <Typography type="body-xs" color="muted" align="center">
              {t('Guía no disponible')}
            </Typography>
          </View>
        ) : layout.length === 0 ? (
          <View
            style={{
              width: cellWidth,
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 8,
            }}
          >
            <Typography type="body-xs" color="muted" align="center">
              {hasEpg ? t('Sin programación') : t('Sin guía configurada')}
            </Typography>
          </View>
        ) : (
          layout.map((item, index) => (
            <ProgrammeBlock
              item={item}
              key={`${item.programme.id}:${item.start}:${index}`}
              now={now}
              onPress={() => onSelectProgramme(item.programme)}
              programmeHeight={programmeHeight}
            />
          ))
        )}

        {nowPosition !== null ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${nowPosition}%`,
              width: 1,
              backgroundColor: ACCENT,
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

function ChannelCell({
  channel,
  width,
  height,
  saved,
  onPlay,
  onToggleFavorite,
  onToggleWatchlist,
}: {
  channel: LiveTvChannel;
  width: number;
  height: number;
  saved: SavedStatus;
  /** Reproduce el canal (arriba de la guía o a pantalla completa). */
  onPlay: () => void;
  onToggleFavorite: () => void;
  onToggleWatchlist: () => void;
}) {
  const { t } = useTranslation();
  const playFocus = useTvFocus();
  const favFocus = useTvFocus();
  const watchFocus = useTvFocus();
  const logo = safeChannelLogo(channel.logo);
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <View
      style={{
        width,
        height,
        flexDirection: 'row',
        alignItems: 'center',
        borderRightWidth: StyleSheet.hairlineWidth,
        borderColor: BORDER,
        backgroundColor: COLORS.background,
      }}
    >
      <Pressable
        accessibilityLabel={channel.name}
        accessibilityRole="button"
        onPress={onPlay}
        {...playFocus.focusProps}
        style={[
          {
            flex: 1,
            height: '100%',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: logo && !logoFailed ? 'center' : 'flex-start',
            gap: 8,
            paddingHorizontal: 8,
          },
          tvFocusRing(playFocus.focused),
        ]}
      >
        {logo && !logoFailed ? (
          <Image
            source={{ uri: logo }}
            contentFit="contain"
            onError={() => setLogoFailed(true)}
            style={{ width: 64, height: 36, borderRadius: 6 }}
            transition={150}
          />
        ) : (
          <Typography
            type="body-sm"
            weight="medium"
            numberOfLines={2}
            style={{ flex: 1 }}
          >
            {channel.name}
          </Typography>
        )}
      </Pressable>

      <View
        style={{
          width: 32,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          paddingRight: 4,
        }}
      >
        <Pressable
          accessibilityLabel={t('Favoritos')}
          accessibilityRole="button"
          accessibilityState={{ selected: saved.favorite }}
          onPress={onToggleFavorite}
          {...favFocus.focusProps}
          style={[
            {
              width: 28,
              height: 28,
              borderRadius: 999,
              alignItems: 'center',
              justifyContent: 'center',
            },
            tvFocusRing(favFocus.focused),
          ]}
        >
          <Heart
            size={15}
            color={saved.favorite ? '#ef4444' : '#a3a3a3'}
            fill={saved.favorite ? '#ef4444' : 'transparent'}
          />
        </Pressable>
        <Pressable
          accessibilityLabel={t('Ver después')}
          accessibilityRole="button"
          accessibilityState={{ selected: saved.watchlist }}
          onPress={onToggleWatchlist}
          {...watchFocus.focusProps}
          style={[
            {
              width: 28,
              height: 28,
              borderRadius: 999,
              alignItems: 'center',
              justifyContent: 'center',
            },
            tvFocusRing(watchFocus.focused),
          ]}
        >
          <Bookmark
            size={15}
            color={saved.watchlist ? '#4f9dff' : '#a3a3a3'}
            fill={saved.watchlist ? '#4f9dff' : 'transparent'}
          />
        </Pressable>
      </View>
    </View>
  );
}

function ProgrammeBlock({
  item,
  programmeHeight,
  now,
  onPress,
}: {
  item: ProgrammeLayout;
  programmeHeight: number;
  now: number;
  onPress: () => void;
}) {
  const { focused, focusProps } = useTvFocus();
  const { programme, start, end, x, width, lane } = item;
  const live = start <= now && now < end;
  return (
    <Pressable
      accessibilityLabel={`${programme.title}, ${formatGuideRange(start, end)}`}
      accessibilityRole="button"
      onPress={onPress}
      {...focusProps}
      style={[
        {
          position: 'absolute',
          left: `${x}%`,
          width: `${Math.max(width, 2)}%`,
          top: 4 + lane * programmeHeight,
          height: programmeHeight - 8,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: live ? ACCENT : BLOCK_BORDER,
          backgroundColor: live ? 'rgba(79,157,255,0.16)' : BLOCK_BG,
          paddingHorizontal: 6,
          paddingVertical: 4,
          justifyContent: 'center',
          overflow: 'hidden',
        },
        tvFocusRing(focused),
      ]}
    >
      <Typography type="body-xs" weight="semibold" numberOfLines={2}>
        {programme.title}
      </Typography>
      <Typography type="body-xs" color="muted" numberOfLines={1}>
        {formatGuideRange(start, end)}
      </Typography>
    </Pressable>
  );
}

function ProgrammeModal({
  selected,
  onClose,
  onWatch,
}: {
  selected: SelectedProgramme | null;
  onClose: () => void;
  onWatch: (channel: LiveTvChannel) => void;
}) {
  const { t } = useTranslation();
  const { focused, focusProps } = useTvFocus();
  if (!selected) return null;
  const { channel, programme } = selected;
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible
    >
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          padding: 24,
          backgroundColor: 'rgba(0,0,0,0.72)',
        }}
      >
        <Pressable
          accessibilityLabel={t('Cerrar')}
          focusable={false}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={{
            alignSelf: 'center',
            width: '100%',
            maxWidth: 520,
            borderRadius: 16,
            padding: 20,
            gap: 12,
            backgroundColor: COLORS.surface,
          }}
        >
          <Typography type="h5" weight="bold">
            {programme.title}
          </Typography>
          <Typography type="body-sm" color="muted">
            {channel.name} · {formatGuideRange(
              Date.parse(programme.start),
              Date.parse(programme.end),
            )}
          </Typography>
          <ScrollView style={{ maxHeight: 220 }}>
            <Typography type="body-sm">
              {programme.description || t('Sin descripción disponible.')}
            </Typography>
          </ScrollView>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              gap: 10,
            }}
          >
            <Button onPress={onClose} size="sm" variant="secondary">
              {t('Cerrar')}
            </Button>
            <Button
              hasTVPreferredFocus
              onPress={() => onWatch(channel)}
              size="sm"
              variant="primary"
              {...focusProps}
              style={tvFocusRing(focused)}
            >
              {t('Ver canal en vivo')}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Button de HeroUI con anillo de foco para TV (en móvil tvFocusRing es null).
function FocusButton({
  children,
  style,
  ...props
}: ComponentProps<typeof Button>) {
  const { focused, focusProps } = useTvFocus();
  return (
    <Button
      {...props}
      {...focusProps}
      style={[style, tvFocusRing(focused)]}
    >
      {children}
    </Button>
  );
}
