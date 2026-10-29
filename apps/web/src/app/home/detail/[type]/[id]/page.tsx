import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import DetailLoading from "@/app/home/detail/[type]/[id]/loading";
import { MovieDetailPage } from "@/components/explore-movie-dialog";
import { DetailScrollContainer } from "@/components/stream/detail-scroll-container";
import { OneVidHeader } from "@/components/stream/onevid-header";
import {
  ACTIVE_PROFILE_COOKIE,
  OneVidProfileProvider,
  VERIFIED_PROFILE_COOKIE,
} from "@/components/stream/onevid-profile-context";
import { auth } from "@/lib/auth";
import { oneVidProfile } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { getTmdbReadToken } from "@/lib/onevid-tmdb";
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
export default function StreamDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<{ season?: string }>;
}) {
  return (
    <Suspense fallback={<DetailLoading />}>
      <StreamDetailContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function StreamDetailContent({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<{ season?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user?.id) {
    redirect("/");
  }

  const { type: typeParam, id: rawId } = await params;
  const { season: seasonParam } = await searchParams;
  const initialSeason = Number(seasonParam) > 0 ? Number(seasonParam) : undefined;
  const id = decodeURIComponent(rawId);
  const { locale: appLocale } = await getServerT();
  const tmdbLocale = getTmdbLocale(appLocale);

  const contentType: CatalogType = typeParam === "series" ? "series" : "movie";

  const profileRows = await db
    .select({
      id: oneVidProfile.id,
      name: oneVidProfile.name,
      avatar: oneVidProfile.avatar,
      isKids: oneVidProfile.isKids,
      pinHash: oneVidProfile.pinHash,
    })
    .from(oneVidProfile)
    .where(eq(oneVidProfile.userId, session.user.id))
    .orderBy(oneVidProfile.createdAt);

  const tmdbToken = getTmdbReadToken();

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

  const cookieStore = await cookies();
  const activeProfileId = cookieStore.get(ACTIVE_PROFILE_COOKIE)?.value ?? null;
  const verifiedProfileId =
    cookieStore.get(VERIFIED_PROFILE_COOKIE)?.value ?? null;

  return (
    <main className="mx-auto flex h-dvh w-full max-w-7xl flex-1 flex-col overflow-hidden border-border border-x border-dashed bg-background px-4 pt-0 pb-6 md:px-6">
      <OneVidProfileProvider
        initialActiveProfileId={activeProfileId}
        initialProfiles={profileRows.map(({ pinHash, ...profile }) => ({
          ...profile,
          hasPin: Boolean(pinHash),
        }))}
        initialVerifiedProfileId={verifiedProfileId}
      >
        <div className="flex h-full min-h-0 flex-1 flex-col">
          <OneVidHeader
            addons={[]}
            discoverRows={[]}
            feedConfigured={false}
            feedRows={[]}
            hasTorboxKey={false}
            setupCompleted={true}
          />
          <DetailScrollContainer>
            <MovieDetailPage initialSeason={initialSeason} movie={meta} />
          </DetailScrollContainer>
        </div>
      </OneVidProfileProvider>
    </main>
  );
}
