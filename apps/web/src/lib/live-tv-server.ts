import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import type { IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIP, type TcpSocketConnectOpts } from "node:net";
import { and, asc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { oneVidLiveTvSource, user } from "./auth-schema";
import { db } from "./db";
import {
  LiveTvError,
  LIVE_TV_MAX_PLAYLIST_BYTES,
  LIVE_TV_MAX_SOURCES,
  LIVE_TV_MAX_XMLTV_BYTES,
  normalizeLiveTvUrl,
  parseLiveTvPlaylist,
  parseLiveTvGuideRequest,
  type LiveTvGuideResponse,
  type LiveTvChannel,
  type LiveTvSourceSummary,
  type LiveTvProgramme,
} from "./live-tv";
import { isSafeFetchUrl, SAFE_FETCH_MAX_BODY_BYTES } from "../utils/ssrf-guard";
import { parseXmltv, parseXmltvChannels } from "./xmltv";
import {
  buildXtreamEndpoint,
  validateXtreamAuth,
  xtreamActionUrl,
  parseXtreamChannels,
  parseXtreamEpg,
  XTREAM_MAX_JSON_BYTES,
} from "./xtream";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 32, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");

function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  return (
    family === 6 &&
    globalV6.check(address, "ipv6") &&
    !blocked.check(address, "ipv6")
  );
}

async function validateFetchTarget(url: string): Promise<LookupAddress[]> {
  if (!isSafeFetchUrl(url).ok)
    throw new LiveTvError(
      "La URL de la lista de reproducción debe usar un servidor público.",
    );
  const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => !publicAddress(address))
  ) {
    throw new LiveTvError(
      "La URL de la lista de reproducción debe usar un servidor público.",
    );
  }
  return addresses;
}

interface PlaylistResponse {
  status: number;
  location?: string;
  text: string;
}

/** A fresh direct TLS connection can only resolve to this already-validated IP. */
function requestPinnedPlaylist(
  url: string,
  pinned: LookupAddress,
  signal: AbortSignal,
  max: number,
  accept: string,
): Promise<PlaylistResponse> {
  signal.throwIfAborted();
  const target = new URL(url);
  const hostname = target.hostname.replace(/^\[|\]$/g, "");

  return new Promise((resolve, reject) => {
    let response: IncomingMessage | undefined;
    let settled = false;
    const finish = (error: unknown, result?: PlaylistResponse) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      response?.destroy();
      request.destroy();
      if (error) {
        reject(error);
        return;
      }
      if (result === undefined) {
        reject(new Error("Live TV response was empty."));
        return;
      }
      resolve(result);
    };
    const abort = () => finish(signal.reason ?? new Error("Aborted"));
    const options: https.RequestOptions &
      Pick<TcpSocketConnectOpts, "autoSelectFamily"> = {
      method: "GET",
      agent: false,
      family: pinned.family,
      autoSelectFamily: false,
      // Keep the original hostname for Host, SNI and certificate verification.
      // Neither the TLS connector nor a shared agent can resolve it again.
      servername: isIP(hostname) ? undefined : hostname,
      rejectUnauthorized: true,
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [pinned]);
        else callback(null, pinned.address, pinned.family);
      },
      maxHeaderSize: 16 * 1024,
      headers: {
        accept,
        "accept-encoding": "identity",
      },
    };
    const request = https.request(target, options, (incoming) => {
      if (settled) {
        incoming.destroy();
        return;
      }
      response = incoming;
      incoming.once("error", (error) => finish(error));
      incoming.once("aborted", () => finish(new Error("Incomplete response")));
      const status = incoming.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        finish(null, {
          status,
          location: incoming.headers.location,
          text: "",
        });
        return;
      }
      const declaredLength = incoming.headers["content-length"];
      if (declaredLength && Number(declaredLength) > max) {
        finish(
          new LiveTvError(
            `La respuesta de Live TV supera el límite de ${max / (1024 * 1024)} MiB.`,
          ),
        );
        return;
      }
      const encoding = incoming.headers["content-encoding"];
      if (encoding && encoding.trim().toLowerCase() !== "identity") {
        finish(
          new LiveTvError("No se admiten listas de reproducción comprimidas."),
        );
        return;
      }
      let bytes = 0;
      let text = "";
      const decoder = new TextDecoder();
      incoming.on("data", (chunk: Buffer) => {
        if (settled) return;
        bytes += chunk.byteLength;
        if (bytes > max) {
          finish(new LiveTvError("El contenido supera el tamaño permitido."));
          return;
        }
        text += decoder.decode(chunk, { stream: true });
      });
      incoming.once("end", () =>
        finish(null, {
          status,
          text: text + decoder.decode(),
        }),
      );
    });
    request.once("error", (error) => finish(error));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else request.end();
  });
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  max: number,
  signal?: AbortSignal,
): Promise<string> {
  if (!body) throw new LiveTvError("La respuesta no contiene datos.");
  signal?.throwIfAborted();
  const reader = body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > max)
        throw new LiveTvError("El contenido supera el tamaño permitido.");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    signal?.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

