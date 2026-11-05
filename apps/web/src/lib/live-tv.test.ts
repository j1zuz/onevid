// @ts-expect-error -- Bun provides this runner at runtime; this repo does not install Bun type declarations.
// biome-ignore-all lint/style/noNonNullAssertion: tests assert on known fixture values.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import dns from "node:dns/promises";
import { EventEmitter } from "node:events";
import type {
  ClientRequest,
  IncomingHttpHeaders,
  IncomingMessage,
} from "node:http";
import https, { type RequestOptions } from "node:https";
import { PassThrough } from "node:stream";
import { DOMParser } from "@xmldom/xmldom";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "./db";
import {
  LIVE_TV_MAX_CHANNELS,
  LIVE_TV_MAX_PLAYLIST_BYTES,
  LIVE_TV_MAX_XMLTV_BYTES,
  normalizeLiveTvUrl,
  parseLiveTvPlaylist,
  parseLiveTvGuideRequest,
} from "./live-tv";
import {
  createLiveTvSource,
  fetchLiveTvPlaylist,
  fetchLiveTvResource,
  fetchXtreamChannels,
  loadLiveTvEpg,
  loadLiveTvGuide,
  updateLiveTvSourceEpg,
  summarizeLiveTvSource,
  readLiveTvJson,
  validateLiveTvSourceId,
} from "./live-tv-server";

const base = "https://provider.example/lists/live.m3u?token=private";
const parse = (text: string) => parseLiveTvPlaylist(text, base);
const playlist = "#EXTM3U\n#EXTINF:-1,News\n/live/news.m3u8";
const guideRequest = (channelIds: string[]) => ({
  sourceId: "source-id",
  channelIds,
  start: "2026-11-04T12:00:00Z",
  end: "2026-11-04T15:00:00Z",
});

describe("extended M3U parsing", () => {
  test("BOM, CRLF, quoted commas, metadata and relative URLs", () => {
    const [channel] = parse(
      '\uFEFF#EXTM3U\r\n#EXTINF:-1 tvg-name="Fallback, HD" tvg-id="news.id" tvg-logo="../logos/news.png" group-title="News, World",News, HD\r\n../streams/news.m3u8\r\n',
    );
    expect(channel).toMatchObject({
      name: "News, HD",
      tvgId: "news.id",
      group: "News, World",
      url: "https://provider.example/streams/news.m3u8",
      logo: "https://provider.example/logos/news.png",
    });
    expect(channel.id).toMatch(/^live-tv-[a-f0-9]{16}$/);
  });

  test("tvg-name fallback, single quoted attrs, EXTGRP and defaults", () => {
    const channels = parse(
      "#EXTM3U\n#EXTINF:-1 tvg-name='Sports, HD',\n#EXTGRP:Sports\n/sport\n#EXTINF:0,Other\n/other",
    );
    expect(channels[0]).toMatchObject({ name: "Sports, HD", group: "Sports" });
    expect(channels[1]).toMatchObject({ name: "Other", group: "Sin grupo" });
    expect(channels[1].logo).toBeUndefined();
  });

  test("uses Spanish fallback channel name and group", () => {
    expect(parse("#EXTM3U\n#EXTINF:-1,\n/unnamed")[0]).toMatchObject({
      name: "Live TV",
      group: "Sin grupo",
    });
  });

  test("group-title takes priority over EXTGRP", () => {
    expect(
      parse(
        '#EXTM3U\n#EXTINF:-1 group-title="Primary",Name\n#EXTGRP:Other\n/live',
      )[0].group,
    ).toBe("Primary");
  });

  test("deduplicates canonical stream URLs; IDs survive reordering", () => {
    const channels = parse(
      `${playlist}\n#EXTINF:-1,Duplicate\nhttps://provider.example/live/news.m3u8#fragment\n#EXTINF:-1,Other\n/other`,
    );
    expect(channels).toHaveLength(2);
    const reversed = parse(
      "#EXTM3U\n#EXTINF:-1,Other\n/other\n#EXTINF:-1,News\n/live/news.m3u8",
    );
    expect(channels.map((c) => c.id)).toEqual(
      reversed.map((c) => c.id).reverse(),
    );
  });

  test("filters HTTP channels and artwork while preserving relative HTTPS URLs", () => {
    const channels = parse(
      '#EXTM3U\n#EXTINF:-1,Insecure\nhttp://provider.example/live\n#EXTINF:-1 tvg-logo="http://provider.example/logo.png",Secure without artwork\nhttps://provider.example/live/secure.m3u8\n#EXTINF:-1 tvg-logo="../logos/relative.png",Relative\n../live/relative.m3u8\n#EXTINF:-1 tvg-logo="//cdn.example/logo.png",Scheme-relative\n//cdn.example/live.m3u8',
    );
    expect(channels.map((channel) => channel.name)).toEqual([
      "Secure without artwork",
      "Relative",
      "Scheme-relative",
    ]);
    expect(channels[0].logo).toBeUndefined();
    expect(channels[1]).toMatchObject({
      url: "https://provider.example/live/relative.m3u8",
      logo: "https://provider.example/logos/relative.png",
    });
    expect(channels[2]).toMatchObject({
      url: "https://cdn.example/live.m3u8",
      logo: "https://cdn.example/logo.png",
    });
    expect(
      channels.every((channel) => new URL(channel.url).protocol === "https:"),
    ).toBe(true);
    expect(() =>
      parse("#EXTM3U\n#EXTINF:-1,Insecure\nhttp://provider.example/live"),
    ).toThrow(
      "La lista de reproducción no contiene canales HTTPS compatibles.",
    );
  });

  test("skips non-HTTPS, userinfo, header syntax, orphan and malformed entries", () => {
    const channels = parse(
      `#EXTM3U\n/orphan\n#EXTINF:-1,FTP\nftp://example.com/live\n#EXTINF:-1,Userinfo\nhttps://user:pass@example.com/live\n#EXTINF:-1,Headers\nhttps://example.com/live|User-Agent=custom\n#EXTINF:broken,Malformed\n/bad\n#EXTINF:-1 tvg-logo="javascript:alert(1)",Good\n/good`,
    );
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe("Good");
    expect(channels[0].logo).toBeUndefined();
  });

  test.each([
    "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nsegment.ts",
    "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvariant.m3u8",
    "#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI=key\n/live",
  ])("rejects HLS media/master/DRM manifests", (text: string) => {
    expect(() => parse(text)).toThrow(
      "Los manifiestos HLS son URLs de reproducción, no listas de canales.",
    );
  });

  test.each([
    "#EXTVLCOPT:http-user-agent=custom",
    "#KODIPROP:inputstream.adaptive.license_key=secret",
    '#EXTHTTP:{"Referer":"x"}',
  ])("rejects unsupported player directives", (directive: string) => {
    expect(() => parse(`${playlist}\n${directive}`)).toThrow(
      "No se admiten DRM ni cabeceras de reproducción personalizadas.",
    );
  });

  test.each([
    "",
    "<html>not a playlist</html>",
    "#EXTM3U\n#EXTINF:-1,No stream",
    "#EXTM3U\nhttps://example.com/orphan",
  ])("rejects invalid/empty lists", (text: string) => {
    expect(() => parse(text)).toThrow();
  });

  test("caps unique channels", () => {
    const text =
      "#EXTM3U\n" +
      Array.from(
        { length: LIVE_TV_MAX_CHANNELS + 10 },
        (_, i) => `#EXTINF:-1,Channel ${i}\n/${i}`,
      ).join("\n");
    expect(parse(text)).toHaveLength(LIVE_TV_MAX_CHANNELS);
  });

  test("enforces size cap", () => {
    expect(() => parse("x".repeat(LIVE_TV_MAX_PLAYLIST_BYTES + 1))).toThrow(
      "1 MiB",
    );
  });

  test("normalization only accepts HTTPS, including resolved relative URLs", () => {
    expect(normalizeLiveTvUrl("../live.m3u8", base)).toBe(
      "https://provider.example/live.m3u8",
    );
    expect(normalizeLiveTvUrl("//cdn.example/live.m3u8", base)).toBe(
      "https://cdn.example/live.m3u8",
    );
    for (const url of [
      "http://provider.example/list",
      "HTTP://provider.example/list",
      "http://provider.example:443/list",
    ]) {
      expect(() => normalizeLiveTvUrl(url)).toThrow(
        "URL HTTPS inválida; no se admiten credenciales en la URL.",
      );
    }
    expect(() =>
      normalizeLiveTvUrl("relative.m3u8", "http://provider.example/list"),
    ).toThrow("URL HTTPS inválida");
    expect(() =>
      parseLiveTvPlaylist(playlist, "http://provider.example/list"),
    ).toThrow("URL HTTPS inválida");
  });

  test("normalizes URLs without exposing userinfo or supporting arbitrary schemes", () => {
    expect(normalizeLiveTvUrl(" https://EXAMPLE.com:443/list#x ")).toBe(
      "https://example.com/list",
    );
    for (const url of [
      "https://user:pass@example.com/list",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://example.com/a\nb",
    ]) {
      expect(() => normalizeLiveTvUrl(url)).toThrow();
    }
  });
});

