// @ts-expect-error -- Bun supplies its test runner at runtime; no Bun types are installed.
// biome-ignore-all lint/style/noNonNullAssertion: tests assert on known fixture values.
import { describe, expect, test, spyOn } from "bun:test";
import { LIVE_TV_MAX_XMLTV_BYTES } from "./live-tv";
import {
  parseXmltv,
  parseXmltvTimestamp,
  parseXmltvChannels,
  selectProgrammes,
} from "./xmltv";
import { DOMParser } from "@xmldom/xmldom";

const now = Date.parse("2026-11-04T12:00:00Z");
const programme = (
  attributes: string,
  content = "<title>News &amp; Weather</title><desc><![CDATA[Today <live>]]></desc>",
) => `<programme channel="news.id" ${attributes}>${content}</programme>`;
const current = 'start="20261104123000 +0100" stop="20261104133000 +0100"';

describe("secure XMLTV guide", () => {
  test("matches the exact channel, XML entities/CDATA and explicit timezone", () => {
    const entries = parseXmltv(
      `<?xml version="1.0" encoding="UTF-8"?><tv>${programme(current)}<programme channel="other" ${current}><title>Other</title></programme></tv>`,
      "news.id",
      now,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      title: "News & Weather",
      description: "Today <live>",
      start: "2026-11-04T11:30:00.000Z",
      end: "2026-11-04T12:30:00.000Z",
    });
    expect(entries[0].id).toMatch(/^guide-[a-f0-9]{24}$/);
    expect(
      parseXmltv(`<tv>${programme(current)}</tv>`, "missing", now),
    ).toEqual([]);
  });
  test("selects now/upcoming, sorts and deduplicates programmes", () => {
    const xml = `<tv>${programme('start="20261104140000Z" stop="20261104150000Z"', "<title>Later</title>")}${programme(current)}${programme(current)}${programme('start="20261104100000Z" stop="20261104120000Z"')}${programme('start="invalid" stop="invalid"')}${programme('start="20261104140000Z" stop="20261104130000Z"')}</tv>`;
    const entries = parseXmltv(xml, "news.id", now);
    expect(entries.map((entry) => entry.title)).toEqual([
      "News & Weather",
      "Later",
    ]);
    expect(
      parseXmltv(`<tv>${programme(current, "")}</tv>`, "news.id", now)[0].title,
    ).toBe("Live TV");
  });
  test("caps upcoming programmes at 20", () => {
    const xml = `<tv>${Array.from({ length: 30 }, (_, i) => programme(`start="20261105${String(Math.floor(i / 2)).padStart(2, "0")}${i % 2 ? "30" : "00"}00Z" stop="20261105230000Z"`)).join("")}</tv>`;

    expect(parseXmltv(xml, "news.id", now)).toHaveLength(20);
  });
  test("collapses overlapping provider entries with the same title", () => {
    const rows = [
      {
        id: "a",
        title: "Fútbol Colombiano",
        start: "2026-11-07T20:00:00Z",
        end: "2026-11-07T22:00:00Z",
      },
      {
        id: "b",
        title: "Fútbol Colombiano",
        start: "2026-11-07T21:00:00Z",
        end: "2026-11-07T23:00:00Z",
      },
      {
        id: "c",
        title: "Fútbol Colombiano",
        start: "2026-11-07T22:00:00Z",
        end: "2026-11-08T00:00:00Z",
      },
      {
        id: "d",
        title: "Noticias",
        start: "2026-11-07T21:30:00Z",
        end: "2026-11-07T23:00:00Z",
      },
    ];
    expect(
      selectProgrammes(rows, now, undefined, {
        dedupeSameTitleOverlaps: true,
      }).map((row) => row.id),
    ).toEqual(["a", "d", "c"]);
  });
  test.each([
    '<!DOCTYPE tv SYSTEM "https://private.example/secret"><tv/>',
    '<!DOCTYPE tv [<!ENTITY x SYSTEM "file:///etc/passwd">]><tv/>',
    '<!ENTITY x "expand"><tv/>',
    `<tv>${programme(current, "<title>&unknown;</title>")}</tv>`,
    "<tv><programme></tv>",
    "<not-tv/>",
    "<tv>\u0000</tv>",
    "<tv><title>&#0;</title></tv>",
  ])(
    "rejects DTDs, entities, malformed XML and controls without parser logging",
    (xml: string) => {
      const errorSpy = spyOn(console, "error");
      try {
        expect(() => parseXmltv(xml, "news.id", now)).toThrow(
          "La guía XMLTV de Live TV no es válida.",
        );
        expect(errorSpy).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    },
  );
  test("bounds bytes, nesting and DOM allocation", () => {
    expect(() =>
      parseXmltv("x".repeat(LIVE_TV_MAX_XMLTV_BYTES + 1), "news.id", now),
    ).toThrow("8 MiB");
    expect(() =>
      parseXmltv(
        `<tv>${"<x>".repeat(40)}text${"</x>".repeat(40)}</tv>`,
        "news.id",
        now,
      ),
    ).toThrow();
    expect(() =>
      parseXmltv(`<tv>${"<x/>".repeat(200_001)}</tv>`, "news.id", now),
    ).toThrow();
  });
  test("multi-channel window parsing uses one DOM and caps each row after filtering", () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      programme(
        `start="20261104${String(12 + Math.floor(i / 10)).padStart(2, "0")}${String((i % 10) * 6).padStart(2, "0")}00Z" stop="20261104160000Z"`,
      ),
    ).join("");
    const xml = `<tv>${programme('start="20261104110000Z" stop="20261104120000Z"')}${entries}<programme channel="other" start="20261104130000Z" stop="20261104140000Z"><title>Other</title></programme></tv>`;
    const parserSpy = spyOn(DOMParser.prototype, "parseFromString");
    try {
      const channels = parseXmltvChannels(
        xml,
        ["news.id", "other", "missing"],
        now + 86_400_000,
        { start: now, end: now + 3 * 3600_000 },
      );
      expect(channels.get("news.id")).toHaveLength(20);
      expect(channels.get("news.id")![0].start).toBe(
        "2026-11-04T12:00:00.000Z",
      );
      expect(channels.get("other")![0].title).toBe("Other");
      expect(channels.get("missing")).toEqual([]);
      expect(parserSpy).toHaveBeenCalledTimes(1);
    } finally {
      parserSpy.mockRestore();
    }
    expect(() =>
      parseXmltvChannels(
        "<tv/>",
        Array.from({ length: 13 }, (_, i) => String(i)),
      ),
    ).toThrow("12 canales");
  });
  test("pure window selection handles timezone overlap boundaries without altering programme times/input", () => {
    const rows = [
      {
        id: "later",
        title: "Later",
        start: "2026-11-04T13:00:00Z",
        end: "2026-11-04T16:00:00Z",
      },
      {
        id: "crossing",
        title: "Crossing",
        start: "2026-11-04T13:30:00+02:00",
        end: "2026-11-04T14:30:00+02:00",
      },
      {
        id: "ended",
        title: "Ended",
        start: "2026-11-04T11:00:00Z",
        end: "2026-11-04T12:00:00Z",
      },
      {
        id: "starts-after",
        title: "After",
        start: "2026-11-04T15:00:00Z",
        end: "2026-11-04T16:00:00Z",
      },
    ];
    const original = JSON.stringify(rows);
    const selected = selectProgrammes(rows, now + 86_400_000, {
      start: now,
      end: now + 3 * 3600_000,
    });
    expect(selected.map((row) => row.id)).toEqual(["crossing", "later"]);
    expect(selected[0].start).toBe("2026-11-04T13:30:00+02:00");
    expect(selected[1].end).toBe("2026-11-04T16:00:00Z");
    expect(JSON.stringify(rows)).toBe(original);
  });
  test("timestamps honor signed offsets, calendar validity and UTC defaults", () => {
    expect(parseXmltvTimestamp("20261104120000")).toBe(now);
    expect(parseXmltvTimestamp("20261104140000 +0200")).toBe(now);
    expect(parseXmltvTimestamp("20261104070000 -0500")).toBe(now);
    for (const value of [
      "20260230120000Z",
      "20261104240000Z",
      "20261104126000Z",
      "20261104120000 +1460",
      "20261104120000 +1500",
      "not a timestamp",
    ])
      expect(parseXmltvTimestamp(value)).toBeUndefined();
  });
});
