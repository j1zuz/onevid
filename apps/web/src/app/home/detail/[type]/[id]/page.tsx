import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { StreamOnevid } from "@/components/stream/stream-onevid";
import { auth } from "@/lib/auth";
import { oneVid } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { getServerT } from "@/lib/server-t";
import {
  fetchMovieDetail,
  fetchTvDetail,
  getTmdbLocale,
  type MediaMeta,
} from "@/lib/tmdb";

type Params = Promise<{
  type: string;
  id: string;
}>;

type CatalogType = "movie" | "series";

export async function generateMetadata(_props: {
  params: Params;
}): Promise<Metadata> {
  return { title: "Detalle" };
}

export default async function StreamDetailPage({ params }: { params: Params }) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user?.id) {
    redirect("/");
  }

  const { type: typeParam, id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const { locale: appLocale } = await getServerT();
  const tmdbLocale = getTmdbLocale(appLocale);

  const contentType: CatalogType = typeParam === "series" ? "series" : "movie";

  const [oneVidRow] = await Promise.all([
    db
      .select({
        tmdbUserAccessToken: oneVid.tmdbUserAccessToken,
        tmdbReadAccessToken: oneVid.tmdbReadAccessToken,
      })
      .from(oneVid)
      .where(eq(oneVid.userId, session.user.id))
      .limit(1),
  ]);

  // Prefer the OAuth token (tmdbUserAccessToken); fall back to the legacy one.
  const tmdbToken =
    oneVidRow[0]?.tmdbUserAccessToken ?? oneVidRow[0]?.tmdbReadAccessToken;

  if (!tmdbToken) {
    redirect("/home");
  }
  const baseId = contentType === "series" ? id.split(":")[0] : id;

  let meta: MediaMeta | null = null;
  try {
    meta =
      contentType === "movie"
        ? await fetchMovieDetail(tmdbToken, baseId, tmdbLocale)
        : await fetchTvDetail(tmdbToken, baseId, tmdbLocale);
  } catch (error) {
    console.error("Failed to fetch movie detail:", error);
  }

  return (
    <StreamOnevid
      contentBackground={meta?.background}
      contentId={baseId}
      contentLogo={meta?.logo}
      contentPoster={meta?.poster}
      contentTitle={meta?.name ?? ""}
      contentType={contentType}
      rawId={id}
    />
  );
}
