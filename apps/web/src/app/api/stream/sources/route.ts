import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { oneVid, oneVidAddon } from "@/lib/auth-schema";
import { db } from "@/lib/db";
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

interface ParsedStreamRef {
  episode?: number;
  season?: number;
  tmdbId: string;
}

interface UserContext {
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

async function loadUserContext(userId: string): Promise<UserContext> {
  const [row] = await db
    .select({
      tmdbUserAccessToken: oneVid.tmdbUserAccessToken,
      tmdbReadAccessToken: oneVid.tmdbReadAccessToken,
      torboxApiKey: oneVid.torboxApiKey,
    })
    .from(oneVid)
    .where(eq(oneVid.userId, userId))
    .limit(1);
  return {
    // v4 user token preferred, legacy read token as fallback
    tmdbToken: row?.tmdbUserAccessToken ?? row?.tmdbReadAccessToken ?? null,
    torboxKey: row?.torboxApiKey ?? null,
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
        })
        .from(oneVidAddon)
        .where(eq(oneVidAddon.userId, session.user.id)),
      loadUserContext(session.user.id),
    ]);

    // Resolve IMDb once and pass to addons (better matching on Stremio-style).
    const imdbId = await resolveImdbId(ctx, ref, type);

    const addonResults = await Promise.allSettled(
      addons.map(async (addon) => {
        const result = await fetchAddonStreams(
          addon.baseUrl,
          type,
          ref,
          imdbId,
          Boolean(ctx.torboxKey)
        );
        return {
          addonId: addon.id,
          addonName: addon.manifestName,
          ...result,
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
          addonName,
          addonId,
          sourceIndex: i,
        });
      }
    }

    return Response.json({
      sources,
      totalAddonsTried: addons.length,
      addonErrors,
    } as AggregatedStreamResponse);
  } catch (error) {
    console.error("Stream aggregation error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
