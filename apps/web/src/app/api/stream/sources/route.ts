import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { oneVid, oneVidAddon } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import {
  normalizeQualityPref,
  parseQualityTier,
  type QualityPref,
  sortSourcesByQuality,
} from "@/lib/stream-quality";
import { findImdbId } from "@/lib/tmdb";
import type {
  AggregatedStreamResponse,
  StreamSource,
  StreamType,
  StreamWithAddon,
} from "@/types/stream";
import { safeFetch } from "@/utils/ssrf-guard";

// Allow up to 60s: each addon fetch can take up to ~10s (safeFetch timeout) and
// they run after an awaited IMDb resolve. The default 10s serverless limit was
// killing the function with a 504 before addons could respond.
export const maxDuration = 60;

// El ID compuesto de un episodio es `<mediaId>:<temporada>:<episodio>`, donde
// `mediaId` puede ser el TMDB numérico (p. ej. `1399:1:5`) o el IMDb de la serie
// (p. ej. `tt0944947:1:5`, el caso habitual cuando TMDB expone el IMDb id).
// Aceptamos ambos: si solo permitimos numérico, las series con IMDb id caían a
// 400 y los medios no cargaban.
const COMPOUND_ID_RE = /^(tt\d+|\d+):(\d+):(\d+)$/;
const NUMERIC_ID_RE = /^\d+$/;
const MAGNET_HASH_RE = /xt=urn:btih:([A-Za-z0-9]+)/i;

interface RequestBody {
  id?: unknown;
  type?: unknown;
}

interface OneVlpStreamResponse {
  sources?: Array<{
    id?: unknown;
    title?: unknown;
    url?: unknown;
    metadata?: unknown;
  }>;
}

interface StremioStreamResponse {
  streams?: Array<{
    name?: unknown;
    title?: unknown;
    url?: unknown;
  }>;
}

interface ParsedStreamRef {
  episode?: number;
  season?: number;
  tmdbId: string;
}

interface UserContext {
  qualityPref: QualityPref[];
  tmdbToken: string | null;
  torboxKey: string | null;
}

function parseStreamId(
  rawId: string,
  type: StreamType
): ParsedStreamRef | null {
  const match = rawId.match(COMPOUND_ID_RE);
  if (match) {
    return {
      tmdbId: match[1],
      season: Number.parseInt(match[2], 10),
      episode: Number.parseInt(match[3], 10),
    };
  }

  if (NUMERIC_ID_RE.test(rawId)) {
    return { tmdbId: rawId };
  }

  if (rawId.startsWith("tt") && type === "movie") {
    return { tmdbId: rawId };
  }

  return null;
}

function buildStreamsUrl(
  baseUrl: string,
  type: StreamType,
  ref: ParsedStreamRef,
  imdbId?: string
): string {
  const params = new URLSearchParams({
    tmdbID: ref.tmdbId,
    type,
  });
  if (imdbId) {
    params.set("imdbID", imdbId);
  }
  if (ref.season !== undefined && !Number.isNaN(ref.season)) {
    params.set("season", String(ref.season));
  }
  if (ref.episode !== undefined && !Number.isNaN(ref.episode)) {
    params.set("episode", String(ref.episode));
  }
  return `${baseUrl}/streams?${params.toString()}`;
}

// Convención Stremio: `/stream/:type/:id.json`, donde `id` es el IMDb id, o
// `<imdbId>:<temporada>:<episodio>` para un episodio de serie. A diferencia de
// OneVLP, el id va en la URL y no admite el TMDB numérico, así que este
// protocolo requiere haber resuelto el IMDb id primero.
function buildStremioStreamUrl(
  baseUrl: string,
  type: StreamType,
  imdbId: string,
  ref: ParsedStreamRef
): string {
  const streamId =
    ref.season !== undefined && ref.episode !== undefined
      ? `${imdbId}:${ref.season}:${ref.episode}`
      : imdbId;
  return `${baseUrl}/stream/${type}/${streamId}.json`;
}

function rewriteMagnetUrl(url: string, hasTorboxKey: boolean): string {
  if (!(hasTorboxKey && url.startsWith("magnet:"))) {
    return url;
  }
  const hashMatch = url.match(MAGNET_HASH_RE);
  const hash = hashMatch ? hashMatch[1] : "";
  return `/api/torbox/resolve?hash=${encodeURIComponent(hash)}&magnet=${encodeURIComponent(url)}`;
}