describe("pinned bounded HTTPS playlist transport", () => {
  interface Reply {
    status?: number;
    headers?: IncomingHttpHeaders;
    body?: string;
    chunks?: Buffer[];
    stall?: boolean;
    error?: Error;
    aborted?: boolean;
  }
  let requestSpy: ReturnType<typeof spyOn>;
  let dnsSpy: ReturnType<typeof spyOn>;
  let selectSpy: ReturnType<typeof spyOn> | undefined;
  let ownership: SQL | undefined;
  let parserSpy: ReturnType<typeof spyOn> | undefined;
  let activeEpg = 0;
  let peakEpg = 0;
  let updateSpy: ReturnType<typeof spyOn> | undefined;
  let updateOwnership: SQL | undefined;
  let savedUpdate: { epgUrl: string | null; updatedAt: Date } | undefined;
  function mockUpdate(sourceType = "m3u", deleted = false) {
    updateSpy = spyOn(db, "update").mockReturnValue({
      set: (values: { epgUrl: string | null; updatedAt: Date }) => {
        savedUpdate = values;
        return {
          where: (predicate: SQL) => {
            updateOwnership = predicate;
            return {
              returning: async () =>
                deleted
                  ? []
                  : [
                      {
                        id: "source-id",
                        name: "Live TV",
                        channelCount: 2,
                        sourceType,
                        epgUrl: values.epgUrl,
                      },
                    ],
            };
          },
        };
      },
    } as never);
  }
  function mockSource(
    source: { url: string; sourceType: string; epgUrl: string | null } | null,
  ) {
    selectSpy = spyOn(db, "select").mockReturnValue({
      from: () => ({
        where: (predicate: SQL) => {
          ownership = predicate;
          return { limit: async () => (source ? [source] : []) };
        },
      }),
    } as never);
  }
  let replies: Reply[];
  let responses: PassThrough[];
  let requests: { destroyed: boolean }[];
  const optionsAt = (index = 0): RequestOptions =>
    requestSpy.mock.calls[index][1];
  const expectSanitizedError = (promise: Promise<unknown>) =>
    expect(promise).rejects.toMatchObject({
      name: "LiveTvError",
      message:
        "No se pudo cargar la lista de reproducción desde un servidor HTTPS público.",
      status: 400,
    });

  beforeEach(() => {
    selectSpy = undefined;
    updateSpy = undefined;
    ownership = undefined;
    updateOwnership = undefined;
    savedUpdate = undefined;
    parserSpy = undefined;
    activeEpg = 0;
    peakEpg = 0;
    replies = [];
    responses = [];
    requests = [];
    dnsSpy = spyOn(dns, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ]);
    requestSpy = spyOn(https, "request").mockImplementation(
      (
        _target: URL,
        _options: RequestOptions,
        callback: (response: IncomingMessage) => void,
      ): ClientRequest => {
        const reply = replies.shift() ?? { body: playlist };
        const state = { destroyed: false };
        const isEpg = _target.searchParams.get("action") === "get_short_epg";
        if (isEpg) {
          activeEpg++;
          peakEpg = Math.max(peakEpg, activeEpg);
        }
        requests.push(state);
        const request = new EventEmitter();
        Object.assign(request, {
          destroy: () => {
            if (!state.destroyed && isEpg) activeEpg--;
            state.destroyed = true;
            return request;
          },
          end: () => {
            queueMicrotask(() => {
              if (reply.error) {
                request.emit("error", reply.error);
                return;
              }
              const response = new PassThrough();
              responses.push(response);
              Object.assign(response, {
                statusCode: reply.status ?? 200,
                headers: reply.headers ?? {},
              });
              callback(response as unknown as IncomingMessage);
              if (response.destroyed || reply.stall) return;
              if (reply.aborted) {
                response.emit("aborted");
                return;
              }
              for (const chunk of reply.chunks ?? [
                Buffer.from(reply.body ?? playlist),
              ]) {
                if (response.destroyed) break;
                response.write(chunk);
              }
              if (!response.destroyed) response.end();
            });
            return request;
          },
        });
        return request as ClientRequest;
      },
    );
  });
  afterEach(() => {
    requestSpy.mockRestore();
    dnsSpy.mockRestore();
    selectSpy?.mockRestore();
    updateSpy?.mockRestore();
    parserSpy?.mockRestore();
  });

  test("rejects HTTP sources before database access or transport", async () => {
    const expected = {
      name: "LiveTvError",
      status: 400,
      message: "URL HTTPS inválida; no se admiten credenciales en la URL.",
    };
    await expect(
      createLiveTvSource("test-user", { url: "http://93.184.216.34/list" }),
    ).rejects.toMatchObject(expected);
    await expect(
      fetchLiveTvPlaylist("http://93.184.216.34/list"),
    ).rejects.toMatchObject(expected);
    expect(requestSpy).not.toHaveBeenCalled();
    expect(dnsSpy).not.toHaveBeenCalled();
  });

  test("blocks HTTPS to HTTP redirect downgrades before a second request", async () => {
    replies.push({
      status: 302,
      headers: { location: "http://93.184.216.34/downgrade" },
    });
    await expect(
      fetchLiveTvPlaylist("https://93.184.216.34/list"),
    ).rejects.toMatchObject({
      name: "LiveTvError",
      status: 400,
      message: "URL HTTPS inválida; no se admiten credenciales en la URL.",
    });
    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(responses[0].destroyed).toBe(true);
  });

  test("follows manual redirects and resolves against the final HTTPS URL", async () => {
    replies.push(
      { status: 302, headers: { location: "/final/list.m3u" } },
      { body: "#EXTM3U\n#EXTINF:-1,News\nstream.m3u8" },
    );
    const channels = await fetchLiveTvPlaylist(
      "https://93.184.216.34/start?secret=hidden",
    );
    expect(channels[0].url).toBe("https://93.184.216.34/final/stream.m3u8");
    expect(optionsAt()).toMatchObject({
      method: "GET",
      agent: false,
      rejectUnauthorized: true,
      autoSelectFamily: false,
      maxHeaderSize: 16 * 1024,
    });
    expect(optionsAt().headers).toEqual({
      accept: "application/x-mpegURL, audio/x-mpegurl, text/plain",
      "accept-encoding": "identity",
    });
    expect(dnsSpy).not.toHaveBeenCalled();
    expect(responses.every((response) => response.destroyed)).toBe(true);
  });

  test("pins connector lookup to validated DNS without a second resolution", async () => {
    dnsSpy
      .mockResolvedValueOnce([
        { address: "93.184.216.34", family: 4 },
        { address: "2606:4700:4700::1111", family: 6 },
      ])
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await fetchLiveTvPlaylist("https://provider.example/list?token=private");
    const options = optionsAt();
    expect(options.servername).toBe("provider.example");
    expect(options.family).toBe(4);
    expect((requestSpy.mock.calls[0][0] as URL).hostname).toBe(
      "provider.example",
    );
    expect(options.rejectUnauthorized).toBe(true);
    expect(options.checkServerIdentity).toBeUndefined();
    expect(options.agent).toBe(false);
    const single: unknown[] = [];
    options.lookup!("provider.example", {}, (error, address, family) =>
      single.push(error, address, family),
    );
    expect(single).toEqual([null, "93.184.216.34", 4]);
    const all: unknown[] = [];
    options.lookup!("provider.example", { all: true }, (error, addresses) =>
      all.push(error, addresses),
    );
    expect(all).toEqual([null, [{ address: "93.184.216.34", family: 4 }]]);
    expect(dnsSpy).toHaveBeenCalledTimes(1);
  });

  test("pins public IPv6 DNS answers and keeps hostname TLS verification", async () => {
    dnsSpy.mockResolvedValue([{ address: "2606:4700:4700::1111", family: 6 }]);
    await fetchLiveTvPlaylist("https://provider.example/list");
    const options = optionsAt();
    expect(options.family).toBe(6);
    expect(options.servername).toBe("provider.example");
    const answer: unknown[] = [];
    options.lookup!("provider.example", {}, (error, address, family) =>
      answer.push(error, address, family),
    );
    expect(answer).toEqual([null, "2606:4700:4700::1111", 6]);
    expect(dnsSpy).toHaveBeenCalledTimes(1);
  });

  test.each([
    "https://127.0.0.1/list",
    "https://10.0.0.1/list",
    "https://[::1]/list",
    "https://[::ffff:127.0.0.1]/list",
    "https://169.254.169.254/list",
    "https://100.64.0.1/list",
    "https://[fc00::1]/list",
  ])(
    "blocks nonpublic literal targets before transport",
    async (url: string) => {
      await expect(fetchLiveTvPlaylist(url)).rejects.toThrow(
        "La URL de la lista de reproducción debe usar un servidor público.",
      );
      expect(requestSpy).not.toHaveBeenCalled();
      expect(dnsSpy).not.toHaveBeenCalled();
    },
  );

  test.each(["127.0.0.1", "169.254.169.254", "::ffff:127.0.0.1", "fc00::1"])(
    "rejects mixed public/private DNS answers",
    async (address: string) => {
      dnsSpy.mockResolvedValue([
        { address: "93.184.216.34", family: 4 },
        { address, family: address.includes(":") ? 6 : 4 },
      ]);
      await expect(
        fetchLiveTvPlaylist("https://provider.example/list"),
      ).rejects.toThrow(
        "La URL de la lista de reproducción debe usar un servidor público.",
      );
      expect(requestSpy).not.toHaveBeenCalled();
    },
  );

  test("rejects empty DNS results", async () => {
    dnsSpy.mockResolvedValue([]);
    await expect(
      fetchLiveTvPlaylist("https://provider.example/list"),
    ).rejects.toThrow("servidor público");
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("blocks private literal redirect destinations", async () => {
    replies.push({
      status: 302,
      headers: { location: "https://127.0.0.1/private" },
    });
    await expect(
      fetchLiveTvPlaylist("https://93.184.216.34/list"),
    ).rejects.toThrow(
      "La URL de la lista de reproducción debe usar un servidor público.",
    );
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  test("revalidates DNS even on same-host redirects and blocks rebinding", async () => {
    dnsSpy
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    replies.push({ status: 302, headers: { location: "/rebound" } });
    await expect(
      fetchLiveTvPlaylist("https://provider.example/list"),
    ).rejects.toThrow("servidor público");
    expect(dnsSpy).toHaveBeenCalledTimes(2);
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  test("revalidates and pins a different redirect hostname", async () => {
    dnsSpy
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }]);
    replies.push(
      {
        status: 302,
        headers: { location: "https://cdn.example/final/list.m3u" },
      },
      { body: "#EXTM3U\n#EXTINF:-1,News\nstream.m3u8" },
    );
    const channels = await fetchLiveTvPlaylist("https://provider.example/list");
    expect(channels[0].url).toBe("https://cdn.example/final/stream.m3u8");
    expect(optionsAt(1).servername).toBe("cdn.example");
    const answer: unknown[] = [];
    optionsAt(1).lookup!("cdn.example", {}, (error, address, family) =>
      answer.push(error, address, family),
    );
    expect(answer).toEqual([null, "1.1.1.1", 4]);
    expect(dnsSpy).toHaveBeenCalledTimes(2);
  });

  test("limits redirect loops", async () => {
    replies.push(
      ...Array.from({ length: 4 }, () => ({
        status: 302,
        headers: { location: "/loop" },
      })),
    );
    await expect(
      fetchLiveTvPlaylist("https://93.184.216.34/list"),
    ).rejects.toThrow(
      "Las redirecciones de la lista de reproducción no son válidas o superan el límite permitido.",
    );
    expect(requestSpy).toHaveBeenCalledTimes(4);
  });

  test("caps streamed bytes even without Content-Length and destroys transport", async () => {
    replies.push({
      chunks: [Buffer.alloc(LIVE_TV_MAX_PLAYLIST_BYTES), Buffer.from("x")],
    });
    await expect(
      fetchLiveTvPlaylist("https://93.184.216.34/list"),
    ).rejects.toThrow("El contenido supera el tamaño permitido.");
    expect(responses[0].destroyed).toBe(true);
    expect(requests[0].destroyed).toBe(true);
  });

  test("deadline covers stalled bodies and destroys both response and request", async () => {
    replies.push({ stall: true });
    await expect(
      fetchLiveTvPlaylist("https://93.184.216.34/list"),
    ).rejects.toThrow(
      "Se agotó el tiempo de espera al solicitar la lista de reproducción.",
    );
    expect(responses[0].destroyed).toBe(true);
    expect(requests[0].destroyed).toBe(true);
  }, 15_000);

  test("deadline covers DNS and late resolution cannot initiate transport", async () => {
    let completeLookup!: (value: { address: string; family: number }[]) => void;
    dnsSpy.mockReturnValue(
      new Promise((resolve) => {
        completeLookup = resolve;
      }),
    );
    await expect(
      fetchLiveTvPlaylist("https://provider.example/list"),
    ).rejects.toThrow(
      "Se agotó el tiempo de espera al solicitar la lista de reproducción.",
    );
    completeLookup([{ address: "93.184.216.34", family: 4 }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requestSpy).not.toHaveBeenCalled();
  }, 15_000);

  test("checks declared body size before reading", async () => {
    replies.push({
      headers: { "content-length": String(LIVE_TV_MAX_PLAYLIST_BYTES + 1) },
    });
    await expect(
      fetchLiveTvPlaylist("https://93.184.216.34/list"),
    ).rejects.toThrow("1 MiB");
    expect(responses[0].destroyed).toBe(true);
  });

  test("requests identity encoding and rejects unexpected compression", async () => {
    replies.push({ headers: { "content-encoding": "gzip" } });
    await expect(
      fetchLiveTvPlaylist("https://93.184.216.34/list"),
    ).rejects.toThrow("No se admiten listas de reproducción comprimidas.");
    expect(responses[0].destroyed).toBe(true);
  });

  test("decodes UTF-8 correctly across chunk boundaries", async () => {
    const bytes = Buffer.from("#EXTM3U\n#EXTINF:-1,Español\n/live");
    const split = bytes.indexOf(Buffer.from("ñ")) + 1;
    replies.push({ chunks: [bytes.subarray(0, split), bytes.subarray(split)] });
    expect(
      (await fetchLiveTvPlaylist("https://93.184.216.34/list"))[0].name,
    ).toBe("Español");
  });

  test("sanitizes transport/TLS failures without leaking provider credentials", async () => {
    replies.push({
      error: new Error("certificate error https://provider/list?token=secret"),
    });
    await expectSanitizedError(
      fetchLiveTvPlaylist("https://93.184.216.34/list?token=secret"),
    );
    expect(requests[0].destroyed).toBe(true);
  });

  test("sanitizes DNS failures without starting a request", async () => {
    dnsSpy.mockRejectedValue(new Error("failed secret-provider.example"));
    await expectSanitizedError(
      fetchLiveTvPlaylist("https://provider.example/list?token=secret"),
    );
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("rejects incomplete response bodies", async () => {
    replies.push({ aborted: true });
    await expectSanitizedError(
      fetchLiveTvPlaylist("https://93.184.216.34/list"),
    );
    expect(responses[0].destroyed).toBe(true);
  });

  test("never follows credential-bearing Xtream redirects across origins", async () => {
    replies.push({
      status: 302,
      headers: {
        location:
          "https://other.example/player_api.php?username=u&password=secret",
      },
    });
    await expect(
      fetchLiveTvResource(
        "https://provider.example/player_api.php?username=u&password=secret",
      ),
    ).rejects.toThrow(
      "No se permiten redirecciones de credenciales de Live TV a otro servidor.",
    );
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  test("allows pinned same-origin credential redirects and larger bounded XML guides", async () => {
    replies.push(
      { status: 302, headers: { location: "/final" } },
      { body: "x".repeat(LIVE_TV_MAX_PLAYLIST_BYTES + 1) },
    );
    const response = await fetchLiveTvResource(
      "https://provider.example/guide?username=u&password=secret",
      { maxBytes: LIVE_TV_MAX_XMLTV_BYTES, accept: "application/xml" },
    );
    expect(response.text).toHaveLength(LIVE_TV_MAX_PLAYLIST_BYTES + 1);
    expect(response.url).toBe("https://provider.example/final");
    expect(optionsAt(1).headers).toMatchObject({ accept: "application/xml" });
  });

  test("fetches Xtream auth, streams and categories via pinned HTTPS", async () => {
    replies.push(
      {
        body: JSON.stringify({
          user_info: { auth: 1, status: "Active", exp_date: null },
          server_info: { url: "http://evil.example" },
        }),
      },
      {
        body: JSON.stringify([
          { stream_id: 123, name: "News", category_id: 9 },
        ]),
      },
      { body: JSON.stringify([{ category_id: 9, category_name: "Noticias" }]) },
    );
    const channels = await fetchXtreamChannels(
      "https://provider.example/base/player_api.php?username=user&password=secret",
    );
    expect(channels[0]).toMatchObject({
      id: "xtream-123",
      group: "Noticias",
      url: "https://provider.example/base/live/user/secret/123.m3u8",
    });
    expect(
      (requestSpy.mock.calls[1][0] as URL).searchParams.get("action"),
    ).toBe("get_live_streams");
    expect(
      (requestSpy.mock.calls[2][0] as URL).searchParams.get("action"),
    ).toBe("get_live_categories");
    expect(optionsAt().headers).toMatchObject({ accept: "application/json" });
  });

  test("invalid Xtream auth stops before fetching streams/categories", async () => {
    replies.push({ body: '{"user_info":{"auth":0,"status":"Disabled"}}' });
    await expect(
      fetchXtreamChannels(
        "https://provider.example/player_api.php?username=u&password=p",
      ),
    ).rejects.toThrow("Live TV");
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  test("malformed Xtream JSON errors never expose provider bodies", async () => {
    replies.push({ body: "secret provider credentials" });
    await expect(
      fetchXtreamChannels(
        "https://provider.example/player_api.php?username=u&password=p",
      ),
    ).rejects.toMatchObject({
      message: "La respuesta del proveedor de Live TV no es JSON válido.",
      status: 400,
    });
  });

  test("source summary includes only the public contract", () => {
    const summary = summarizeLiveTvSource({
      id: "s",
      name: "Live TV",
      channelCount: 10,
      sourceType: "xtream",
      epgUrl: "https://guide.example?secret=token",
    });
    expect(summary).toEqual({
      id: "s",
      name: "Live TV",
      channelCount: 10,
      type: "xtream",
      hasEpg: true,
    });
    expect(
      summarizeLiveTvSource({
        id: "old",
        name: "Lista IPTV",
        channelCount: 1,
        sourceType: "m3u",
        epgUrl: null,
      }),
    ).toEqual({
      id: "old",
      name: "Live TV",
      channelCount: 1,
      type: "m3u",
      hasEpg: false,
    });
  });

  test("validates source discriminants, HTTPS EPG and Xtream before DB access", async () => {
    for (const body of [
      { type: "invalid", url: base },
      { type: "m3u", url: base, epgUrl: "http://guide.example" },
      {
        type: "xtream",
        serverUrl: "http://provider.example",
        username: "u",
        password: "p",
      },
      { type: "xtream", serverUrl: base, username: "", password: "p" },
    ])
      await expect(createLiveTvSource("u", body)).rejects.toThrow();
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("PATCH replaces a guide after ownership/DNS checks and returns no URLs", async () => {
    mockSource({
      sourceType: "m3u",
      url: base,
      epgUrl: "https://old.example?secret=old",
    });
    mockUpdate();
    const source = await updateLiveTvSourceEpg("requester", {
      id: "source-id",
      epgUrl: "https://GUIDE.example:443/schedule.xml?secret=new#fragment",
    });
    expect(source).toEqual({
      id: "source-id",
      name: "Live TV",
      channelCount: 2,
      type: "m3u",
      hasEpg: true,
    });
    expect(JSON.stringify(source)).not.toContain("secret");
    expect(savedUpdate?.epgUrl).toBe(
      "https://guide.example/schedule.xml?secret=new",
    );
    expect(savedUpdate?.updatedAt).toBeInstanceOf(Date);
    expect(new PgDialect().sqlToQuery(ownership!).params).toEqual([
      "source-id",
      "requester",
    ]);
    expect(new PgDialect().sqlToQuery(updateOwnership!).params).toEqual([
      "source-id",
      "requester",
    ]);
    expect(dnsSpy).toHaveBeenCalledWith("guide.example", {
      all: true,
      verbatim: true,
    });
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test.each(["m3u", "xtream"])(
    "PATCH null clears overrides without DNS; Xtream keeps automatic EPG",
    async (sourceType: string) => {
      mockSource({
        sourceType,
        url: base,
        epgUrl: "https://old.example?secret=old",
      });
      mockUpdate(sourceType);
      const source = await updateLiveTvSourceEpg("requester", {
        id: "source-id",
        epgUrl: null,
      });
      expect(source.hasEpg).toBe(sourceType === "xtream");
      expect(source.type).toBe(sourceType);
      expect(savedUpdate?.epgUrl).toBeNull();
      expect(dnsSpy).not.toHaveBeenCalled();
      expect(requestSpy).not.toHaveBeenCalled();
    },
  );

  test("PATCH rejects unowned sources before DNS or writes", async () => {
    mockSource(null);
    mockUpdate();
    await expect(
      updateLiveTvSourceEpg("requester", {
        id: "foreign",
        epgUrl: "https://guide.example",
      }),
    ).rejects.toMatchObject({
      status: 404,
      message: "Fuente de Live TV no encontrada.",
    });
    expect(new PgDialect().sqlToQuery(ownership!).params).toEqual([
      "foreign",
      "requester",
    ]);
    expect(dnsSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("PATCH requires explicit URL/null and rejects malformed/insecure URLs before DNS", async () => {
    mockSource({ sourceType: "m3u", url: base, epgUrl: null });
    mockUpdate();
    for (const input of [
      null,
      [],
      {},
      { id: "", epgUrl: null },
      { id: "source-id" },
      { id: "source-id", epgUrl: 42 },
      ...[
        "",
        "not a URL",
        "http://guide.example",
        "https://user:password@guide.example",
        `https://guide.example/${"x".repeat(2048)}`,
      ].map((epgUrl) => ({ id: "source-id", epgUrl })),
    ]) {
      await expect(
        updateLiveTvSourceEpg("requester", input),
      ).rejects.toMatchObject({
        name: "LiveTvError",
        status: 400,
        message: expect.stringContaining("Live TV"),
      });
    }
    expect(dnsSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("PATCH blocks private literal EPG targets without changing configuration", async () => {
    mockSource({ sourceType: "m3u", url: base, epgUrl: null });
    mockUpdate();
    for (const epgUrl of [
      "https://127.0.0.1/guide.xml",
      "https://169.254.169.254/guide",
      "https://[::1]/guide",
      "https://[fc00::1]/guide",
    ]) {
      await expect(
        updateLiveTvSourceEpg("requester", { id: "source-id", epgUrl }),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining("Live TV"),
      });
    }
    expect(updateSpy).not.toHaveBeenCalled();
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("PATCH rejects empty/private/mixed/failed DNS with sanitized errors", async () => {
    mockSource({ sourceType: "m3u", url: base, epgUrl: null });
    mockUpdate();
    dnsSpy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }])
      .mockResolvedValueOnce([
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ])
      .mockRejectedValueOnce(new Error("secret-provider.example"));
    for (let i = 0; i < 4; i++) {
      await expect(
        updateLiveTvSourceEpg("requester", {
          id: "source-id",
          epgUrl: "https://guide.example?secret=token",
        }),
      ).rejects.toMatchObject({
        status: 400,
        message:
          "No se pudo validar la URL de la guía de Live TV; debe usar un servidor público accesible.",
      });
    }
    expect(updateSpy).not.toHaveBeenCalled();
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("PATCH public IP EPG targets need no DNS or provider download", async () => {
    mockSource({ sourceType: "m3u", url: base, epgUrl: null });
    mockUpdate();
    expect(
      (
        await updateLiveTvSourceEpg("requester", {
          id: "source-id",
          epgUrl: "https://93.184.216.34/guide.xml",
        })
      ).hasEpg,
    ).toBe(true);
    expect(dnsSpy).not.toHaveBeenCalled();
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("PATCH detects deletion during DNS validation", async () => {
    mockSource({ sourceType: "m3u", url: base, epgUrl: null });
    mockUpdate("m3u", true);
    await expect(
      updateLiveTvSourceEpg("requester", {
        id: "source-id",
        epgUrl: "https://guide.example",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(new PgDialect().sqlToQuery(updateOwnership!).params).toEqual([
      "source-id",
      "requester",
    ]);
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("PATCH bounds DNS time and late resolution cannot update the source", async () => {
    mockSource({ sourceType: "m3u", url: base, epgUrl: null });
    mockUpdate();
    let completeLookup!: (value: { address: string; family: number }[]) => void;
    dnsSpy.mockReturnValue(
      new Promise((resolve) => {
        completeLookup = resolve;
      }),
    );
    await expect(
      updateLiveTvSourceEpg("requester", {
        id: "source-id",
        epgUrl: "https://guide.example",
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("Live TV"),
    });
    completeLookup([{ address: "93.184.216.34", family: 4 }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateSpy).not.toHaveBeenCalled();
    expect(requestSpy).not.toHaveBeenCalled();
  }, 15_000);

  test("batch rejects invalid requests before database/provider access", async () => {
    mockSource(null);
    await expect(
      loadLiveTvGuide(
        "requester",
        guideRequest(Array.from({ length: 13 }, (_, i) => String(i))),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(selectSpy).not.toHaveBeenCalled();
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("batch verifies source ownership before contacting the provider", async () => {
    mockSource(null);
    await expect(
      loadLiveTvGuide("requester", guideRequest(["foreign-channel"])),
    ).rejects.toMatchObject({ status: 404 });
    expect(new PgDialect().sqlToQuery(ownership!).params).toEqual([
      "source-id",
      "requester",
    ]);
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("batch checks all channel memberships against one catalog before guide download", async () => {
    mockSource({
      sourceType: "m3u",
      url: base,
      epgUrl: "https://guide.example?secret=token",
    });
    await expect(
      loadLiveTvGuide(
        "requester",
        guideRequest([parse(playlist)[0].id, "foreign-channel"]),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  test("batch fetches XMLTV once, parses one DOM and filters overlapping programmes", async () => {
    const list =
      '#EXTM3U\n#EXTINF:-1 tvg-id="a",A\n/a\n#EXTINF:-1 tvg-id="b",B\n/b\n#EXTINF:-1,No mapping\n/c\n#EXTINF:-1 tvg-id="a",Duplicate mapping\n/d';
    const ids = parse(list).map((channel) => channel.id);
    mockSource({
      sourceType: "m3u",
      url: base,
      epgUrl: "https://guide.example?secret=token",
    });
    replies.push(
      { body: list },
      {
        body: '<tv><programme channel="a" start="20261104123000 +0100" stop="20261104133000 +0100"><title>Crosses start</title></programme><programme channel="a" start="20261104143000Z" stop="20261104153000Z"><title>Crosses end</title></programme><programme channel="a" start="20261104110000Z" stop="20261104120000Z"><title>Ended at boundary</title></programme><programme channel="a" start="20261104150000Z" stop="20261104160000Z"><title>Starts at boundary</title></programme><programme channel="b" start="20261104130000Z" stop="20261104140000Z"><title>B schedule</title></programme></tv>',
      },
    );
    parserSpy = spyOn(DOMParser.prototype, "parseFromString");
    const response = await loadLiveTvGuide("requester", guideRequest(ids));
    expect(response.channels.map((row) => row.channelId)).toEqual(ids);
    expect(
      response.channels[0].programmes.map((programme) => programme.title),
    ).toEqual(["Crosses start", "Crosses end"]);
    expect(response.channels[0].programmes[0].start).toBe(
      "2026-11-04T11:30:00.000Z",
    );
    expect(response.channels[0].programmes[1].end).toBe(
      "2026-11-04T15:30:00.000Z",
    );
    expect(response.channels[1].programmes[0].title).toBe("B schedule");
    expect(response.channels[2]).toEqual({ channelId: ids[2], programmes: [] });
    expect(response.channels[3].programmes).toEqual(
      response.channels[0].programmes,
    );
    expect(requestSpy).toHaveBeenCalledTimes(2);
    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect(parserSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(response)).not.toContain("secret");
  });

  test("batch shared XMLTV failure marks mapped rows only without leaking errors", async () => {
    const list =
      '#EXTM3U\n#EXTINF:-1 tvg-id="a",A\n/a\n#EXTINF:-1,Unmapped\n/b';
    const ids = parse(list).map((channel) => channel.id);
    mockSource({
      sourceType: "m3u",
      url: base,
      epgUrl: "https://guide.example?secret=token",
    });
    replies.push(
      { body: list },
      { body: '<!DOCTYPE tv SYSTEM "https://secret.example"><tv/>' },
    );
    expect(await loadLiveTvGuide("requester", guideRequest(ids))).toEqual({
      channels: [
        { channelId: ids[0], programmes: [], error: true },
        { channelId: ids[1], programmes: [] },
      ],
    });
    expect(requestSpy).toHaveBeenCalledTimes(2);
  });

  test("batch returns real empty rows without inventing slots or fetching absent EPG", async () => {
    mockSource({ sourceType: "m3u", url: base, epgUrl: null });
    const id = parse(playlist)[0].id;
    expect(await loadLiveTvGuide("requester", guideRequest([id]))).toEqual({
      channels: [{ channelId: id, programmes: [] }],
    });
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  test("batch authenticates/catalogs Xtream once, limits guide concurrency to 3 and isolates failures", async () => {
    const streams = Array.from({ length: 12 }, (_, i) => ({
      stream_id: i + 1,
    }));
    const ids = streams.map((stream) => `xtream-${stream.stream_id}`);
    mockSource({
      sourceType: "xtream",
      url: "https://provider.example/player_api.php?username=u&password=secret",
      epgUrl: null,
    });
    replies.push(
      { body: '{"user_info":{"auth":1,"status":"Active"}}' },
      { body: JSON.stringify(streams) },
      { body: "[]" },
      ...streams.map((stream, index) =>
        index === 1
          ? { status: 403, body: "secret failure details" }
          : {
              body: JSON.stringify({
                epg_listings: [
                  {
                    start: "2026-11-04T13:00:00+01:00",
                    end: "2026-11-04T14:00:00+01:00",
                    title: Buffer.from(
                      `Programme ${stream.stream_id}`,
                    ).toString("base64"),
                  },
                ],
              }),
            },
      ),
    );
    const response = await loadLiveTvGuide("requester", guideRequest(ids));
    expect(response.channels).toHaveLength(12);
    expect(response.channels.map((row) => row.channelId)).toEqual(ids);
    expect(response.channels[0].programmes[0].title).toBe("Programme 1");
    expect(response.channels[1]).toEqual({
      channelId: ids[1],
      programmes: [],
      error: true,
    });
    expect(response.channels[11].programmes[0].title).toBe("Programme 12");
    expect(peakEpg).toBe(3);
    expect(activeEpg).toBe(0);
    expect(selectSpy).toHaveBeenCalledTimes(1);
    const actions = requestSpy.mock.calls.map((call: [URL]) =>
      call[0].searchParams.get("action"),
    );
    expect(
      actions.filter((action: string | null) => action === null),
    ).toHaveLength(1);
    expect(
      actions.filter((action: string | null) => action === "get_live_streams"),
    ).toHaveLength(1);
    expect(
      actions.filter(
        (action: string | null) => action === "get_live_categories",
      ),
    ).toHaveLength(1);
    expect(
      actions.filter((action: string | null) => action === "get_short_epg"),
    ).toHaveLength(12);
    expect(JSON.stringify(response)).not.toContain("secret");
  });

  test("batch invalid Xtream auth stops before catalog and row requests", async () => {
    mockSource({
      sourceType: "xtream",
      url: "https://provider.example/player_api.php?username=u&password=p",
      epgUrl: null,
    });
    replies.push({ body: '{"user_info":{"auth":0,"status":"Disabled"}}' });
    await expect(
      loadLiveTvGuide("requester", guideRequest(["xtream-1"])),
    ).rejects.toMatchObject({ status: 400 });
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  test("batch Xtream XMLTV override downloads/parses one guide with no short-EPG calls", async () => {
    mockSource({
      sourceType: "xtream",
      url: "https://provider.example/player_api.php?username=u&password=p",
      epgUrl: "https://guide.example/list.xml",
    });
    replies.push(
      { body: '{"user_info":{"auth":1,"status":"Active"}}' },
      {
        body: '[{"stream_id":1,"epg_channel_id":"a"},{"stream_id":2,"epg_channel_id":"b"}]',
      },
      { body: "[]" },
      {
        body: '<tv><programme channel="a" start="20261104130000Z" stop="20261104140000Z"><title>A</title></programme></tv>',
      },
    );
    parserSpy = spyOn(DOMParser.prototype, "parseFromString");
    const response = await loadLiveTvGuide(
      "requester",
      guideRequest(["xtream-1", "xtream-2"]),
    );
    expect(response.channels[0].programmes[0].title).toBe("A");
    expect(response.channels[1]).toEqual({
      channelId: "xtream-2",
      programmes: [],
    });
    expect(requestSpy).toHaveBeenCalledTimes(4);
    expect(parserSpy).toHaveBeenCalledTimes(1);
    expect((requestSpy.mock.calls[3][0] as URL).hostname).toBe("guide.example");
  });

  test("EPG verifies source ownership before any network call", async () => {
    mockSource(null);
    await expect(
      loadLiveTvEpg("requester", "source-id", "channel-id"),
    ).rejects.toMatchObject({ status: 404 });
    const query = new PgDialect().sqlToQuery(ownership!);
    expect(query.params).toEqual(["source-id", "requester"]);
    expect(query.sql).toContain('"user_id"');
    expect(requestSpy).not.toHaveBeenCalled();
  });

  test("EPG verifies channel membership before contacting the guide", async () => {
    mockSource({
      sourceType: "m3u",
      url: base,
      epgUrl: "https://guide.example?secret=token",
    });
    replies.push({ body: playlist });
    await expect(
      loadLiveTvEpg("requester", "source-id", "foreign-channel"),
    ).rejects.toMatchObject({ status: 404 });
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  test("M3U EPG matches server-side tvg-id, not a client-selected XML channel", async () => {
    const list = '#EXTM3U\n#EXTINF:-1 tvg-id="news.id",News\n/live';
    mockSource({
      sourceType: "m3u",
      url: base,
      epgUrl: "https://guide.example?token=private",
    });
    replies.push(
      { body: list },
      {
        body: '<tv><programme channel="news.id" start="20990101120000Z" stop="20990101130000Z"><title>Future</title></programme><programme channel="other" start="20990101120000Z" stop="20990101130000Z"><title>Other</title></programme></tv>',
      },
    );
    const entries = await loadLiveTvEpg(
      "requester",
      "source-id",
      parseLiveTvPlaylist(list, base)[0].id,
    );
    expect(entries.map((entry) => entry.title)).toEqual(["Future"]);
    expect((requestSpy.mock.calls[1][0] as URL).href).toBe(
      "https://guide.example/?token=private",
    );
  });

  test("Xtream automatic EPG binds stream_id and decodes programmes", async () => {
    mockSource({
      sourceType: "xtream",
      url: "https://provider.example/player_api.php?username=u&password=p",
      epgUrl: null,
    });
    replies.push(
      { body: '{"user_info":{"auth":1,"status":"Active"}}' },
      { body: '[{"stream_id":123}]' },
      { body: "[]" },
      {
        body: JSON.stringify({
          epg_listings: [
            {
              start_timestamp: 4070952000,
              stop_timestamp: 4070955600,
              title: Buffer.from("Future").toString("base64"),
            },
          ],
        }),
      },
    );
    const entries = await loadLiveTvEpg("requester", "source-id", "xtream-123");
    expect(entries[0].title).toBe("Future");
    const request = requestSpy.mock.calls[3][0] as URL;
    expect(request.searchParams.get("action")).toBe("get_short_epg");
    expect(request.searchParams.get("stream_id")).toBe("123");
    expect(request.searchParams.get("limit")).toBe("20");
  });

  test("explicit XMLTV overrides Xtream automatic EPG", async () => {
    mockSource({
      sourceType: "xtream",
      url: "https://provider.example/player_api.php?username=u&password=p",
      epgUrl: "https://guide.example/list.xml",
    });
    replies.push(
      { body: '{"user_info":{"auth":1,"status":"Active"}}' },
      { body: '[{"stream_id":123,"epg_channel_id":"news.id"}]' },
      { body: "[]" },
      {
        body: '<tv><programme channel="news.id" start="20990101120000Z" stop="20990101130000Z"><title>Override</title></programme></tv>',
      },
    );
    expect(
      (await loadLiveTvEpg("requester", "source-id", "xtream-123"))[0].title,
    ).toBe("Override");
    expect((requestSpy.mock.calls[3][0] as URL).hostname).toBe("guide.example");
  });

  test("M3U without EPG or tvg-id returns an empty guide", async () => {
    mockSource({
      sourceType: "m3u",
      url: base,
      epgUrl: "https://guide.example/list.xml",
    });
    expect(
      await loadLiveTvEpg("requester", "source-id", parse(playlist)[0].id),
    ).toEqual([]);
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  test("rejects upstream HTTP errors without reading their bodies", async () => {
    replies.push({ status: 403, body: "secret" });
    await expect(
      fetchLiveTvPlaylist("https://93.184.216.34/list"),
    ).rejects.toThrow(
      "El proveedor de la lista de reproducción devolvió una respuesta de error.",
    );
    expect(responses[0].destroyed).toBe(true);
  });
});

describe("batch guide request validation", () => {
  test("normalizes ISO timezones and trims source/channel IDs", () => {
    expect(
      parseLiveTvGuideRequest({
        sourceId: " source ",
        channelIds: [" a ", "b"],
        start: "2026-11-04T14:00:00+02:00",
        end: "2026-11-04T16:00:00+01:00",
      }),
    ).toEqual({
      sourceId: "source",
      channelIds: ["a", "b"],
      start: "2026-11-04T12:00:00.000Z",
      end: "2026-11-04T15:00:00.000Z",
    });
  });
  test("accepts 12 distinct rows and exactly 6 hours", () => {
    const input = {
      ...guideRequest(Array.from({ length: 12 }, (_, i) => `channel-${i}`)),
      end: "2026-11-04T18:00:00Z",
    };
    expect(parseLiveTvGuideRequest(input).channelIds).toHaveLength(12);
  });
  test("rejects duplicate, empty, excessive or invalid channel selections", () => {
    for (const channelIds of [
      [],
      ["a", "a"],
      ["a", " a "],
      [""],
      [" "],
      [null],
      [12],
      ["x".repeat(201)],
      "a",
      Array.from({ length: 13 }, (_, i) => String(i)),
    ]) {
      expect(() =>
        parseLiveTvGuideRequest({ ...guideRequest(["a"]), channelIds }),
      ).toThrow();
    }
    for (const input of [
      null,
      [],
      {},
      { ...guideRequest(["a"]), sourceId: " " },
      { ...guideRequest(["a"]), sourceId: "x".repeat(201) },
    ])
      expect(() => parseLiveTvGuideRequest(input)).toThrow();
  });
  test("rejects ambiguous/invalid ISO calendars, zero/reversed/excessive windows", () => {
    const valid = guideRequest(["a"]);
    for (const input of [
      { ...valid, start: "2026-11-04T12:00:00" },
      { ...valid, start: "2026-02-30T12:00:00Z" },
      { ...valid, start: "2026-11-04T24:00:00Z" },
      { ...valid, start: "2026-11-04T12:00:00+15:00" },
      { ...valid, start: 123 },
      { ...valid, end: valid.start },
      { ...valid, end: "2026-11-04T11:00:00Z" },
      { ...valid, end: "2026-11-04T18:00:00.001Z" },
    ])
      expect(() => parseLiveTvGuideRequest(input)).toThrow();
  });
});

describe("request validation", () => {
  test("bounded JSON and malformed payloads", async () => {
    expect(
      await readLiveTvJson(
        new Request("https://app.example", {
          method: "POST",
          body: '{"id":"source"}',
        }),
      ),
    ).toEqual({ id: "source" });
    for (const body of ["not json", "x".repeat(16 * 1024 + 1)]) {
      await expect(
        readLiveTvJson(
          new Request("https://app.example", { method: "POST", body }),
        ),
      ).rejects.toThrow("Se esperaba un cuerpo JSON de hasta 16 KiB.");
    }
  });
  test("source IDs", () => {
    expect(validateLiveTvSourceId(" source ")).toBe("source");
    for (const value of [null, undefined, "", " ", 12, "x".repeat(201)])
      expect(() => validateLiveTvSourceId(value)).toThrow(
        "Se requiere el identificador de la fuente de Live TV.",
      );
  });
});
