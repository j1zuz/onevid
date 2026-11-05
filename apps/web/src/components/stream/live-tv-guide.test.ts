import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  LiveTvChannel,
  LiveTvProgramme,
  LiveTvSourceSummary,
} from "@/lib/live-tv";
import type { LiveTvGuideProps } from "./live-tv-guide";
import {
  getGuidePage,
  getGuideWindowStart,
  getProgrammeLayout,
  GUIDE_PAGE_SIZE,
  GUIDE_TICK_MS,
  GUIDE_WINDOW_MS,
} from "./live-tv-guide-layout";

const start = Date.parse("2026-11-04T23:00:00Z");
const end = start + GUIDE_WINDOW_MS;
function programme(
  id: string,
  from: number | string,
  to: number | string,
): LiveTvProgramme {
  return {
    id,
    title: `Programa ${id}`,
    start: typeof from === "number" ? new Date(from).toISOString() : from,
    end: typeof to === "number" ? new Date(to).toISOString() : to,
  };
}
const channels: LiveTvChannel[] = Array.from({ length: 5_000 }, (_, index) => ({
  id: `channel-${index}`,
  name: `Canal ${index}`,
  group: "Noticias",
  url: `https://example.com/${index}.m3u8`,
}));
const source: LiveTvSourceSummary = {
  id: "source",
  name: "Live TV",
  channelCount: 5_000,
  type: "m3u",
  hasEpg: false,
};

function renderGuide(overrides: Partial<LiveTvGuideProps> = {}) {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("./live-tv-guide-markup.runner.ts", import.meta.url),
      ),
    ],
    {
      input: JSON.stringify({ source, channels, ...overrides }),
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    result.stderr || `Renderer exited with ${result.signal}`,
  );
  return result.stdout;
}

describe("Live TV time grid layout", () => {
  it("clips starts/ends to their timestamp positions in the three-hour window", () => {
    const result = getProgrammeLayout(
      [
        programme("before", start - GUIDE_TICK_MS, start + GUIDE_TICK_MS),
        programme("after", end - GUIDE_TICK_MS, end + GUIDE_TICK_MS),
      ],
      start,
      end,
    );
    assert.equal(result[0].x, 0);
    assert.ok(Math.abs(result[0].width - 100 / 6) < 1e-10);
    assert.ok(Math.abs(result[1].x - 500 / 6) < 1e-10);
    assert.ok(Math.abs(result[1].width - 100 / 6) < 1e-10);
    assert.equal(result[0].start, start - GUIDE_TICK_MS);
    assert.equal(result[1].end, end + GUIDE_TICK_MS);
  });

  it("uses half-open boundaries, omitting entries ending at start or starting at end", () => {
    const inside = programme("inside", start, end);
    const result = getProgrammeLayout(
      [
        programme("ends-at-start", start - 1_000, start),
        programme("starts-at-end", end, end + 1_000),
        inside,
      ],
      start,
      end,
    );
    assert.deepEqual(result, [
      { programme: inside, start, end, x: 0, width: 100, lane: 0 },
    ]);
  });

  it("renders a full-span programme at exactly 100% and leaves real gaps empty", () => {
    assert.equal(
      getProgrammeLayout(
        [programme("span", start - 86_400_000, end + 86_400_000)],
        start,
        end,
      )[0].width,
      100,
    );
    const [item] = getProgrammeLayout(
      [programme("middle", start + GUIDE_TICK_MS, start + 2 * GUIDE_TICK_MS)],
      start,
      end,
    );
    assert.ok(Math.abs(item.x - 100 / 6) < 1e-10);
    assert.ok(Math.abs(item.width - 100 / 6) < 1e-10);
    assert.deepEqual(getProgrammeLayout([], start, end), []);
  });

  it("ignores invalid dates, zero/reversed intervals and invalid windows", () => {
    assert.deepEqual(
      getProgrammeLayout(
        [
          programme("bad-start", "invalid", end),
          programme("bad-end", start, "invalid"),
          programme("zero", start, start),
          programme("reversed", end, start),
        ],
        start,
        end,
      ),
      [],
    );
    const input = [programme("valid", start, end)];
    for (const [from, to] of [
      [NaN, end],
      [start, Infinity],
      [start, start],
      [end, start],
    ])
      assert.deepEqual(getProgrammeLayout(input, from, to), []);
  });

  it("preserves real date rollover across midnight and timezone notation", () => {
    const crossing = programme(
      "midnight",
      "2026-11-05T01:30:00+02:00",
      "2026-11-05T02:30:00+02:00",
    );
    const [item] = getProgrammeLayout([crossing], start, end);
    assert.equal(item.start, Date.parse("2026-11-04T23:30:00Z"));
    assert.equal(item.end, Date.parse("2026-11-05T00:30:00Z"));
    assert.ok(Math.abs(item.x - 100 / 6) < 1e-10);
    assert.ok(Math.abs(item.width - 100 / 3) < 1e-10);
  });

  it("sorts overlaps deterministically into lanes without mutating input or entries", () => {
    const a = Object.freeze(programme("a", start, start + 2 * GUIDE_TICK_MS));
    const b = Object.freeze(programme("b", start, start + 2 * GUIDE_TICK_MS));
    const nested = Object.freeze(
      programme("nested", start + GUIDE_TICK_MS, start + 2 * GUIDE_TICK_MS),
    );
    const next = Object.freeze(
      programme("next", start + 2 * GUIDE_TICK_MS, end),
    );
    const input = Object.freeze([next, nested, b, a]);
    const layout = getProgrammeLayout(input, start, end);
    assert.deepEqual(
      layout.map((item) => [item.programme.id, item.lane]),
      [
        ["a", 0],
        ["b", 1],
        ["nested", 2],
        ["next", 0],
      ],
    );
    assert.deepEqual(
      getProgrammeLayout([...input].reverse(), start, end),
      layout,
    );
    assert.deepEqual(input, [next, nested, b, a]);
    assert.equal(layout[0].programme, a);
    assert.ok(Math.abs(layout[2].width - 100 / 6) < 1e-10);
  });

  it("keeps sub-minute entries positive rather than inventing minimum durations", () => {
    const [item] = getProgrammeLayout(
      [programme("short", start, start + 1_000)],
      start,
      end,
    );
    assert.ok(item.width > 0 && item.width < 0.01);
  });
});

