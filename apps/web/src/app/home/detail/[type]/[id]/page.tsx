import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import DetailLoading from "@/app/home/detail/[type]/[id]/loading";
import { MovieDetailPage } from "@/components/explore-movie-dialog";
import { DetailScrollContainer } from "@/components/stream/detail-scroll-container";
import { OneVidHeader } from "@/components/stream/onevid-header";
import { OneVidProfileProvider } from "@/components/stream/onevid-profile-context";
import { auth } from "@/lib/auth";
import { oneVid, oneVidProfile } from "@/lib/auth-schema";
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

/**
 * Thin shell: only does auth + redirect (fast — reads a cookie/JWT).
 * The TMDB fetch lives in <StreamDetailContent> inside <Suspense> so
 * Next.js can prefetch the loading.tsx shell on <Link> hover.
 */
export default function StreamDetailPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<DetailLoading />}>
      <StreamDetailContent params={params} />
    </Suspense>
  );
}

async function StreamDetailContent({ params }: { params: Params }) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user?.id) {
    redirect("/");
  }

  const { type: typeParam, id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const { locale: appLocale } = await getServerT();
  const tmdbLocale = getTmdbLocale(appLocale);

  const contentType: CatalogType = typeParam === "series" ? "series" : "movie";

  const [[oneVidRow], profileRows] = await Promise.all([
    db
      .select({
        tmdbUserAccessToken: oneVid.tmdbUserAccessToken,
        tmdbReadAccessToken: oneVid.tmdbReadAccessToken,
      })
      .from(oneVid)
      .where(eq(oneVid.userId, session.user.id))
      .limit(1),
    db
      .select({
        id: oneVidProfile.id,
        name: oneVidProfile.name,
        avatar: oneVidProfile.avatar,
        isKids: oneVidProfile.isKids,
        pinHash: oneVidProfile.pinHash,
      })
      .from(oneVidProfile)
      .where(eq(oneVidProfile.userId, session.user.id))
      .orderBy(oneVidProfile.createdAt),
  ]);

  // Prefer the OAuth token (tmdbUserAccessToken); fall back to the legacy one.
  const tmdbToken =
    oneVidRow?.tmdbUserAccessToken ?? oneVidRow?.tmdbReadAccessToken;

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

  if (!meta) {
    redirect("/home");
  }

  return (
    <main className="mx-auto flex h-dvh w-full max-w-7xl flex-1 flex-col overflow-hidden border-border border-x border-dashed bg-background px-4 pt-0 pb-6 md:px-6">
      <OneVidProfileProvider
        initialProfiles={profileRows.map(({ pinHash, ...profile }) => ({
          ...profile,
          hasPin: Boolean(pinHash),
        }))}
      >
        <div className="flex h-full min-h-0 flex-1 flex-col">
          <OneVidHeader
            addons={[]}
            discoverRows={[]}
            feedConfigured={false}
            feedRows={[]}
            hasTorboxKey={false}
            linked={true}
            setupCompleted={true}
          />
          <DetailScrollContainer>
            <MovieDetailPage movie={meta} />
          </DetailScrollContainer>
        </div>
      </OneVidProfileProvider>
    </main>
  );
}
