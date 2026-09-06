/**
 * Feed de inicio ya resuelto (filas + items + hero) en UNA request.
 *
 * Existe para la app mobile: su pantalla de Inicio pinta el mismo feed que el
 * usuario configuró en la web, y resolverlo desde el cliente serían 1 + N
 * requests (una por fila, hasta FEED_MAX_ROWS) cada una repitiendo sesión y
 * token TMDB. En una TV con wifi lenta eso se nota, así que la orquestación se
 * queda en el servidor. Aquí `resolveFeed` entrega hero + filas en una sola
 * espera; /home usa las piezas por separado (`resolveHero` +
 * `resolveFeedSections`) para transmitir las filas sin bloquear su LCP.
 */

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { oneVid, oneVidAddon } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import {
  type FeedSurface,
  getDefaultRows,
  parseFeedRows,
} from "@/lib/onevid-feed";
import { resolveFeed } from "@/lib/onevid-feed-sections";
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

/** Tope defensivo: TMDB sirve 20 por página y no pedimos más de una. */
const MAX_ITEMS_PER_ROW = 20;

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { effectiveToken: tmdbToken } = await getOneVidTmdb(session.user.id);
  if (!tmdbToken) {
    return NextResponse.json(
      { error: "TMDB token not configured" },
      { status: 400 }
    );
  }

  const surface: FeedSurface =
    request.nextUrl.searchParams.get("surface") === "discover"
      ? "discover"
      : "home";

  const [[row], addonRows] = await Promise.all([
    db
      .select({
        discoverRows: oneVid.discoverRows,
        feedRows: oneVid.feedRows,
      })
      .from(oneVid)
      .where(eq(oneVid.userId, session.user.id))
      .limit(1),
    db
      .select({
        id: oneVidAddon.id,
        baseUrl: oneVidAddon.baseUrl,
        manifestName: oneVidAddon.manifestName,
        catalogs: oneVidAddon.catalogs,
      })
      .from(oneVidAddon)
      .where(eq(oneVidAddon.userId, session.user.id)),
  ]);
  const addonsById = new Map(
    addonRows.map((addon) => [
      addon.id,
      {
        baseUrl: addon.baseUrl,
        catalogs: addon.catalogs ?? [],
        manifestName: addon.manifestName,
      },
    ])
  );

  const parsed = parseFeedRows(
    surface === "discover" ? row?.discoverRows : row?.feedRows
  );
  const rows = parsed?.length ? parsed : getDefaultRows(surface);

  const requestedLimit = Number(
    request.nextUrl.searchParams.get("limit") ?? Number.NaN
  );
  const itemsPerRow =
    Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_ITEMS_PER_ROW)
      : undefined;

  const { locale: appLocale, t } = await getServerT();

  try {
    const feed = await resolveFeed({
      addonsById,
      itemsPerRow,
      networksById: new Map(getNetworkOptions().map((n) => [n.id, n])),
      rows,
      t,
      tmdbLocale: getTmdbLocale(appLocale),
      tmdbRegion: getTmdbRegion(appLocale),
      token: tmdbToken,
    });

    if (feed.error === "auth") {
      return NextResponse.json(
        { error: "TMDB token invalid or expired" },
        { status: 401 }
      );
    }

    posthogServerCapture({
      event: "onevid_feed_sections_requested",
      distinctId: session.user.id,
      properties: {
        configured: parsed !== null,
        row_count: rows.length,
        section_count: feed.sections.length,
        surface,
      },
    }).catch(() => {
      /* ignore */
    });

    return NextResponse.json({
      configured: parsed !== null,
      error: feed.error,
      hero: feed.hero,
      sections: feed.sections,
    });
  } catch (error) {
    // resolveFeed absorbe los fallos por fila; esto solo salta si revienta algo
    // transversal (p. ej. el token muere al resolver el hero).
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
    console.error("[onevid] /api/onevid-feed/sections falló:", error);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}
