// @ts-expect-error -- Bun supplies its test runner at runtime; no Bun types are installed.
import { describe, expect, test } from "bun:test";
import {
  buildXtreamEndpoint,
  validateXtreamAuth,
  xtreamActionUrl,
  parseXtreamChannels,
  decodeXtreamText,
  parseXtreamEpg,
} from "./xtream";
import { LIVE_TV_MAX_CHANNELS } from "./live-tv";

const now = Date.parse("2026-11-04T12:00:00Z");
const endpoint = buildXtreamEndpoint(
  "https://provider.example/prefix/",
  "user/name",
  "p@ss &word",
);
const encoded = (text: string) => Buffer.from(text).toString("base64");

describe("Xtream source contract", () => {
  test("canonical endpoint preserves base path and privately encodes credentials", () => {
    const url = new URL(endpoint);
    expect(url.pathname).toBe("/prefix/player_api.php");
    expect(url.searchParams.get("username")).toBe("user/name");
    expect(url.searchParams.get("password")).toBe("p@ss &word");
    expect(
      buildXtreamEndpoint(
        "https://provider.example/prefix/player_api.php",
        "user/name",
        "p@ss &word",
      ),
    ).toBe(endpoint);
    const action = new URL(xtreamActionUrl(endpoint, "get_short_epg", "123"));
    expect(action.searchParams.get("action")).toBe("get_short_epg");
    expect(action.searchParams.get("stream_id")).toBe("123");
    expect(action.searchParams.get("limit")).toBe("20");
  });
  test("rejects HTTP, userinfo, arbitrary query and unsafe credentials/stream IDs", () => {
    for (const url of [
      "http://provider.example",
      "https://user:pass@provider.example",
      "https://provider.example?url=evil",
    ])
      expect(() => buildXtreamEndpoint(url, "u", "p")).toThrow();
    for (const value of ["", "..", ".", "x\nheader", "x".repeat(257), null])
      expect(() =>
        buildXtreamEndpoint("https://provider.example", value, "p"),
      ).toThrow();
    for (const id of ["../secret", "1&action=delete", "-1", "9007199254740992"])
      expect(() => xtreamActionUrl(endpoint, "get_short_epg", id)).toThrow();
  });
  test("validates auth, status and optional expiration", () => {
    for (const auth of [1, "1", true])
      expect(() =>
        validateXtreamAuth(
          {
            user_info: {
              auth,
              status: "Active",
              exp_date: String(now / 1000 + 3600),
            },
          },
          now,
        ),
      ).not.toThrow();
    expect(() =>
      validateXtreamAuth(
        { user_info: { auth: 1, status: "Active", exp_date: null } },
        now,
      ),
    ).not.toThrow();
    for (const user_info of [
      undefined,
      { auth: 0, status: "Active" },
      { auth: 1, status: "Disabled" },
      { auth: 1 },
      { auth: 1, status: "Active", exp_date: now / 1000 },
      { auth: 1, status: "Active", exp_date: "invalid" },
    ])
      expect(() => validateXtreamAuth({ user_info }, now)).toThrow("Live TV");
  });
  test("uses configured HTTPS origin/base, categories and stable stream IDs", () => {
    const channels = parseXtreamChannels(
      endpoint,
      [
        {
          stream_id: 123,
          name: "News",
          category_id: "9",
          stream_icon: "images/news.png",
          epg_channel_id: "news.id",
          direct_source: "http://evil.example/stream",
          stream_url: "http://evil.example/live",
        },
        { stream_id: 123, name: "Duplicate" },
        { stream_id: "456", stream_icon: "http://provider.example/logo.png" },
        { stream_id: "../bad" },
      ],
      [{ category_id: 9, category_name: "Noticias" }],
    );
    expect(channels).toHaveLength(2);
    expect(channels[0]).toEqual({
      id: "xtream-123",
      name: "News",
      url: "https://provider.example/prefix/live/user%2Fname/p%40ss%20%26word/123.m3u8",
      logo: "https://provider.example/prefix/images/news.png",
      group: "Noticias",
      tvgId: "news.id",
    });
    expect(channels[1]).toMatchObject({
      id: "xtream-456",
      name: "Live TV",
      group: "Sin grupo",
    });
    expect(channels[1].logo).toBeUndefined();
    expect(
      parseXtreamChannels(
        endpoint,
        [{ stream_id: 456 }, { stream_id: 123 }],
        [],
      ).map((channel) => channel.id),
    ).toEqual(["xtream-456", "xtream-123"]);
  });
  test("caps channels and rejects malformed catalogs", () => {
    expect(
      parseXtreamChannels(
        endpoint,
        Array.from({ length: LIVE_TV_MAX_CHANNELS + 5 }, (_, stream_id) => ({
          stream_id,
        })),
        [],
      ),
    ).toHaveLength(LIVE_TV_MAX_CHANNELS);
    expect(() => parseXtreamChannels(endpoint, {}, [])).toThrow();
    expect(() => parseXtreamChannels(endpoint, [], [])).toThrow();
  });
});

