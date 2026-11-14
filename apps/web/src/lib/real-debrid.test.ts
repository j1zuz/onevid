// @ts-expect-error -- Bun provides this runner at runtime; this repo does not install Bun type declarations.
import { afterEach, describe, expect, test } from "bun:test";
import { resolveRealDebridStream } from "./real-debrid";

const HEX = "0123456789abcdef0123456789abcdef01234567";
const BASE32 = "AERUKZ4JVPG66AJDIVTYTK6N54ASGRLH";
const MAGNET = `magnet:?xt=urn:btih:${HEX}&dn=movie`;

const realFetch = globalThis.fetch;

interface Route {
  body: unknown;
  match: (url: string, method: string) => boolean;
  status?: number;
}

/** Reemplaza `fetch` y devuelve la lista de llamadas (método + URL). */
function mockFetch(routes: Route[]): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push(`${method} ${url}`);
    const route = routes.find((item) => item.match(url, method));
    if (!route) {
      return new Response("not found", { status: 404 });
    }
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

const isList = (url: string, method: string) =>
  method === "GET" && url.includes("/torrents?");
const isInfo = (url: string, method: string) =>
  method === "GET" && url.includes("/torrents/info/");
const isAdd = (url: string, method: string) =>
  method === "POST" && url.includes("/torrents/addMagnet");
const isSelect = (url: string, method: string) =>
  method === "POST" && url.includes("/torrents/selectFiles/");
const isUnrestrict = (url: string, method: string) =>
  method === "POST" && url.includes("/unrestrict/link");

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("resolveRealDebridStream", () => {
  test("reutiliza el torrent descargado y desrestrictiona el video", async () => {
    const calls = mockFetch([
      {
        match: isList,
        body: [{ hash: HEX, id: "T1", status: "downloaded" }],
      },
      {
        match: isInfo,
        body: {
          files: [{ bytes: 8_589_934_592, id: 1, path: "/movie.mkv", selected: 1 }],
          hash: HEX,
          id: "T1",
          links: ["https://hoster.example/download/1"],
          progress: 100,
          status: "downloaded",
        },
      },
      {
        match: isUnrestrict,
        body: {
          download: "https://real-debrid.com/d/ABCDEF",
          filename: "movie.mkv",
          filesize: 8_589_934_592,
        },
      },
    ]);

    const result = await resolveRealDebridStream({ apiKey: "token", magnet: MAGNET });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.stream.url).toBe("https://real-debrid.com/d/ABCDEF");
      expect(result.stream.fileName).toBe("movie.mkv");
      expect(result.stream.fileSize).toBe(8_589_934_592);
    }
    expect(calls.some((call) => isAdd(call.split(" ")[1], call.split(" ")[0]))).toBe(false);
    expect(calls.some((call) => isSelect(call.split(" ")[1], call.split(" ")[0]))).toBe(false);
  });

  test("agrega el magnet, selecciona archivos y reporta preparing", async () => {
    const calls = mockFetch([
      { match: isList, body: [] },
      { match: isAdd, body: { id: "T2", uri: "https://api.real-debrid.com/x" } },
      { match: isSelect, body: {}, status: 204 },
      {
        match: isInfo,
        body: {
          files: [],
          hash: HEX,
          id: "T2",
          links: [],
          progress: 0,
          status: "waiting_files_selection",
        },
      },
    ]);

    const result = await resolveRealDebridStream({ apiKey: "token", magnet: MAGNET });

    expect(result.status).toBe("preparing");
    expect(calls.some((call) => call.startsWith("POST ") && isAdd(call, "POST"))).toBe(true);
    expect(calls.some((call) => call.startsWith("POST ") && isSelect(call, "POST"))).toBe(true);
  });

  test("normaliza un magnet en base32 antes de buscar el torrent", async () => {
    const calls = mockFetch([
      {
        match: isList,
        body: [{ hash: HEX, id: "T3", status: "downloading" }],
      },
      {
        match: isInfo,
        body: {
          files: [],
          hash: HEX,
          id: "T3",
          links: [],
          progress: 42,
          status: "downloading",
        },
      },
    ]);

    const result = await resolveRealDebridStream({
      apiKey: "token",
      magnet: `magnet:?xt=urn:btih:${BASE32}&dn=movie`,
    });

    expect(result).toEqual({ progress: 0.42, state: "downloading", status: "preparing" });
    expect(calls.some((call) => call.includes("addMagnet"))).toBe(false);
  });

  test("un status de error no se queda esperando para siempre", async () => {
    mockFetch([
      { match: isList, body: [{ hash: HEX, id: "T4", status: "dead" }] },
      {
        match: isInfo,
        body: {
          files: [],
          hash: HEX,
          id: "T4",
          links: [],
          progress: 0,
          status: "dead",
        },
      },
    ]);

    const result = await resolveRealDebridStream({ apiKey: "token", magnet: MAGNET });
    expect(result.status).toBe("unavailable");
  });
});
