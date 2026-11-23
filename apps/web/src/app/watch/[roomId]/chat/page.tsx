import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { WatchChatSignIn } from "@/components/watch/watch-chat-sign-in";
import { WatchRoomChatClient } from "@/components/watch/watch-room-chat-client";
import { auth } from "@/lib/auth";
import { DEFAULT_LANGUAGE, type SupportedLanguage } from "@/lib/languages";
import { ALL_TRANSLATIONS } from "@/lib/translations";
import { getWatchRoom, toWatchRoomDTO } from "@/lib/watch-party";

type Params = Promise<{ roomId: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { roomId } = await params;
  const room = await getWatchRoom(roomId);
  const locale = (await cookies()).get("NEXT_LOCALE")?.value as
    | SupportedLanguage
    | undefined;
  const dict =
    ALL_TRANSLATIONS[locale ?? DEFAULT_LANGUAGE] ??
    ALL_TRANSLATIONS[DEFAULT_LANGUAGE];
  const label = dict["Ver juntos"] ?? "Ver juntos";
  return {
    title: room ? `${label}: ${room.title}` : label,
    robots: { index: false, follow: false },
  };
}

/**
 * Chat de la watch party en el móvil, sin reproductor.
 *
 * La TV crea la sala y muestra un QR con esta ruta: en el teléfono solo se
 * escribe y se reacciona, mientras la reproducción sigue en la TV (que guarda
 * la posición en `/api/watch-rooms/[id]/state`). Reutiliza el mismo componente
 * de chat y el mismo hook que `/watch/[roomId]`, pero sin elemento de vídeo.
 */
export default async function WatchRoomChatPage({
  params,
}: {
  params: Params;
}) {
  const session = await auth.api.getSession({ headers: await headers() });

  const { roomId } = await params;
  const room = await getWatchRoom(roomId);
  if (!room) {
    notFound();
  }

  // Sin sesión se resuelve aquí mismo: mandarlo a "/" le haría perder la sala.
  if (!session?.user?.id) {
    return <WatchChatSignIn roomTitle={room.title} />;
  }

  return <WatchRoomChatClient room={toWatchRoomDTO(room)} />;
}
