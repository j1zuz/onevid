import { apiFetch } from './api';
import type {
  LiveTvChannel,
  LiveTvGuideResponse,
  LiveTvGuideRow,
  LiveTvProgramme,
} from './live-tv';

/** Misma ventana que la guía de la web: 3 h en columnas de 30 min. */
export const GUIDE_PAGE_SIZE = 10;
export const GUIDE_TICK_MS = 30 * 60 * 1000;
export const GUIDE_WINDOW_MS = 3 * 60 * 60 * 1000;
export const GUIDE_TICKS = 6;

const GUIDE_TIMEOUT_MS = 90_000;

export function getGuideWindowStart(now: number): number {
  const date = new Date(now);
  date.setMinutes(Math.floor(date.getMinutes() / 30) * 30, 0, 0);
  return date.getTime();
}

export function getGuidePage(channels: LiveTvChannel[], page: number) {
  const pageCount = Math.max(1, Math.ceil(channels.length / GUIDE_PAGE_SIZE));
  const currentPage = Math.max(
    0,
    Math.min(pageCount - 1, Math.trunc(page) || 0),
  );
  return {
    page: currentPage,
    pageCount,
    channels: channels.slice(
      currentPage * GUIDE_PAGE_SIZE,
      (currentPage + 1) * GUIDE_PAGE_SIZE,
    ),
  };
}

export interface ProgrammeLayout {
  programme: LiveTvProgramme;
  start: number;
  end: number;
  /** Porcentaje dentro de la ventana visible. */
  x: number;
  width: number;
  lane: number;
}

function compare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Coloca los programas en la ventana y reparte solapamientos en lanes. */
export function getProgrammeLayout(
  programmes: readonly LiveTvProgramme[],
  windowStart: number,
  windowEnd: number,
): ProgrammeLayout[] {
  if (
    !Number.isFinite(windowStart) ||
    !Number.isFinite(windowEnd) ||
    windowEnd <= windowStart
  )
    return [];

  const valid = programmes
    .map((programme) => ({
      programme,
      start: Date.parse(programme.start),
      end: Date.parse(programme.end),
    }))
    .filter(
      ({ start, end }) =>
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end > start &&
        end > windowStart &&
        start < windowEnd,
    )
    .sort(
      (a, b) =>
        a.start - b.start ||
        a.end - b.end ||
        compare(a.programme.id, b.programme.id) ||
        compare(a.programme.title, b.programme.title),
    );

  const laneEnds: number[] = [];
  return valid.map(({ programme, start, end }) => {
    const clippedStart = Math.max(start, windowStart);
    const clippedEnd = Math.min(end, windowEnd);
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= clippedStart);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = clippedEnd;
    return {
      programme,
      start,
      end,
      x: ((clippedStart - windowStart) / (windowEnd - windowStart)) * 100,
      width: ((clippedEnd - clippedStart) / (windowEnd - windowStart)) * 100,
      lane,
    };
  });
}

export function liveTvGuideQueryOptions(
  sourceId: string,
  channelIds: string[],
  start: number,
  end: number,
  enabled = true,
) {
  return {
    queryKey: [
      'live-tv-guide',
      sourceId,
      channelIds.join(','),
      start,
      end,
    ] as const,
    queryFn: async () => {
      const data = await apiFetch<LiveTvGuideResponse>(
        '/api/onevid-live-tv/guide',
        {
          method: 'POST',
          body: JSON.stringify({
            sourceId,
            channelIds,
            start: new Date(start).toISOString(),
            end: new Date(end).toISOString(),
          }),
        },
        GUIDE_TIMEOUT_MS,
      );
      const rows: LiveTvGuideRow[] = Array.isArray(data.channels)
        ? data.channels.filter(
            (row) =>
              row &&
              typeof row.channelId === 'string' &&
              Array.isArray(row.programmes),
          )
        : [];
      return rows;
    },
    enabled: enabled && Boolean(sourceId) && channelIds.length > 0,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  };
}

/** Hora local en formato 24 h (sin depender de Intl en Hermes). */
export function formatGuideTime(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

export function formatGuideRange(start: number, end: number): string {
  return `${formatGuideTime(start)} – ${formatGuideTime(end)}`;
}