async function fetchAddonStreams(
  baseUrl: string,
  type: StreamType,
  ref: ParsedStreamRef,
  imdbId: string | undefined,
  hasTorboxKey: boolean
): Promise<{ success: boolean; streams: StreamSource[]; error?: string }> {
  try {
    const res = await safeFetch(buildStreamsUrl(baseUrl, type, ref, imdbId), {
      method: "GET",
      headers: { accept: "application/json" },
    });

    if (!res.ok) {
      return { success: false, streams: [], error: `HTTP ${res.status}` };
    }

    const data = (await res.json()) as OneVlpStreamResponse;
    const rawSources = Array.isArray(data.sources) ? data.sources : [];

    const streams: StreamSource[] = [];
    for (const item of rawSources) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const rawUrl = typeof item.url === "string" ? item.url.trim() : "";
      if (!rawUrl) {
        continue;
      }
      const finalUrl = rewriteMagnetUrl(rawUrl, hasTorboxKey);
      const title = typeof item.title === "string" ? item.title : "";
      const metadata = Array.isArray(item.metadata)
        ? item.metadata.filter((m): m is string => typeof m === "string")
        : [];

      streams.push({
        title,
        url: finalUrl,
        behaviors: metadata,
      });
    }

    return { success: true, streams };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error || "Unknown error");
    return { success: false, streams: [], error: message };
  }
}

// Contraparte de `fetchAddonStreams` (OneVLP) para addons Stremio estándar,
// los que declaran `resources: ["stream"]` en vez de
// `supported_endpoints.streams` (ver onevid-addons/route.ts). Muchos addons
// de terceros (p. ej. los que agregan catálogos en español latino) solo
// implementan este protocolo: sin este fetch, su catálogo se ve pero sus
// streams siempre fallan con 404 contra `/streams`.
async function fetchAddonStremioStreams(
  baseUrl: string,
  type: StreamType,
  ref: ParsedStreamRef,
  imdbId: string | undefined,
  hasTorboxKey: boolean
): Promise<{ success: boolean; streams: StreamSource[]; error?: string }> {
  if (!imdbId) {
    return {
      success: false,
      streams: [],
      error: "No se pudo resolver el IMDb ID de este título",
    };
  }

  try {
    const res = await safeFetch(
      buildStremioStreamUrl(baseUrl, type, imdbId, ref),
      { method: "GET", headers: { accept: "application/json" } }
    );

    if (!res.ok) {
      return { success: false, streams: [], error: `HTTP ${res.status}` };
    }

    const data = (await res.json()) as StremioStreamResponse;
    const rawStreams = Array.isArray(data.streams) ? data.streams : [];

    const streams: StreamSource[] = [];
    for (const item of rawStreams) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const rawUrl = typeof item.url === "string" ? item.url.trim() : "";
      if (!rawUrl) {
        continue;
      }
      const finalUrl = rewriteMagnetUrl(rawUrl, hasTorboxKey);
      const name = typeof item.name === "string" ? item.name : "";
      const title = typeof item.title === "string" ? item.title : name;

      streams.push({ title, url: finalUrl, name: name || undefined });
    }

    return { success: true, streams };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error || "Unknown error");
    return { success: false, streams: [], error: message };
  }
}

async function loadUserContext(userId: string): Promise<UserContext> {
  const [row] = await db
    .select({
      tmdbUserAccessToken: oneVid.tmdbUserAccessToken,
      tmdbReadAccessToken: oneVid.tmdbReadAccessToken,
      torboxApiKey: oneVid.torboxApiKey,
      streamQualityOrder: oneVid.streamQualityOrder,
    })
    .from(oneVid)
    .where(eq(oneVid.userId, userId))
    .limit(1);
  return {
    // v4 user token preferred, legacy read token as fallback
    tmdbToken: row?.tmdbUserAccessToken ?? row?.tmdbReadAccessToken ?? null,
    torboxKey: row?.torboxApiKey ?? null,
    qualityPref: normalizeQualityPref(row?.streamQualityOrder),
  };
}

