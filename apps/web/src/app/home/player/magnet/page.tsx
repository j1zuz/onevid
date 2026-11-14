import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MagnetConsentGate } from "@/components/stream/magnet-consent-gate";
import { StreamOnevid } from "@/components/stream/stream-onevid";
import { auth } from "@/lib/auth";
import { oneVid } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { debridResolvePath, resolveActiveDebridProvider } from "@/lib/debrid";
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

  // El magnet pegado usa el mismo proveedor debrid activo que los addons: si
  // el usuario cambió a Real-Debrid en Configuración, este reproductor no debe
  // seguir creando torrents en TorBox.
  const [row] = await db
    .select({
      debridProvider: oneVid.debridProvider,
      realDebridApiKey: oneVid.realDebridApiKey,
      torboxApiKey: oneVid.torboxApiKey,
    })
    .from(oneVid)
    .where(eq(oneVid.userId, session.user.id))
    .limit(1);
  const provider = resolveActiveDebridProvider({
    preferred: row?.debridProvider,
    hasTorbox: Boolean(row?.torboxApiKey),
    hasRealDebrid: Boolean(row?.realDebridApiKey),
  });

  return (
    <MagnetConsentGate title={displayName}>
      <StreamOnevid
        contentId={hash}
        contentTitle={displayName}
        contentType="movie"
        directSource={{
          addonId: "magnet",
          addonName: "Magnet link",
          sourceIndex: 0,
          title: displayName,
          url: `${debridResolvePath(provider)}?magnet=${encodeURIComponent(magnetValue)}&redirect=final`,
        }}
        key={magnetValue}
        rawId={hash}
      />
    </MagnetConsentGate>
  );
}
