import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { StreamOnevid } from "@/components/stream/stream-onevid";
import { auth } from "@/lib/auth";
import {
  isMagnetLink,
  magnetDisplayName,
  magnetInfoHash,
} from "@/lib/magnet";

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Reproducir magnet" };
}

/**
 * Reproductor para un magnet pegado en el buscador del catálogo. El magnet va
 * en la URL (`?magnet=…`) para que el enlace se pueda compartir. El player
 * recibe la fuente ya armada y se encarga de su propio estado de carga.
 */
export default async function MagnetPlayerPage({
  searchParams,
}: {
  searchParams: Promise<{ magnet?: string | string[] }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    redirect("/");
  }

  const { magnet } = await searchParams;
  const value = Array.isArray(magnet) ? magnet[0] : magnet;
  if (!(value && isMagnetLink(value))) {
    redirect("/home");
  }

  const magnetValue = value.trim();
  const hash = magnetInfoHash(magnetValue) ?? "magnet";
  const displayName = magnetDisplayName(magnetValue);

  return (
    <StreamOnevid
      contentId={hash}
      contentTitle={displayName}
      contentType="movie"
      directSource={{
        addonId: "magnet",
        addonName: "Magnet link",
        sourceIndex: 0,
        title: displayName,
        url: `/api/torbox/resolve?magnet=${encodeURIComponent(magnetValue)}&redirect=final`,
      }}
      key={magnetValue}
      rawId={hash}
    />
  );
}
