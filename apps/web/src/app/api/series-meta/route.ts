import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { activeProfileIsKids } from "@/lib/onevid-profile";
import { checkRateLimitDb } from "@/lib/rate-limit-db";
import { rateLimitResponse } from "@/lib/rate-limit";
import { getTmdbReadToken } from "@/lib/onevid-tmdb";
import { getServerT } from "@/lib/server-t";
import { fetchTvSeriesMeta, getTmdbLocale, isKidsSafeMedia, TmdbAuthError } from "@/lib/tmdb";

const SAFE_ID_REGEX = /^[a-zA-Z0-9]+$/;

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limited = await checkRateLimitDb(`tmdb-series-meta:${session.user.id}`, 60, 60_000);
  if (!limited.ok) return rateLimitResponse(limited.retryAfter);

  const { searchParams } = new URL(request.url);
  const rawId = searchParams.get("id")?.trim();
  const rawSeason = searchParams.get("season")?.trim();

  if (!rawId) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  // Only allow alphanumeric IDs (TMDB numeric or IMDb without tt prefix handled separately)
  if (!SAFE_ID_REGEX.test(rawId)) {
    return NextResponse.json({ error: "Invalid id format" }, { status: 400 });
  }
  if (
    rawSeason &&
    (!Number.isInteger(Number(rawSeason)) || Number(rawSeason) < 1)
  ) {
    return NextResponse.json({ error: "Invalid season" }, { status: 400 });
  }
  const season = rawSeason ? Number(rawSeason) : undefined;

  const kids = await activeProfileIsKids(session.user.id, request);
  const token = getTmdbReadToken();

  if (!token) {
    return NextResponse.json(
      { error: "TMDB token not configured" },
      { status: 400 }
    );
  }

  try {
    const { locale: appLocale } = await getServerT();
    const tmdbLocale = getTmdbLocale(appLocale);
    const data = await fetchTvSeriesMeta(
      token,
      rawId,
      tmdbLocale,
      season
    );
    if (kids && !isKidsSafeMedia(data)) {
      return NextResponse.json(
        { error: "kids_restricted" },
        { status: 404 }
      );
    }
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
