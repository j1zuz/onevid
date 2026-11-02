import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTmdbReadToken } from "@/lib/onevid-tmdb";
import { posthogServerCapture } from "@/lib/posthog-server";
import { getServerT } from "@/lib/server-t";
import type { MediaMeta } from "@/lib/tmdb";
import { getTmdbLocale, searchMovies, searchTv } from "@/lib/tmdb";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();
  const requestedType = searchParams.get("type")?.trim().toLowerCase();
  const typesToSearch: Array<"movie" | "series"> =
    requestedType === "movie" || requestedType === "series"
      ? [requestedType]
      : ["movie", "series"];

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
      return NextResponse.json({ results: [] });
    }

    const tmdbToken = getTmdbReadToken();

    const tmdbResults: MediaMeta[] = [];
    if (tmdbToken) {
      const { locale: appLocale } = await getServerT();
      const tmdbLocale = getTmdbLocale(appLocale);

      const tmdbPromises: Promise<MediaMeta[]>[] = [];
      if (typesToSearch.includes("movie")) {
        tmdbPromises.push(
          searchMovies(tmdbToken, query, undefined, tmdbLocale).catch(() => [])
        );
      }
      if (typesToSearch.includes("series")) {
        tmdbPromises.push(
          searchTv(tmdbToken, query, undefined, tmdbLocale).catch(() => [])
        );
      }

      const tmdbSets = await Promise.all(tmdbPromises);
      for (const set of tmdbSets) {
        tmdbResults.push(...set);
      }
    }

    const seen = new Set<string>();
    const merged: MediaMeta[] = [];

    for (const item of tmdbResults) {
      const dedupeKey = `${item.type}:${item.id}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      merged.push(item);
    }

    const normalizedQuery = query.toLowerCase();
    // Relevancia por nombre y, entre iguales, popularidad de TMDB. Antes se
    // desempataba por año descendente, así que los especiales/reboots recientes
    // tapaban al título original ("Los Simpson", 1989).
    const matchScore = (name: string) => {
      if (name === normalizedQuery) {
        return 3;
      }
      if (name.startsWith(normalizedQuery)) {
        return 2;
      }
      if (name.includes(normalizedQuery)) {
        return 1;
      }
      return 0;
    };
    const ranked = merged.sort((a, b) => {
      const aName = a.name?.toLowerCase() ?? "";
      const bName = b.name?.toLowerCase() ?? "";

      const byMatch = matchScore(bName) - matchScore(aName);
      if (byMatch !== 0) {
        return byMatch;
      }

      const byPopularity = (b.popularity ?? 0) - (a.popularity ?? 0);
      if (byPopularity !== 0) {
        return byPopularity;
      }

      return aName.localeCompare(bName);
    });

    const results = ranked.slice(0, 20);

    posthogServerCapture({
      event: "content_search_performed",
      distinctId: session.user.id,
      properties: {
        query_length: query.length,
        result_count: results.length,
        has_tmdb: Boolean(tmdbToken),
        types: typesToSearch,
      },
    }).catch(() => {
      /* ignore */
    });

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
