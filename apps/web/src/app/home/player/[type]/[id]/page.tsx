import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { StreamOnevid } from "@/components/stream/stream-onevid";
import { parseAddonMediaId } from "@/lib/addon-media";
import { auth } from "@/lib/auth";
import { getTmdbReadToken } from "@/lib/onevid-tmdb";
import { getServerT } from "@/lib/server-t";
import {
  fetchMovieDetail,
  fetchTvDetail,
  getTmdbLocale,
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

  return <PlayerContent params={params} searchParams={searchParams} />;
}

async function PlayerContent({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { type: typeParam, id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const contentType = typeParam === "series" ? "series" : "movie";
  const baseId = contentType === "series" ? id.split(":")[0] : id;

  // Pelis/series de un addon con id propio: no pasan por TMDB; el propio addon
  // resuelve el stream con su id. El título/póster vienen en la URL.
  if (parseAddonMediaId(baseId)) {
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