describe("Xtream short EPG", () => {
  test("safely decodes Unicode base64 and removes control characters", () => {
    expect(decodeXtreamText(encoded("España\u0000\u0007 en directo"))).toBe(
      "España en directo",
    );
    for (const value of [
      null,
      "not%base64",
      "a",
      "////",
      "eA===",
      "x".repeat(40_000),
    ])
      expect(decodeXtreamText(value)).toBe("");
    expect(decodeXtreamText(encoded("x".repeat(600)), 512)).toHaveLength(512);
  });
  test("Unix timestamps override provider-local strings; output is ISO UTC", () => {
    const programmes = parseXtreamEpg(
      {
        epg_listings: [
          {
            start_timestamp: String(now / 1000 - 1800),
            stop_timestamp: now / 1000 + 1800,
            start: "2026-11-04 20:00:00",
            end: "2026-11-04 21:00:00",
            title: encoded("Noticias"),
            description: encoded("Descripción"),
          },
        ],
      },
      "123",
      now,
    );
    expect(programmes[0]).toMatchObject({
      title: "Noticias",
      description: "Descripción",
      start: "2026-11-04T11:30:00.000Z",
      end: "2026-11-04T12:30:00.000Z",
    });
    expect(programmes[0].id).toMatch(/^guide-/);
  });
  test("accepts explicit timezone fallback but never guesses local timezone", () => {
    const programmes = parseXtreamEpg(
      {
        epg_listings: [
          {
            title: encoded("Offset"),
            start: "2026-11-04T13:00:00+01:00",
            end: "2026-11-04T14:00:00+01:00",
          },
          {
            title: encoded("Ambiguous"),
            start: "2026-11-04 13:00:00",
            end: "2026-11-04 14:00:00",
          },
          {
            title: encoded("Invalid calendar"),
            start: "2026-02-30T13:00:00Z",
            end: "2099-01-01T14:00:00Z",
          },
        ],
      },
      "123",
      now,
    );
    expect(programmes).toHaveLength(1);
    expect(programmes[0].start).toBe("2026-11-04T12:00:00.000Z");
  });
  test("window mode includes overlaps, excludes exact boundaries and can show past data", () => {
    const payload = {
      epg_listings: [
        {
          title: encoded("Crossing"),
          start: "2026-11-04T13:30:00+02:00",
          end: "2026-11-04T14:30:00+02:00",
        },
        {
          title: encoded("Ended"),
          start: "2026-11-04T11:00:00Z",
          end: "2026-11-04T12:00:00Z",
        },
        {
          title: encoded("After"),
          start: "2026-11-04T15:00:00Z",
          end: "2026-11-04T16:00:00Z",
        },
      ],
    };
    expect(parseXtreamEpg(payload, "123", now + 86_400_000)).toEqual([]);
    const programmes = parseXtreamEpg(payload, "123", now + 86_400_000, {
      start: now,
      end: now + 3 * 3600_000,
    });
    expect(programmes.map((entry) => entry.title)).toEqual(["Crossing"]);
    expect(programmes[0].start).toBe("2026-11-04T11:30:00.000Z");
  });
  test("filters ended/invalid entries, sorts, deduplicates and caps at 20", () => {
    const listings = Array.from({ length: 30 }, (_, i) => ({
      start_timestamp: now / 1000 + i * 3600,
      stop_timestamp: now / 1000 + (i + 1) * 3600,
      title: encoded(String(i)),
    }));
    const entries = parseXtreamEpg(
      {
        epg_listings: [...listings]
          .reverse()
          .concat([
            listings[0],
            { start_timestamp: 1, stop_timestamp: 2, title: "" },
          ]),
      },
      "123",
      now,
    );
    expect(entries).toHaveLength(20);
    expect(entries[0].title).toBe("0");
    expect(
      parseXtreamEpg(
        {
          epg_listings: [
            {
              start_timestamp: now / 1000,
              end_timestamp: now / 1000 + 300,
              title: "bad%",
            },
          ],
        },
        "123",
        now,
      )[0].title,
    ).toBe("Live TV");
    expect(() => parseXtreamEpg({}, "123", now)).toThrow();
  });
});
