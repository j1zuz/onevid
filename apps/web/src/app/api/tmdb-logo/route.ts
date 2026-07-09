import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOneVidTmdb } from "@/lib/onevid-tmdb";
import { getServerT } from "@/lib/server-t";
import { getTmdbLocale, TmdbAuthError } from "@/lib/tmdb";

const TMDB_BASE = "https://api.themoviedb.org";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

interface TmdbImagesResponse {
  logos?: { file_path?: string; iso_639_1?: string | null }[];
}

function pickLogo(
  logos: TmdbImagesResponse["logos"],
  preferredLang?: string
): string | undefined {
  if (!logos || logos.length === 0) {
    return;
  }
  const preferred =
    (preferredLang
      ? logos.find((l) => l.iso_639_1 === preferredLang)
      : undefined) ||
    logos.find((l) => l.iso_639_1 === "en") ||
    logos.find((l) => l.iso_639_1 === null) ||
    logos[0];
  if (!preferred?.file_path) {
    return;
  }
  return `${TMDB_IMAGE_BASE}/w500${preferred.file_path}`;
}

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user?.id) {
    return NextResponse.json({ logo: null });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id")?.trim();
  const type = searchParams.get("type")?.trim();

  if (!id || (type !== "movie" && type !== "series")) {
    return NextResponse.json({ logo: null });
  }

  const { effectiveToken: token } = await getOneVidTmdb(session.user.id);

  if (!token) {
    return NextResponse.json({ logo: null });
  }

  const path =
    type === "movie" ? `/3/movie/${id}/images` : `/3/tv/${id}/images`;

  const { locale: appLocale } = await getServerT();
  const lang = getTmdbLocale(appLocale).split("-")[0]?.toLowerCase();

  try {
    const url = new URL(path, TMDB_BASE);

    const res = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      next: { revalidate: 3600 },
    });

    if (res.status === 401) {
      throw new TmdbAuthError("Token TMDB inválido o expirado");
    }

    if (!res.ok) {
      return NextResponse.json({ logo: null });
    }

    const data = (await res.json()) as TmdbImagesResponse;
    const logo = pickLogo(data.logos, lang);

    return NextResponse.json({ logo: logo ?? null });
  } catch {
    return NextResponse.json({ logo: null });
  }
}