/** Validate DNS once per hop and pin HTTPS to a validated address, never re-resolve. */
export async function fetchLiveTvResource(
  input: string,
  options: {
    maxBytes?: number;
    accept?: string;
    sameOriginOnly?: boolean;
  } = {},
): Promise<{ text: string; url: string }> {
  const initialUrl = normalizeLiveTvUrl(input);
  const initial = new URL(initialUrl);
  const sameOriginOnly =
    options.sameOriginOnly ||
    initial.searchParams.has("username") ||
    initial.searchParams.has("password");
  const max = Math.min(
    options.maxBytes ??
      Math.min(LIVE_TV_MAX_PLAYLIST_BYTES, SAFE_FETCH_MAX_BODY_BYTES),
    LIVE_TV_MAX_XMLTV_BYTES,
  );
  const controller = new AbortController();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new LiveTvError(
        "Se agotó el tiempo de espera al solicitar la lista de reproducción.",
      );
      reject(error);
      controller.abort(error);
    }, FETCH_TIMEOUT_MS);
  });
  const load = async () => {
    let url = initialUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const addresses = await validateFetchTarget(url);
      controller.signal.throwIfAborted();
      const response = await requestPinnedPlaylist(
        url,
        addresses[0],
        controller.signal,
        max,
        options.accept ?? "application/x-mpegURL, audio/x-mpegurl, text/plain",
      );
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.location;
        if (!location || hop === MAX_REDIRECTS)
          throw new LiveTvError(
            "Las redirecciones de la lista de reproducción no son válidas o superan el límite permitido.",
          );
        url = normalizeLiveTvUrl(location, url);
        if (sameOriginOnly && new URL(url).origin !== initial.origin)
          throw new LiveTvError(
            "No se permiten redirecciones de credenciales de Live TV a otro servidor.",
          );
        continue;
      }
      if (response.status < 200 || response.status >= 300)
        throw new LiveTvError(
          "El proveedor de la lista de reproducción devolvió una respuesta de error.",
        );
      controller.signal.throwIfAborted();
      return { text: response.text, url };
    }
    throw new LiveTvError(
      "La redirección de la lista de reproducción no es válida.",
    );
  };
  try {
    return await Promise.race([load(), deadline]);
  } catch (error) {
    if (error instanceof LiveTvError) throw error;
    // Fetch/DNS exceptions can contain provider URLs and credentials. Never expose or log them.
    throw new LiveTvError(
      "No se pudo cargar la lista de reproducción desde un servidor HTTPS público.",
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export async function fetchLiveTvPlaylist(
  input: string,
): Promise<LiveTvChannel[]> {
  const response = await fetchLiveTvResource(input);
  return parseLiveTvPlaylist(response.text, response.url);
}

async function fetchXtreamJson(url: string): Promise<unknown> {
  const response = await fetchLiveTvResource(url, {
    maxBytes: XTREAM_MAX_JSON_BYTES,
    accept: "application/json",
    sameOriginOnly: true,
  });
  try {
    return JSON.parse(response.text);
  } catch {
    throw new LiveTvError(
      "La respuesta del proveedor de Live TV no es JSON válido.",
    );
  }
}

export async function fetchXtreamChannels(
  endpoint: string,
): Promise<LiveTvChannel[]> {
  validateXtreamAuth(await fetchXtreamJson(endpoint));
  const [streams, categories] = await Promise.all([
    fetchXtreamJson(xtreamActionUrl(endpoint, "get_live_streams")),
    fetchXtreamJson(xtreamActionUrl(endpoint, "get_live_categories")),
  ]);
  return parseXtreamChannels(endpoint, streams, categories);
}

const summaryFields = {
  id: oneVidLiveTvSource.id,
  name: oneVidLiveTvSource.name,
  channelCount: oneVidLiveTvSource.channelCount,
  sourceType: oneVidLiveTvSource.sourceType,
  epgUrl: oneVidLiveTvSource.epgUrl,
};

export function summarizeLiveTvSource(source: {
  id: string;
  name: string;
  channelCount: number;
  sourceType: string;
  epgUrl: string | null;
}): LiveTvSourceSummary {
  const type = source.sourceType === "xtream" ? "xtream" : "m3u";
  return {
    id: source.id,
    name: source.name === "Lista IPTV" ? "Live TV" : source.name,
    channelCount: source.channelCount,
    type,
    hasEpg: Boolean(source.epgUrl) || type === "xtream",
  };
}

export async function listLiveTvSources(
  userId: string,
): Promise<LiveTvSourceSummary[]> {
  const sources = await db
    .select(summaryFields)
    .from(oneVidLiveTvSource)
    .where(eq(oneVidLiveTvSource.userId, userId))
    .orderBy(asc(oneVidLiveTvSource.createdAt), asc(oneVidLiveTvSource.id));
  return sources.map(summarizeLiveTvSource);
}

export async function createLiveTvSource(
  userId: string,
  input: unknown,
): Promise<LiveTvSourceSummary> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new LiveTvError("Se esperaba un objeto JSON.");
  const payload = input as Record<string, unknown>;
  const { name: rawName } = payload;
  const sourceType = payload.type ?? "m3u";
  if (sourceType !== "m3u" && sourceType !== "xtream")
    throw new LiveTvError("El tipo de fuente de Live TV no es válido.");
  const rawUrl = sourceType === "xtream" ? payload.serverUrl : payload.url;
  if (
    typeof rawUrl !== "string" ||
    (rawName !== undefined &&
      (typeof rawName !== "string" ||
        !rawName.trim() ||
        rawName.trim().length > 120))
  ) {
    throw new LiveTvError(
      "Se requiere una URL HTTPS y, opcionalmente, un nombre no vacío de hasta 120 caracteres.",
    );
  }
  const url =
    sourceType === "xtream"
      ? buildXtreamEndpoint(rawUrl, payload.username, payload.password)
      : normalizeLiveTvUrl(rawUrl);
  let epgUrl: string | null = null;
  if (payload.epgUrl !== undefined) {
    if (typeof payload.epgUrl !== "string")
      throw new LiveTvError("La URL de la guía de Live TV no es válida.");
    epgUrl = normalizeLiveTvUrl(payload.epgUrl);
    if (epgUrl.length > 2048)
      throw new LiveTvError(
        "La URL de la guía de Live TV supera los 2048 caracteres.",
      );
  }
  if (new TextEncoder().encode(url).byteLength > 2048)
    throw new LiveTvError("La URL de la fuente supera los 2048 bytes.");
  const existing = await db
    .select({ id: oneVidLiveTvSource.id, url: oneVidLiveTvSource.url })
    .from(oneVidLiveTvSource)
    .where(eq(oneVidLiveTvSource.userId, userId));
  if (existing.some((source) => source.url === url))
    throw new LiveTvError("Esta fuente de lista de reproducción ya existe.");
  if (existing.length >= LIVE_TV_MAX_SOURCES)
    throw new LiveTvError("Se alcanzó el límite de fuentes (10).");
  const channels =
    sourceType === "xtream"
      ? await fetchXtreamChannels(url)
      : await fetchLiveTvPlaylist(url);
  // Lock the account row so concurrent inserts cannot exceed the per-user limit.
  // Network I/O stays outside the transaction; recheck after acquiring the lock.
  return db.transaction(async (tx) => {
    const account = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for("update");
    if (!account.length) throw new LiveTvError("No autorizado.", 401);
    const sources = await tx
      .select({ url: oneVidLiveTvSource.url })
      .from(oneVidLiveTvSource)
      .where(eq(oneVidLiveTvSource.userId, userId));
    if (sources.some((source) => source.url === url))
      throw new LiveTvError("Esta fuente de lista de reproducción ya existe.");
    if (sources.length >= LIVE_TV_MAX_SOURCES)
      throw new LiveTvError("Se alcanzó el límite de fuentes (10).");
    const [source] = await tx
      .insert(oneVidLiveTvSource)
      .values({
        id: crypto.randomUUID(),
        userId,
        url,
        name: typeof rawName === "string" ? rawName.trim() : "Live TV",
        sourceType,
        epgUrl,
        channelCount: channels.length,
      })
      .returning(summaryFields);
    return summarizeLiveTvSource(source);
  });
}

export function validateLiveTvSourceId(input: unknown): string {
  if (typeof input !== "string" || !input.trim() || input.length > 200)
    throw new LiveTvError(
      "Se requiere el identificador de la fuente de Live TV.",
    );
  return input.trim();
}

export async function updateLiveTvSourceEpg(
  userId: string,
  input: unknown,
): Promise<LiveTvSourceSummary> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new LiveTvError(
      "Se esperaba un objeto JSON para configurar la guía de Live TV.",
    );
  }
  const payload = input as Record<string, unknown>;
  const id = validateLiveTvSourceId(payload.id);
  if (payload.epgUrl !== null && typeof payload.epgUrl !== "string") {
    throw new LiveTvError(
      "Se requiere una URL HTTPS de guía de Live TV o null.",
    );
  }
  const owned = and(
    eq(oneVidLiveTvSource.id, id),
    eq(oneVidLiveTvSource.userId, userId),
  );
  const [existing] = await db
    .select({ id: oneVidLiveTvSource.id })
    .from(oneVidLiveTvSource)
    .where(owned)
    .limit(1);
  if (!existing) throw new LiveTvError("Fuente de Live TV no encontrada.", 404);

  let epgUrl: string | null = null;
  if (payload.epgUrl !== null) {
    try {
      epgUrl = normalizeLiveTvUrl(payload.epgUrl as string);
    } catch {
      throw new LiveTvError(
        "La URL de la guía de Live TV debe ser HTTPS y no contener credenciales.",
      );
    }
    if (epgUrl.length > 2048) {
      throw new LiveTvError(
        "La URL de la guía de Live TV supera los 2048 caracteres.",
      );
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        validateFetchTarget(epgUrl),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("DNS validation timed out")),
            FETCH_TIMEOUT_MS,
          );
        }),
      ]);
    } catch {
      // DNS exceptions may include the secret provider hostname. Do not expose them.
      throw new LiveTvError(
        "No se pudo validar la URL de la guía de Live TV; debe usar un servidor público accesible.",
      );
    } finally {
      clearTimeout(timer);
    }
  }
  // Recheck ownership in the write, including deletion while DNS was resolving.
  const [source] = await db
    .update(oneVidLiveTvSource)
    .set({ epgUrl, updatedAt: new Date() })
    .where(owned)
    .returning(summaryFields);
  if (!source) throw new LiveTvError("Fuente de Live TV no encontrada.", 404);
  return summarizeLiveTvSource(source);
}

