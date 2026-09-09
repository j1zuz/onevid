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

type Params = Promise<{ type: string; id: string }>;

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Reproducir" };
}

export default async function PlayerPage({ params }: { params: Params }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    redirect("/");
  }

  return <PlayerContent params={params} userId={session.user.id} />;
}

async function PlayerContent({
  params,
  userId,
}: {
  params: Params;
  userId: string;
}) {
  const { type: typeParam, id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const contentType = typeParam === "series" ? "series" : "movie";
  const { locale } = await getServerT();
  const [row] = await db
    .select({
      tmdbUserAccessToken: oneVid.tmdbUserAccessToken,
      tmdbReadAccessToken: oneVid.tmdbReadAccessToken,
    })
    .from(oneVid)
    .where(eq(oneVid.userId, userId))
    .limit(1);
  const token = row?.tmdbUserAccessToken ?? row?.tmdbReadAccessToken;
  if (!token) {
    redirect("/home");
  }

  const baseId = contentType === "series" ? id.split(":")[0] : id;
  let meta: MediaMeta | null = null;
  try {
    meta =
      contentType === "movie"
        ? await fetchMovieDetail(token, baseId, getTmdbLocale(locale))
        : await fetchTvDetail(token, baseId, getTmdbLocale(locale));
  } catch (error) {
    console.error("Failed to fetch media detail:", error);
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
