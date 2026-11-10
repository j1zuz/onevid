import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { WatchRoomClient } from "@/components/watch/watch-room-client";
import { auth } from "@/lib/auth";
import { DEFAULT_LANGUAGE, type SupportedLanguage } from "@/lib/languages";
import { ALL_TRANSLATIONS } from "@/lib/translations";
import { getWatchRoom, toWatchRoomDTO } from "@/lib/watch-party";

type Params = Promise<{ roomId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
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

export default async function WatchRoomPage({ params }: { params: Params }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    redirect("/");
  }

  const { roomId } = await params;
  const room = await getWatchRoom(roomId);
  if (!room) {
    notFound();
  }

  return <WatchRoomClient room={toWatchRoomDTO(room)} />;
}
