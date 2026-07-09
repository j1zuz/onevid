import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOneVidTmdb } from "@/lib/onevid-tmdb";
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

    const { effectiveToken: tmdbToken } = await getOneVidTmdb(session.user.id);

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
    const ranked = merged.sort((a, b) => {
      const aName = a.name?.toLowerCase() ?? "";
      const bName = b.name?.toLowerCase() ?? "";

      const aStarts = aName.startsWith(normalizedQuery) ? 1 : 0;
      const bStarts = bName.startsWith(normalizedQuery) ? 1 : 0;
      if (aStarts !== bStarts) {
        return bStarts - aStarts;
      }

      const aIncludes = aName.includes(normalizedQuery) ? 1 : 0;
      const bIncludes = bName.includes(normalizedQuery) ? 1 : 0;
      if (aIncludes !== bIncludes) {
        return bIncludes - aIncludes;
      }

      const aYear = Number.parseInt(a.year ?? "0", 10);
      const bYear = Number.parseInt(b.year ?? "0", 10);
      if (!(Number.isNaN(aYear) || Number.isNaN(bYear)) && aYear !== bYear) {
        return bYear - aYear;
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
