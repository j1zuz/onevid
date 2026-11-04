import type { LiveTvChannel, LiveTvProgramme } from "@/lib/live-tv";

export const GUIDE_PAGE_SIZE = 10;
export const GUIDE_TICK_MS = 30 * 60 * 1000;
export const GUIDE_WINDOW_MS = 3 * 60 * 60 * 1000;

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
  /** Percentage of the visible window, not of the programme's full duration. */
  x: number;
  width: number;
  lane: number;
}

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
    // Preserve overlapping provider entries in separate lanes rather than hiding
    // a programme or misrepresenting its broadcast times to make it fit.
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

function compare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