export async function deleteLiveTvSource(
  userId: string,
  id: string,
): Promise<{ ok: true }> {
  const deleted = await db
    .delete(oneVidLiveTvSource)
    .where(
      and(eq(oneVidLiveTvSource.id, id), eq(oneVidLiveTvSource.userId, userId)),
    )
    .returning({ id: oneVidLiveTvSource.id });
  if (!deleted.length) throw new LiveTvError("Fuente no encontrada.", 404);
  return { ok: true };
}

export async function loadLiveTvChannels(
  userId: string,
  id: string,
): Promise<LiveTvChannel[]> {
  const owned = and(
    eq(oneVidLiveTvSource.id, id),
    eq(oneVidLiveTvSource.userId, userId),
  );
  const [source] = await db
    .select({
      url: oneVidLiveTvSource.url,
      sourceType: oneVidLiveTvSource.sourceType,
    })
    .from(oneVidLiveTvSource)
    .where(owned)
    .limit(1);
  if (!source) throw new LiveTvError("Fuente no encontrada.", 404);
  const channels =
    source.sourceType === "xtream"
      ? await fetchXtreamChannels(source.url)
      : await fetchLiveTvPlaylist(source.url);
  const updated = await db
    .update(oneVidLiveTvSource)
    .set({ channelCount: channels.length, updatedAt: new Date() })
    .where(owned)
    .returning({ id: oneVidLiveTvSource.id });
  if (!updated.length) throw new LiveTvError("Fuente no encontrada.", 404);
  return channels;
}

