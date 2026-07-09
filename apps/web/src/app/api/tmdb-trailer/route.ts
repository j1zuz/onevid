import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOneVidTmdb } from "@/lib/onevid-tmdb";
import { getServerT } from "@/lib/server-t";
import { fetchTrailerKey, getTmdbLocale } from "@/lib/tmdb";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user?.id) {
    return NextResponse.json({ trailer: null });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id")?.trim();
  const type = searchParams.get("type")?.trim();

  if (!id || (type !== "movie" && type !== "series")) {
    return NextResponse.json({ trailer: null });
  }

  const { effectiveToken: token } = await getOneVidTmdb(session.user.id);

  if (!token) {
    return NextResponse.json({ trailer: null });
  }

  try {
    const { locale: appLocale } = await getServerT();
    const tmdbLocale = getTmdbLocale(appLocale);
    const trailer = await fetchTrailerKey(token, type, id, tmdbLocale);
    return NextResponse.json({ trailer: trailer ?? null });
  } catch {
    return NextResponse.json({ trailer: null });
  }
}
