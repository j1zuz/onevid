import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { StreamOnevid } from "@/components/stream/stream-onevid";
import { parseAddonMediaId } from "@/lib/addon-media";
import { ACTIVE_PROFILE_COOKIE } from "@/components/stream/onevid-profile-context";
import { auth } from "@/lib/auth";
import { oneVidProfile } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { getTmdbReadToken } from "@/lib/onevid-tmdb";
import { getServerT } from "@/lib/server-t";
import {
  fetchMovieDetail,
  fetchTvDetail,
  getTmdbLocale,
  isKidsSafeMedia,
  type MediaMeta,
} from "@/lib/tmdb";

type Params = Promise<{ type: string; id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Reproducir" };
}

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    redirect("/");
  }

  return (
    <PlayerContent
      params={params}
      searchParams={searchParams}
      userId={session.user.id}
    />
  );
}

async function PlayerContent({
  params,
  searchParams,
  userId,
}: {
  params: Params;
  searchParams: SearchParams;
  userId: string;
}) {
  const cookieStore = await cookies();
  const profileId = cookieStore.get(ACTIVE_PROFILE_COOKIE)?.value ?? null;
  const [profile] = profileId
    ? await db
        .select({ isKids: oneVidProfile.isKids })
        .from(oneVidProfile)
        .where(
          and(
            eq(oneVidProfile.id, profileId),
            eq(oneVidProfile.userId, userId)
          )
        )
        .limit(1)
    : await db
        .select({ isKids: oneVidProfile.isKids })
        .from(oneVidProfile)
        .where(eq(oneVidProfile.userId, userId))
        .orderBy(oneVidProfile.createdAt)
        .limit(1);
  const kids = profile?.isKids === true;

  const { type: typeParam, id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const contentType = typeParam === "series" ? "series" : "movie";
  const baseId = contentType === "series" ? id.split(":")[0] : id;

  // Pelis/series de un addon con id propio: no pasan por TMDB; el propio addon
  // resuelve el stream con su id. El título/póster vienen en la URL.
  if (parseAddonMediaId(baseId)) {
    if (kids) {
      redirect("/home");
    }
    const sp = await searchParams;
    const title = typeof sp.title === "string" ? sp.title : "";
    const poster = typeof sp.poster === "string" ? sp.poster : undefined;
    return (
      <StreamOnevid
        contentId={baseId}
        contentPoster={poster}
        contentTitle={title || "Video"}
        contentType={contentType}
        isAddon
        key={id}
        rawId={id}
      />
    );
  }

  const { locale } = await getServerT();
  const token = getTmdbReadToken();
  if (!token) {
    redirect("/home");
  }

  let meta: MediaMeta | null = null;
  try {
    meta =
      contentType === "movie"
        ? await fetchMovieDetail(token, baseId, getTmdbLocale(locale))
        : await fetchTvDetail(token, baseId, getTmdbLocale(locale));
  } catch (error) {
    console.error("Failed to fetch media detail:", error);
  }

  if (kids && (!meta || !isKidsSafeMedia(meta))) {
    redirect("/home");
  }

  return (
    <StreamOnevid
      // Saltar al siguiente episodio navega a esta misma ruta con otro `id`.
      // Sin `key` React reutilizaría la instancia y su estado: el guard que
      // solo lee `sessionStorage` una vez impediría cargar el medio nuevo.
      key={id}
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