export async function loadLiveTvEpg(
  userId: string,
  sourceId: string,
  channelId: string,
): Promise<LiveTvProgramme[]> {
  const [source] = await db
    .select({
      url: oneVidLiveTvSource.url,
      sourceType: oneVidLiveTvSource.sourceType,
      epgUrl: oneVidLiveTvSource.epgUrl,
    })
    .from(oneVidLiveTvSource)
    .where(
      and(
        eq(oneVidLiveTvSource.id, sourceId),
        eq(oneVidLiveTvSource.userId, userId),
      ),
    )
    .limit(1);
  if (!source) throw new LiveTvError("Fuente de Live TV no encontrada.", 404);
  const channels =
    source.sourceType === "xtream"
      ? await fetchXtreamChannels(source.url)
      : await fetchLiveTvPlaylist(source.url);
  const channel = channels.find((entry) => entry.id === channelId);
  if (!channel) throw new LiveTvError("Canal de Live TV no encontrado.", 404);
  if (source.epgUrl) {
    if (!channel.tvgId) return [];
    const resource = await fetchLiveTvResource(source.epgUrl, {
      maxBytes: LIVE_TV_MAX_XMLTV_BYTES,
      accept: "application/xml, text/xml",
    });
    return parseXmltv(resource.text, channel.tvgId);
  }
  if (source.sourceType === "xtream") {
    const streamId = channel.id.slice("xtream-".length);
    return parseXtreamEpg(
      await fetchXtreamJson(
        xtreamActionUrl(source.url, "get_short_epg", streamId),
      ),
      streamId,
    );
  }
  return [];
}

