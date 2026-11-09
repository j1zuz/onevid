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
import { assertPublicHostname } from "../utils/network-policy";
import { LruTtlCache } from "./lru-ttl-cache";
import { checkRateLimit, rateLimitResponse } from "./rate-limit";
import { parseXmltvAll, selectProgrammes } from "./xmltv";
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

/**
 * El catálogo de canales de un Xtream grande (miles de canales) puede tardar
 * bastante más de 10 s desde el servidor de producción, así que esos fetch
 * usan este plazo. Se cachea en memoria un rato para que la fila del feed y
 * la guía no vuelvan a descargarlo entero.
 */
const LIVE_TV_CHANNELS_TIMEOUT_MS = 30_000;
// El catálogo cambia poco: 10 minutos evitan re-descargar y re-parsear miles de
// canales en cada navegación; la acción "actualizar" sigue forzando refresh.
const LIVE_CHANNELS_CACHE_TTL_MS = 10 * 60_000;
// Cada entrada guarda la lista completa de canales de un usuario+fuente (miles
// de objetos), así que el tope es bajo: 25 cubre de sobra los refrescos
// recientes sin dejar crecer el proceso con el número de usuarios.
const LIVE_CHANNELS_CACHE_MAX_ENTRIES = 25;
const liveChannelsCache = new LruTtlCache<string, LiveTvChannel[]>(
  LIVE_CHANNELS_CACHE_MAX_ENTRIES,
);
// Guía XMLTV parseada. Sin esto, cada página/ventana de la guía vuelve a bajar
// y parsear el XMLTV completo (hasta 8 MiB), que es lo que dispara el CPU.
const XMLTV_CACHE_TTL_MS = 5 * 60_000;
const XMLTV_CACHE_MAX_SOURCES = 4;
const xmltvCache = new LruTtlCache<
  string,
  Map<string, LiveTvProgramme[]>
>(XMLTV_CACHE_MAX_SOURCES);
function validateFetchTarget(url: string): void {
  if (!isSafeFetchUrl(url).ok)
    throw new LiveTvError(
      "La URL de la lista de reproducción debe usar un servidor público.",
    );
  try {
    assertPublicHostname(new URL(url).hostname);
  } catch {
    throw new LiveTvError(
      "La URL de la lista de reproducción debe usar un servidor público.",
    );
  }
}

interface PlaylistResponse {
  status: number;
  location?: string;
  text: string;
}

