import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getProfileProgress,
  listProfileProgress,
  type ProgressInput,
  resolveActiveProfile,
  type SavedMediaType,
  setProfileProgress,
} from "@/lib/onevid-profile";
import { getOneVidTmdb } from "@/lib/onevid-tmdb";
import { getServerT } from "@/lib/server-t";
import { fetchLocalizedTitle, getTmdbLocale } from "@/lib/tmdb";

const NUMERIC_ID_RE = /^\d+$/;

/** GET: list "Continue watching" (no query) or resume a single title (?id=&type=). */
export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const profileId = request.headers.get("x-profile-id");
  const resolved = await resolveActiveProfile(session.user.id, profileId);
  if (resolved.status === "no_profile") {
    return NextResponse.json({ error: "no_profile" }, { status: 409 });
  }
  if (resolved.status === "invalid_profile") {
    return NextResponse.json({ error: "invalid_profile" }, { status: 400 });
  }

  const params = request.nextUrl.searchParams;
  const id = params.get("id")?.trim();

  // Single-title resume lookup.
  if (id) {
    const type = params.get("type")?.trim().toLowerCase();
    if (type !== "movie" && type !== "series") {
      return NextResponse.json({ error: "type inválido" }, { status: 400 });
    }
    const season = Number.parseInt(params.get("season") ?? "0", 10) || 0;
    const episode = Number.parseInt(params.get("episode") ?? "0", 10) || 0;
    const progress = await getProfileProgress(
      resolved.profile.id,
      type,
      id,
      season,
      episode
    );
    return NextResponse.json(
      progress ?? { positionSec: 0, durationSec: 0 }
    );
  }

  const results = await listProfileProgress(resolved.profile.id);

  // Los nombres se guardan al reproducir, así que quedan "congelados" en el
  // idioma de entonces. Refrescamos el título al idioma actual (cookie web o
  // header x-app-language del móvil) con una consulta ligera a TMDB por título.
  // Es best-effort: si no hay token o TMDB falla, conservamos el nombre guardado.
  try {
    const { effectiveToken: token } = await getOneVidTmdb(session.user.id);
    if (token && results.length > 0) {
      const { locale } = await getServerT();
      const tmdbLocale = getTmdbLocale(locale);
      await Promise.all(
        results.map(async (item) => {
          const localized = await fetchLocalizedTitle(
            token,
            item.type,
            item.id,
            tmdbLocale
          ).catch(() => undefined);
          if (localized) {
            item.name = localized;
          }
        })
      );
    }
  } catch {
    /* enriquecimiento best-effort: mantenemos los nombres guardados */
  }

  return NextResponse.json({ results });
}

/** POST: upsert playback position for a title. */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  let input: ProgressInput;
  try {
    const body = (await request.json()) as {
      mediaId?: unknown;
      mediaType?: unknown;
      season?: unknown;
      episode?: unknown;
      positionSec?: unknown;
      durationSec?: unknown;
      name?: unknown;
      poster?: unknown;
      background?: unknown;
      year?: unknown;
    };
    const mediaId =
      typeof body.mediaId === "number"
        ? String(body.mediaId)
        : String(body.mediaId ?? "").trim();
    const mediaType = String(body.mediaType ?? "")
      .trim()
      .toLowerCase();
    const positionSec = Number(body.positionSec);

    if (!NUMERIC_ID_RE.test(mediaId)) {
      return Response.json({ error: "mediaId inválido" }, { status: 400 });
    }
    if (mediaType !== "movie" && mediaType !== "series") {
      return Response.json({ error: "mediaType inválido" }, { status: 400 });
    }
    if (!Number.isFinite(positionSec) || positionSec < 0) {
      return Response.json({ error: "positionSec inválido" }, { status: 400 });
    }

    const durationRaw = Number(body.durationSec);
    input = {
      mediaId,
      mediaType: mediaType as SavedMediaType,
      season: Number.parseInt(String(body.season ?? "0"), 10) || 0,
      episode: Number.parseInt(String(body.episode ?? "0"), 10) || 0,
      positionSec,
      durationSec:
        Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 0,
      name: typeof body.name === "string" ? body.name : undefined,
      poster: typeof body.poster === "string" ? body.poster : undefined,
      background:
        typeof body.background === "string" ? body.background : undefined,
      year: typeof body.year === "string" ? body.year : undefined,
    };
  } catch {
    return Response.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const profileId = request.headers.get("x-profile-id");
  const resolved = await resolveActiveProfile(session.user.id, profileId);
  if (resolved.status === "no_profile") {
    return Response.json({ error: "no_profile" }, { status: 409 });
  }
  if (resolved.status === "invalid_profile") {
    return Response.json({ error: "invalid_profile" }, { status: 400 });
  }

  await setProfileProgress(resolved.profile.id, input);
  return Response.json({ ok: true });
}