async function resolveImdbId(
  ctx: UserContext,
  ref: ParsedStreamRef,
  type: StreamType
): Promise<string | undefined> {
  if (ref.tmdbId.startsWith("tt")) {
    return ref.tmdbId;
  }
  if (!(ctx.tmdbToken && NUMERIC_ID_RE.test(ref.tmdbId))) {
    return;
  }
  return await findImdbId(ctx.tmdbToken, ref.tmdbId, type).catch(
    () => undefined
  );
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });

    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: RequestBody = {};
    try {
      body = (await request.json()) as RequestBody;
    } catch {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

    const id = typeof body.id === "string" ? body.id.trim() : "";
    const type = body.type === "series" ? "series" : "movie";

    if (!id) {
      return Response.json(
        { error: "Missing or invalid id parameter" },
        { status: 400 }
      );
    }

    const ref = parseStreamId(id, type);
    if (!ref) {
      return Response.json({ error: "Unsupported id format" }, { status: 400 });
    }

    const [addons, ctx] = await Promise.all([
      db
        .select({
          id: oneVidAddon.id,
          manifestName: oneVidAddon.manifestName,
          baseUrl: oneVidAddon.baseUrl,
          supportsStremioStreams: oneVidAddon.supportsStremioStreams,
        })
        .from(oneVidAddon)
        .where(eq(oneVidAddon.userId, session.user.id)),
      loadUserContext(session.user.id),
    ]);

    // Resolve IMDb once and pass to addons (better matching on Stremio-style).
    const imdbId = await resolveImdbId(ctx, ref, type);

    const addonResults = await Promise.allSettled(
      addons.map(async (addon) => {
        const hasTorboxKey = Boolean(ctx.torboxKey);
        const attempts = [
          fetchAddonStreams(addon.baseUrl, type, ref, imdbId, hasTorboxKey),
        ];
        if (addon.supportsStremioStreams) {
          attempts.push(
            fetchAddonStremioStreams(
              addon.baseUrl,
              type,
              ref,
              imdbId,
              hasTorboxKey
            )
          );
        }

        const results = await Promise.all(attempts);
        // Basta con que un protocolo responda bien: un addon puede fallar en
        // uno (p. ej. Stremio 404 si no expone ese recurso) y traer streams
        // en el otro. Solo se reporta error si TODOS los intentos fallaron;
        // "success con 0 streams" (el addon respondió pero no tiene este
        // título) no cuenta como error.
        const anySuccess = results.some((r) => r.success);
        if (anySuccess) {
          return {
            addonId: addon.id,
            addonName: addon.manifestName,
            success: true,
            streams: results.flatMap((r) => r.streams),
          };
        }

        const error =
          results.map((r) => r.error).find(Boolean) ?? "Unknown error";
        return {
          addonId: addon.id,
          addonName: addon.manifestName,
          success: false,
          streams: [],
          error,
        };
      })
    );

    const sources: StreamWithAddon[] = [];
    const addonErrors: Array<{
      addonId: string;
      addonName: string;
      error: string;
    }> = [];

    for (const result of addonResults) {
      if (result.status === "rejected") {
        addonErrors.push({
          addonId: "unknown",
          addonName: "unknown",
          error: "Promise rejected",
        });
        continue;
      }

      const { addonId, addonName, success, streams, error } = result.value;

      if (!success || error) {
        addonErrors.push({
          addonId,
          addonName,
          error: error || "Unknown error",
        });
        continue;
      }

      for (let i = 0; i < streams.length; i++) {
        sources.push({
          ...streams[i],
          quality: parseQualityTier(streams[i]),
          addonName,
          addonId,
          sourceIndex: i,
        });
      }
    }

    return Response.json({
      // El orden lo pone el servidor y no cada cliente: la web y la app leen
      // este mismo endpoint, y `sources[0]` es la fuente que abre el
      // reproductor sin preguntar. Ordenar aquí deja las dos superficies
      // coherentes con lo que el usuario eligió en Configuración.
      sources: sortSourcesByQuality(sources, ctx.qualityPref),
      totalAddonsTried: addons.length,
      addonErrors,
    } as AggregatedStreamResponse);
  } catch (error) {
    console.error("Stream aggregation error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
