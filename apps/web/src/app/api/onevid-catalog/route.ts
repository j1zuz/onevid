import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import {
  CATALOG_VIEW_ALL_ITEM_LIMIT,
  fetchAddonCatalogResults,
} from "@/lib/addon-catalog";
import { auth } from "@/lib/auth";
import { oneVidAddon } from "@/lib/auth-schema";
import { db } from "@/lib/db";
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
import {
  fetchCatalogResults,
  fetchCatalogResultsAtLeast,
} from "@/lib/tmdb-catalog";

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

  // `limit` es la vista "Ver todo": el servidor pagina TMDB (o pide el catálogo
  // completo al addon) para devolver hasta N items en UNA respuesta, en vez de
  // que el cliente pagine. Sin `limit` conservamos el comportamiento por página.
  const limitRaw = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const limit =
    Number.isInteger(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, CATALOG_VIEW_ALL_ITEM_LIMIT)
      : 0;

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

  // Resolve the user's TMDB token (v4 user token preferred, legacy read token fallback)
  const { effectiveToken: token } = await getOneVidTmdb(session.user.id);

  if (!token) {
    return NextResponse.json(
      { error: "TMDB token not configured" },
      { status: 400 }
    );
  }

  const { locale: appLocale } = await getServerT();
  const tmdbLocale = getTmdbLocale(appLocale);
  const tmdbRegion = getTmdbRegion(appLocale);

  // Catálogo propio de un addon: a diferencia de los de TMDB no se pagina, el
  // addon entrega su catálogo completo en una sola respuesta. Es la contraparte
  // de la vista "Ver todo" de addon en /home (isAddonView).
  if (catalog === "addon") {
    const addonId = searchParams.get("addonId")?.trim();
    const addonCatalogId = searchParams.get("addonCatalogId")?.trim();
    if (!(addonId && addonCatalogId)) {
      return NextResponse.json(
        { error: "Missing addonId or addonCatalogId" },
        { status: 400 }
      );
    }

    const [addon] = await db
      .select({ baseUrl: oneVidAddon.baseUrl })
      .from(oneVidAddon)
      .where(
        and(
          eq(oneVidAddon.id, addonId),
          eq(oneVidAddon.userId, session.user.id)
        )
      )
      .limit(1);

    // Addon eliminado desde entonces: grilla vacía en vez de error.
    if (!addon) {
      return NextResponse.json({ results: [] });
    }

    try {
      const results = await fetchAddonCatalogResults({
        addonBaseUrl: addon.baseUrl,
        catalogId: addonCatalogId,
        limit: limit || CATALOG_VIEW_ALL_ITEM_LIMIT,
        tmdbLocale,
        token,
        type,
      });
      return NextResponse.json({ results });
    } catch (error) {
      if (error instanceof TmdbAuthError) {
        return NextResponse.json(
          { error: "TMDB token invalid or expired" },
          { status: 401 }
        );
      }
      // Addon caído / timeout: sin resultados, pero no tumbamos la vista.
      return NextResponse.json({ results: [] });
    }
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

  try {
    const results = limit
      ? await fetchCatalogResultsAtLeast(
          {
            type,
            catalog,
            token,
            tmdbLocale,
            tmdbRegion,
            network: selectedNetwork,
          },
          limit
        )
      : await fetchCatalogResults({
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
        limit: limit || undefined,
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
