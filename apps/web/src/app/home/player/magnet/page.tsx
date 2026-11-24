import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MagnetPlayer } from "@/components/stream/magnet-player";
import { auth } from "@/lib/auth";
import { oneVid } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { debridResolvePath, resolveActiveDebridProvider } from "@/lib/debrid";
import {
  isMagnetLink,
  magnetDisplayName,
  magnetInfoHash,
} from "@/lib/magnet";
import { readTorboxKey } from "@/lib/secret-box";
import { validateTorboxKey } from "@/lib/torbox";

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
  const hasProviderKey =
    provider === "realdebrid"
      ? Boolean(row?.realDebridApiKey)
      : Boolean(row?.torboxApiKey);

  // Un magnet solo se puede resolver con la cuenta debrid del usuario. Si la
  // key ya no existe o TorBox la rechaza, el player mostraría "no se pudo
  // reproducir esta fuente" y mandaría a culpar al magnet. Se comprueba antes
  // de montarlo para explicar el motivo real (key vencida/revocada).
  let accessProblem: {
    action: string;
    href: string;
    message: string;
  } | null = null;
  if (!hasProviderKey) {
    accessProblem = {
      message: "No hay una API key conectada.",
      action: "Conectar cuenta",
      href: "/home/account?view=catalog",
    };
  } else if (provider === "torbox") {
    const torboxKey = readTorboxKey(row?.torboxApiKey);
    if (torboxKey) {
      const validation = await validateTorboxKey(torboxKey);
      if (validation.status === "invalid") {
        accessProblem = {
          message: "La API key guardada ha expirado.",
          action: "Actualizar API key",
          href: "/home/account?view=catalog",
        };
      }
    }
  }

  return (
    <MagnetPlayer
      contentId={hash}
      displayName={displayName}
      error={accessProblem}
      resolveUrl={`${debridResolvePath(provider)}?magnet=${encodeURIComponent(magnetValue)}&redirect=final`}
    />
  );
}