export async function loadLiveTvGuide(
  userId: string,
  input: unknown,
): Promise<LiveTvGuideResponse> {
  const request = parseLiveTvGuideRequest(input);
  const window = {
    start: Date.parse(request.start),
    end: Date.parse(request.end),
  };
  const now = Date.now();
  const [source] = await db
    .select({
      url: oneVidLiveTvSource.url,
      sourceType: oneVidLiveTvSource.sourceType,
      epgUrl: oneVidLiveTvSource.epgUrl,
    })
    .from(oneVidLiveTvSource)
    .where(
      and(
        eq(oneVidLiveTvSource.id, request.sourceId),
        eq(oneVidLiveTvSource.userId, userId),
      ),
    )
    .limit(1);
  if (!source) throw new LiveTvError("Fuente de Live TV no encontrada.", 404);

  // Authentication and catalog/category loading happen once for the entire page.
  const catalog =
    source.sourceType === "xtream"
      ? await fetchXtreamChannels(source.url)
      : await fetchLiveTvPlaylist(source.url);
  const byId = new Map(catalog.map((channel) => [channel.id, channel]));
  if (request.channelIds.some((id) => !byId.has(id)))
    throw new LiveTvError("Canal de Live TV no encontrado.", 404);
  const requested = request.channelIds.map((id) => {
    const channel = byId.get(id);
    if (!channel) {
      throw new LiveTvError("Canal de Live TV no encontrado.", 404);
    }
    return channel;
  });
  const response: LiveTvGuideResponse = {
    channels: request.channelIds.map((channelId) => ({
      channelId,
      programmes: [],
    })),
  };

  if (source.epgUrl) {
    const tvgIds = [
      ...new Set(
        requested.flatMap((channel) => (channel.tvgId ? [channel.tvgId] : [])),
      ),
    ];
    if (!tvgIds.length) return response;
    try {
      const resource = await fetchLiveTvResource(source.epgUrl, {
        maxBytes: LIVE_TV_MAX_XMLTV_BYTES,
        accept: "application/xml, text/xml",
      });
      const programmes = parseXmltvChannels(resource.text, tvgIds, now, window);
      response.channels.forEach((row, index) => {
        const tvgId = requested[index].tvgId;
        row.programmes = tvgId ? (programmes.get(tvgId) ?? []) : [];
      });
    } catch {
      // Shared guide failures affect mapped rows only; never expose provider errors/URLs.
      response.channels.forEach((row, index) => {
        if (requested[index].tvgId) row.error = true;
      });
    }
    return response;
  }
  if (source.sourceType !== "xtream") return response;

  let next = 0;
  const worker = async () => {
    while (next < requested.length) {
      const index = next++;
      const streamId = requested[index].id.slice("xtream-".length);
      try {
        const payload = await fetchXtreamJson(
          xtreamActionUrl(source.url, "get_short_epg", streamId),
        );
        response.channels[index].programmes = parseXtreamEpg(
          payload,
          streamId,
          now,
          window,
        );
      } catch {
        response.channels[index].error = true;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(3, requested.length) }, worker),
  );
  return response;
}

export async function readLiveTvJson(request: Request): Promise<unknown> {
  try {
    return JSON.parse(await readBoundedBody(request.body, 16 * 1024));
  } catch {
    throw new LiveTvError("Se esperaba un cuerpo JSON de hasta 16 KiB.");
  }
}

export async function liveTvApi(
  action: (userId: string) => Promise<unknown>,
): Promise<Response> {
  const responseHeaders = { "Cache-Control": "private, no-store" };
  try {
    const { auth } = await import("./auth");
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) throw new LiveTvError("No autorizado.", 401);
    return Response.json(await action(session.user.id), {
      headers: responseHeaders,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof LiveTvError
            ? error.message
            : "No se pudo procesar la solicitud Live TV.",
      },
      {
        status: error instanceof LiveTvError ? error.status : 500,
        headers: responseHeaders,
      },
    );
  }
}