async function requestTextResource(
  url: string,
  signal: AbortSignal,
  max: number,
  accept: string,
): Promise<PlaylistResponse> {
  signal.throwIfAborted();
  const response = await fetch(url, {
    headers: { accept, "accept-encoding": "identity" },
    redirect: "manual",
    signal,
  });

  if (response.status >= 300 && response.status < 400) {
    return {
      status: response.status,
      location: response.headers.get("location") ?? undefined,
      text: "",
    };
  }

  if (response.status < 200 || response.status >= 300) {
    return { status: response.status, text: "" };
  }

  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > max) {
    throw new LiveTvError(
      `La respuesta de Live TV supera el límite de ${max / (1024 * 1024)} MiB.`,
    );
  }

  if (!response.body) {
    throw new LiveTvError("La respuesta no contiene datos.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > max) {
        throw new LiveTvError("El contenido supera el tamaño permitido.");
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }

  return { status: response.status, text: text + decoder.decode() };
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
    timeoutMs?: number;
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
    }, options.timeoutMs ?? FETCH_TIMEOUT_MS);
  });
  const load = async () => {
    let url = initialUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      validateFetchTarget(url);
      controller.signal.throwIfAborted();
      const response = await requestTextResource(
        url,
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
  options: { timeoutMs?: number } = {},
): Promise<LiveTvChannel[]> {
  const response = await fetchLiveTvResource(input, {
    timeoutMs: options.timeoutMs,
  });
  return parseLiveTvPlaylist(response.text, response.url);
}

async function fetchXtreamJson(url: string): Promise<unknown> {
  const response = await fetchLiveTvResource(url, {
    maxBytes: XTREAM_MAX_JSON_BYTES,
    accept: "application/json",
    sameOriginOnly: true,
    timeoutMs: LIVE_TV_CHANNELS_TIMEOUT_MS,
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
      : await fetchLiveTvPlaylist(url, { timeoutMs: LIVE_TV_CHANNELS_TIMEOUT_MS });
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
  options: { refresh?: boolean } = {},
): Promise<LiveTvChannel[]> {
  const [source] = await db
    .select({
      url: oneVidLiveTvSource.url,
      sourceType: oneVidLiveTvSource.sourceType,
    })
    .from(oneVidLiveTvSource)
    .where(
      and(
        eq(oneVidLiveTvSource.id, id),
        eq(oneVidLiveTvSource.userId, userId),
      ),
    )
    .limit(1);
  if (!source) throw new LiveTvError("Fuente no encontrada.", 404);
  return loadCachedChannels(userId, id, source, {
    refresh: options.refresh,
    updateCount: true,
  });
}

/**
 * Catalogo de canales con cache en memoria por usuario+fuente. Lo comparten la
 * fila del feed, el EPG y la guia para no volver a descargar el catalogo
 * completo (miles de canales en Xtream) en cada peticion.
 */
async function loadCachedChannels(
  userId: string,
  sourceId: string,
  source: { url: string; sourceType: string },
  options: { refresh?: boolean; updateCount?: boolean } = {},
): Promise<LiveTvChannel[]> {
  const cacheKey = `${userId}:${sourceId}`;
  if (options.refresh) {
    liveChannelsCache.delete(cacheKey);
  }
  const cached = liveChannelsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const channels =
    source.sourceType === "xtream"
      ? await fetchXtreamChannels(source.url)
      : await fetchLiveTvPlaylist(source.url, {
          timeoutMs: LIVE_TV_CHANNELS_TIMEOUT_MS,
        });

  if (options.updateCount) {
    const updated = await db
      .update(oneVidLiveTvSource)
      .set({ channelCount: channels.length, updatedAt: new Date() })
      .where(
        and(
          eq(oneVidLiveTvSource.id, sourceId),
          eq(oneVidLiveTvSource.userId, userId),
        ),
      )
      .returning({ id: oneVidLiveTvSource.id });
    if (!updated.length) throw new LiveTvError("Fuente no encontrada.", 404);
  }

  liveChannelsCache.set(cacheKey, channels, LIVE_CHANNELS_CACHE_TTL_MS);
  return channels;
}

/** Solo para pruebas: vacia la cache en memoria de catalogos de Live TV. */
export function clearLiveTvChannelCache(): void {
  liveChannelsCache.clear();
  xmltvCache.clear();
}

/**
 * Descarga una sola vez el XMLTV y cachea los programas ya parseados. La guía
 * cambia de página/ventana muchas veces; sin esto se parseaban 8 MiB de XML en
 * cada una.
 */
async function loadParsedXmltv(
  epgUrl: string,
): Promise<Map<string, LiveTvProgramme[]>> {
  const cached = xmltvCache.get(epgUrl);
  if (cached) {
    return cached;
  }
  const resource = await fetchLiveTvResource(epgUrl, {
    maxBytes: LIVE_TV_MAX_XMLTV_BYTES,
    accept: "application/xml, text/xml",
  });
  const programmes = parseXmltvAll(resource.text);
  xmltvCache.set(epgUrl, programmes, XMLTV_CACHE_TTL_MS);
  return programmes;
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
  const channels = await loadCachedChannels(userId, sourceId, source);
  const channel = channels.find((entry) => entry.id === channelId);
  if (!channel) throw new LiveTvError("Canal de Live TV no encontrado.", 404);
  if (source.epgUrl) {
    if (!channel.tvgId) return [];
    const programmes = await loadParsedXmltv(source.epgUrl);
    return selectProgrammes(programmes.get(channel.tvgId) ?? [], Date.now());
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
  const catalog = await loadCachedChannels(userId, request.sourceId, source);
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
      const programmes = await loadParsedXmltv(source.epgUrl);
      response.channels.forEach((row, index) => {
        const tvgId = requested[index].tvgId;
        row.programmes = tvgId
          ? selectProgrammes(programmes.get(tvgId) ?? [], now, window)
          : [];
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
  options: { limit: number; scope: string; windowMs?: number },
): Promise<Response> {
  const responseHeaders = { "Cache-Control": "private, no-store" };
  try {
    const { auth } = await import("./auth");
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) throw new LiveTvError("No autorizado.", 401);

    const limited = checkRateLimit(
      `${options.scope}:${session.user.id}`,
      options.limit,
      options.windowMs ?? 60_000,
    );
    if (!limited.ok) return rateLimitResponse(limited.retryAfter);

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
