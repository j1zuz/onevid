import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOneVidTmdb } from "@/lib/onevid-tmdb";
import { getServerT } from "@/lib/server-t";
import {
  fetchWatchProviders,
  getTmdbLocale,
  getTmdbRegion,
  TmdbAuthError,
} from "@/lib/tmdb";

const SAFE_ID_REGEX = /^[a-zA-Z0-9]+$/;

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawId = searchParams.get("id")?.trim();
  const type = searchParams.get("type") === "series" ? "series" : "movie";
  const title = searchParams.get("title")?.trim() || undefined;
  const yearParam = searchParams.get("year")?.trim();
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : undefined;

  if (!rawId) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  if (!SAFE_ID_REGEX.test(rawId)) {
    return NextResponse.json({ error: "Invalid id format" }, { status: 400 });
  }

  // Resolve the user's TMDB token (v4 user token preferred, legacy read token fallback)
  const { effectiveToken: token } = await getOneVidTmdb(session.user.id);

  if (!token) {
    return NextResponse.json(
      { error: "TMDB token not configured" },
      { status: 400 }
    );
  }

  try {
    const { locale: appLocale } = await getServerT();
    const region = getTmdbRegion(appLocale);
    // JustWatch usa un código de idioma corto (p. ej. "es", "en").
    const language = getTmdbLocale(appLocale).split("-")[0];
    const data = await fetchWatchProviders(token, type, rawId, region, {
      title,
      year,
      language,
    });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof TmdbAuthError) {
      return NextResponse.json(
        { error: "TMDB token invalid or expired" },
        { status: 401 }
      );
    }
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}
