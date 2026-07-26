import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOneVidTmdb } from "@/lib/onevid-tmdb";
import { posthogServerCapture } from "@/lib/posthog-server";
import { getServerT } from "@/lib/server-t";
import {
  getNetworkOptions,
  getTmdbLocale,
  getTmdbRegion,
  TmdbAuthError,
  TmdbNetworkError,
} from "@/lib/tmdb";
import { fetchCatalogResults } from "@/lib/tmdb-catalog";

const VALID_CATALOGS = new Set(["top", "year", "imdbrating", "trending"]);

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type")?.trim().toLowerCase();
  const catalog = (searchParams.get("catalog") ?? "top").trim().toLowerCase();
  const page = Number.parseInt(searchParams.get("page") ?? "1", 10) || 1;

  const networkRaw = searchParams.get("network")?.trim();
  const parsedNetworkId = networkRaw
    ? Number.parseInt(networkRaw, 10)
    : Number.NaN;
  const selectedNetwork = Number.isFinite(parsedNetworkId)
    ? getNetworkOptions().find((n) => n.id === parsedNetworkId)
    : undefined;

  if (type !== "movie" && type !== "series") {
    return NextResponse.json(
      { error: "Invalid type (expected 'movie' or 'series')" },
      { status: 400 }
    );
  }

  if (!VALID_CATALOGS.has(catalog)) {
    return NextResponse.json(
      {
        error:
          "Invalid catalog (expected 'top', 'year', 'imdbrating' or 'trending')",
      },
      { status: 400 }
    );
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
    const tmdbLocale = getTmdbLocale(appLocale);
    const tmdbRegion = getTmdbRegion(appLocale);

    const results = await fetchCatalogResults({
      type,
      catalog,
      token,
      page,
      tmdbLocale,
      tmdbRegion,
      network: selectedNetwork,
    });

    posthogServerCapture({
      event: "onevid_catalog_requested",
      distinctId: session.user.id,
      properties: {
        type,
        catalog,
        page,
        network: selectedNetwork?.id,
        result_count: results.length,
      },
    }).catch(() => {
      /* ignore */
    });

    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof TmdbAuthError) {
      return NextResponse.json(
        { error: "TMDB token invalid or expired" },
        { status: 401 }
      );
    }
    if (error instanceof TmdbNetworkError) {
      return NextResponse.json(
        { error: "Failed to connect to TMDB" },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}
