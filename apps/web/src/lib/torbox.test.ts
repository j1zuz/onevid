// @ts-expect-error -- Bun provides this runner at runtime; this repo does not install Bun type declarations.
import { afterEach, describe, expect, test } from "bun:test";
import { normalizeInfoHash, resolveTorboxStream } from "./torbox";

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
  method === "GET" &&
  url.includes("/torrents/mylist") &&
  !url.includes("id=");
const isDetail = (url: string, method: string) =>
  method === "GET" && url.includes("/torrents/mylist") && url.includes("id=");
const isCreate = (url: string, method: string) =>
  method === "POST" && url.includes("/torrents/createtorrent");
const isRequestDl = (url: string, method: string) =>
  method === "GET" && url.includes("/torrents/requestdl");

const READY_FILE = {
  id: 4,
  mimetype: "video/x-matroska",
  name: "movie.mkv",
  size: 8_589_934_592,
};

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("normalizeInfoHash", () => {
  test("deja intacto un info-hash hex en minúsculas", () => {
    expect(normalizeInfoHash(HEX)).toBe(HEX);
  });

  test("pasa a minúsculas un info-hash hex en mayúsculas", () => {
    expect(normalizeInfoHash(HEX.toUpperCase())).toBe(HEX);
  });

  test("convierte base32 (mayúsculas) al hex que publica TorBox", () => {
    // Sin esto, un magnet en base32 no se reconoce como "ya está en la cuenta"
    // y se vuelve a crear el torrent (duplicado → 502).
    expect(normalizeInfoHash(BASE32)).toBe(HEX);
  });

  test("acepta base32 en minúsculas", () => {
    expect(normalizeInfoHash(BASE32.toLowerCase())).toBe(HEX);
  });

  test("ignora espacios alrededor", () => {
    expect(normalizeInfoHash(`  ${HEX}  `)).toBe(HEX);
  });

  test("rechaza lo que no es un info-hash de 20 bytes", () => {
    expect(normalizeInfoHash("")).toBeNull();
    expect(normalizeInfoHash("abc")).toBeNull();
    expect(normalizeInfoHash(HEX.slice(0, 39))).toBeNull();
    expect(normalizeInfoHash(`${HEX}0`)).toBeNull();
    // 32 caracteres con un símbolo fuera del alfabeto base32.
    expect(normalizeInfoHash(`${BASE32.slice(0, 31)}1`)).toBeNull();
  });
});

describe("resolveTorboxStream", () => {
  test("reutiliza el torrent que ya está en la cuenta sin volver a crearlo", async () => {
    const calls = mockFetch([
      {
        match: isList,
        body: {
          success: true,
          data: [
            {
              hash: HEX,
              id: 7,
              download_finished: true,
              download_present: true,
            },
          ],
        },
      },
      {
        match: isDetail,
        body: {
          success: true,
          data: {
            files: [READY_FILE],
            hash: HEX,
            id: 7,
            download_finished: true,
            download_present: true,
          },
        },
      },
      {
        match: isRequestDl,
        body: { success: true, data: "https://cdn.example/movie.mkv" },
      },
    ]);

    const result = await resolveTorboxStream({ apiKey: "k", magnet: MAGNET });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("esperaba ready");
    expect(result.stream.url).toBe("https://cdn.example/movie.mkv");
    expect(result.stream.fileSize).toBe(READY_FILE.size);
    // El bug que se corrige: antes se llamaba siempre a createtorrent, que
    // falla con un duplicado y devolvía 502 aunque el archivo estuviera listo.
    expect(calls.some((call) => call.startsWith("POST"))).toBe(false);
  });

  test("devuelve preparing cuando el debrid todavía está bajando el torrent", async () => {
    mockFetch([
      {
        match: isList,
        body: {
          data: [
            {
              hash: HEX,
              id: 9,
              download_present: false,
              download_state: "downloading",
              progress: 0.42,
            },
          ],
        },
      },
      {
        match: isDetail,
        body: {
          data: {
            files: [],
            hash: HEX,
            id: 9,
            download_present: false,
            download_state: "downloading",
            progress: 0.42,
          },
        },
      },
      { match: isRequestDl, body: { data: null } },
    ]);

    const result = await resolveTorboxStream({ apiKey: "k", magnet: MAGNET });

    expect(result.status).toBe("preparing");
    if (result.status !== "preparing") throw new Error("esperaba preparing");
    expect(result.progress).toBeCloseTo(0.42);
    expect(result.state).toBe("downloading");
  });

  test("crea el torrent cuando no existe y lo resuelve al instante si ya está cacheado", async () => {
    const calls = mockFetch([
      { match: isList, body: { data: [] } },
      { match: isCreate, body: { success: true, data: { torrent_id: 11 } } },
      {
        match: isDetail,
        body: {
          data: {
            files: [READY_FILE],
            id: 11,
            download_finished: true,
            download_present: true,
          },
        },
      },
      {
        match: isRequestDl,
        body: { success: true, data: "https://cdn.example/movie.mkv" },
      },
    ]);

    const result = await resolveTorboxStream({ apiKey: "k", magnet: MAGNET });

    expect(result.status).toBe("ready");
    expect(calls.some((call) => call.includes("/createtorrent"))).toBe(true);
  });

  test("un torrent terminado sin link servible es un fallo, no preparing", async () => {
    mockFetch([
      {
        match: isList,
        body: {
          data: [{ hash: HEX, id: 12, download_finished: true, download_present: true }],
        },
      },
      {
        match: isDetail,
        body: {
          data: {
            files: [READY_FILE],
            id: 12,
            download_finished: true,
            download_present: true,
          },
        },
      },
      { match: isRequestDl, body: { data: null } },
    ]);

    const result = await resolveTorboxStream({ apiKey: "k", magnet: MAGNET });

    expect(result.status).toBe("unavailable");
  });
});
