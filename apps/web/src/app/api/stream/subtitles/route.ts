import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { oneVid, oneVidAddon } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { findImdbId } from "@/lib/tmdb";
import type { StreamType } from "@/types/stream";
import { safeFetch } from "@/utils/ssrf-guard";

// Mismo presupuesto que stream/sources: cada addon puede tardar ~10s y se
// consultan tras resolver el IMDb id.
export const maxDuration = 60;

const COMPOUND_ID_RE = /^(tt\d+|\d+):(\d+):(\d+)$/;
const NUMERIC_ID_RE = /^\d+$/;
// Tope de pistas devueltas: algunos addons responden cientos de variantes del
// mismo idioma y el selector se vuelve inusable.
const MAX_SUBTITLES = 40;

interface RequestBody {
  id?: unknown;
  type?: unknown;
}

interface ParsedRef {
  imdbId?: string;
  tmdbId?: string;
  season?: number;
  episode?: number;
}

/** Una pista de subtítulos lista para consumir como `<track>`. */
export interface SubtitleTrack {
  id: string;
  /** Código de idioma tal cual lo declara el addon ("spa", "es", "eng"…). */
  lang: string;
  /** URL del addon, tal cual. La consume el `<track>` directamente. */
  url: string;
}

/** Mismo formato de id que stream/sources: TMDB numérico o IMDb, con sufijo. */
function parseRef(id: string, type: StreamType): ParsedRef | null {
  if (type === "series") {
    const match = id.match(COMPOUND_ID_RE);
    if (!match) {
      return null;
    }
    const base = match[1];
    const ref: ParsedRef = {
      season: Number(match[2]),
      episode: Number(match[3]),
    };
    if (base.startsWith("tt")) {
      ref.imdbId = base;
    } else {
      ref.tmdbId = base;
    }
    return ref;
  }
  if (id.startsWith("tt")) {
    return { imdbId: id };
  }
  return NUMERIC_ID_RE.test(id) ? { tmdbId: id } : null;
}

/**
 * Convención Stremio para subtítulos: `/subtitles/:type/:id.json`. Requiere el
 * IMDb id, igual que el recurso `stream` del mismo protocolo.
 */
function buildSubtitlesUrl(
  baseUrl: string,
  type: StreamType,
  imdbId: string,
  ref: ParsedRef
): string {
  const streamId =
    ref.season !== undefined && ref.episode !== undefined
      ? `${imdbId}:${ref.season}:${ref.episode}`
      : imdbId;
  return `${baseUrl}/subtitles/${type}/${streamId}.json`;
}

interface StremioSubtitle {
  id?: unknown;
  lang?: unknown;
  url?: unknown;
}

/**
 * Consulta el recurso `subtitles` de un addon. No comprobamos antes si lo
 * declara en su manifest: la tabla `one_vid_addon` no guarda ese dato y un
 * addon que no lo implementa responde 404, que aquí es simplemente "sin
 * subtítulos". Es el mismo trato tolerante que ya reciben los streams.
 */
async function fetchAddonSubtitles(
  baseUrl: string,
  type: StreamType,
  imdbId: string,
  ref: ParsedRef
): Promise<SubtitleTrack[]> {
  try {
    const res = await safeFetch(buildSubtitlesUrl(baseUrl, type, imdbId, ref), {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as { subtitles?: StremioSubtitle[] };
    const raw = Array.isArray(data.subtitles) ? data.subtitles : [];

    const tracks: SubtitleTrack[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const url = typeof item.url === "string" ? item.url.trim() : "";
      const lang = typeof item.lang === "string" ? item.lang.trim() : "";
      if (!(url && lang)) {
        continue;
      }
      // La URL va directa al `<track>`, sin pasar por un proxy propio. A
      // cambio, la pista solo carga si el servidor del addon refleja CORS y
      // sirve WebVTT: un SRT o una respuesta sin `Access-Control-Allow-Origin`
      // deja el `<track>` vacío y el navegador lo reporta como `error` en él.
      tracks.push({
        id: typeof item.id === "string" && item.id ? item.id : url,
        lang,
        url,
      });
    }
    return tracks;
  } catch {
    return [];
  }
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
    const type: StreamType = body.type === "series" ? "series" : "movie";
    if (!id) {
      return Response.json({ error: "Missing id parameter" }, { status: 400 });
    }
    const ref = parseRef(id, type);
    if (!ref) {
      return Response.json({ error: "Unsupported id format" }, { status: 400 });
    }

    const [addons, [tmdbRow]] = await Promise.all([
      db
        .select({ baseUrl: oneVidAddon.baseUrl })
        .from(oneVidAddon)
        .where(eq(oneVidAddon.userId, session.user.id)),
      db
        .select({
          tmdbUserAccessToken: oneVid.tmdbUserAccessToken,
          tmdbReadAccessToken: oneVid.tmdbReadAccessToken,
        })
        .from(oneVid)
        .where(eq(oneVid.userId, session.user.id))
        .limit(1),
    ]);

    if (addons.length === 0) {
      return Response.json({ subtitles: [] });
    }

    let { imdbId } = ref;
    if (!imdbId && ref.tmdbId) {
      // El token del usuario, no el global del entorno: es el que usan
      // stream/sources y series-meta (v4 de usuario, con el de lectura como
      // reserva). Tomar otro daría resultados distintos según la ruta.
      const tmdbToken =
        tmdbRow?.tmdbUserAccessToken ?? tmdbRow?.tmdbReadAccessToken;
      if (tmdbToken) {
        imdbId =
          (await findImdbId(tmdbToken, ref.tmdbId, type).catch(
            () => undefined
          )) ?? undefined;
      }
    }
    // El protocolo no admite el id numérico de TMDB, así que sin IMDb no hay
    // nada que preguntar.
    if (!imdbId) {
      return Response.json({ subtitles: [] });
    }

    const results = await Promise.allSettled(
      addons.map((addon) =>
        fetchAddonSubtitles(addon.baseUrl, type, imdbId as string, ref)
      )
    );

    // Deduplicar por id: varios addons suelen servir la misma pista.
    const seen = new Set<string>();
    const subtitles: SubtitleTrack[] = [];
    for (const result of results) {
      if (result.status !== "fulfilled") {
        continue;
      }
      for (const track of result.value) {
        if (seen.has(track.id) || subtitles.length >= MAX_SUBTITLES) {
          continue;
        }
        seen.add(track.id);
        subtitles.push(track);
      }
    }

    return Response.json({ subtitles });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