describe("Live TV bounded pages and window", () => {
  it("renders and requests no more than ten of 5000 filtered channels per page", () => {
    const first = getGuidePage(channels, 0);
    const last = getGuidePage(channels, 499);
    assert.equal(GUIDE_PAGE_SIZE, 10);
    assert.equal(first.pageCount, 500);
    assert.deepEqual(
      first.channels.map((channel) => channel.id),
      channels.slice(0, 10).map((channel) => channel.id),
    );
    assert.deepEqual(last.channels, channels.slice(4_990));
    assert.equal(channels.length, 5_000);
    assert.notEqual(first.channels, channels);
  });

  it("clamps pages and supports partial and empty pages", () => {
    assert.equal(getGuidePage(channels, -1).page, 0);
    assert.equal(getGuidePage(channels, 9_999).page, 499);
    assert.equal(getGuidePage(channels, NaN).page, 0);
    assert.equal(getGuidePage(channels.slice(0, 13), 1).channels.length, 3);
    assert.deepEqual(getGuidePage([], 50), {
      channels: [],
      page: 0,
      pageCount: 1,
    });
  });

  it("anchors to the local half hour and spans exactly three hours / six half-hour ticks", () => {
    const now = new Date(2026, 10, 4, 23, 47, 23, 500).getTime();
    const anchor = new Date(getGuideWindowStart(now));
    assert.equal(anchor.getHours(), 23);
    assert.equal(anchor.getMinutes(), 30);
    assert.equal(anchor.getSeconds(), 0);
    assert.equal(anchor.getMilliseconds(), 0);
    assert.ok(anchor.getTime() <= now);
    assert.equal(GUIDE_WINDOW_MS / GUIDE_TICK_MS, 6);
    assert.equal(
      getGuideWindowStart(new Date(2026, 10, 5, 0, 0).getTime()),
      new Date(2026, 10, 5, 0, 0).getTime(),
    );
  });
});

describe("Live TV guide markup", () => {
  it("renders an honest no-guide banner, blank rows, bounded pagination and no fake schedule", () => {
    const html = renderGuide();
    assert.match(html, /Guía de Live TV/);
    assert.match(html, /no tiene una guía de programación configurada/);
    assert.equal((html.match(/Sin guía configurada/g) ?? []).length, 10);
    assert.equal((html.match(/data-channel-id=/g) ?? []).length, 10);
    assert.match(html, /data-channel-id="channel-9"/);
    assert.doesNotMatch(html, /data-channel-id="channel-10"/);
    assert.doesNotMatch(html, /IPTV|data-slot="dialog-trigger"|<progress/i);
  });

  it("uses shared UI, an accessible scroll region, sticky axes and selected-channel state", () => {
    const html = renderGuide({ selectedChannelId: "channel-1" });
    assert.match(html, /data-slot="scroll-area"/);
    assert.match(html, /role="region"/);
    assert.match(html, /data-dpad-focusable="true" tabindex="0"/);
    assert.match(html, /sticky top-0/);
    assert.match(html, /sticky left-0/);
    assert.match(html, /aria-pressed="true"/);
    assert.match(html, /data-dpad-focusable/);
    assert.match(html, /aria-label="Ver Canal 1 en vivo"/);
  });

  it("uses a hydration-stable header without repeating the date or timezone", () => {
    const html = renderGuide({ source: { ...source, hasEpg: true } });
    assert.match(html, /Guía de Live TV/);
    assert.match(html, /5000 canales/);
    assert.doesNotMatch(html, /zona horaria local|America\//);
    assert.match(html, /Cargando guía de programación/);
    assert.equal((html.match(/data-slot="skeleton"/g) ?? []).length, 20);
    assert.doesNotMatch(
      html,
      /Sin programación|Sin guía configurada|data-slot="dialog-trigger"/,
    );
  });

  it("does not render rows, loading schedules or pagination for empty filters", () => {
    const html = renderGuide({
      source: { ...source, hasEpg: true },
      channels: [],
    });
    assert.match(html, /No hay canales para estos filtros/);
    assert.doesNotMatch(
      html,
      /data-channel-id|data-slot="skeleton"|Páginas de canales/,
    );
  });

  it("uses only actual HTTPS channel logos without sending referrers", () => {
    const html = renderGuide({
      channels: [
        { ...channels[0], logo: "https://example.com/logo.png" },
        { ...channels[1], logo: "http://example.com/insecure.png" },
        {
          ...channels[2],
          logo: "https://user:password@example.com/private.png",
        },
      ],
    });
    assert.match(html, /src="https:\/\/example.com\/logo.png"/);
    assert.match(html, /referrerPolicy="no-referrer"/i);
    assert.doesNotMatch(html, /insecure.png|private.png|password/);
  });
});
