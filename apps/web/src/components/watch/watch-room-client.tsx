"use client";

import { Button } from "@workspace/ui/components/button";
import { DoorClosedIcon, TriangleAlertIcon, UsersIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { StreamOnevid } from "@/components/stream/stream-onevid";
import { useTranslation } from "@/lib/onevid-i18n-context";
import type { WatchJoinData, WatchRoomDTO } from "@/lib/watch-party-types";

type JoinError = "full" | "ended" | "generic";

function RoomBackdrop({ poster }: { poster: string | null }) {
  return (
    <>
      {poster ? (
        // biome-ignore lint/performance/noImgElement: poster remoto de TMDB de fondo
        <img
          alt=""
          aria-hidden
          className="absolute inset-0 size-full object-cover opacity-20 blur-2xl"
          src={poster}
        />
      ) : null}
      <div className="absolute inset-0 bg-background/70" />
    </>
  );
}

function roomBackHref(room: WatchRoomDTO): string {
  if (room.isAddon) {
    return "/home";
  }
  if (room.contentType === "series" && room.season > 0) {
    return `/home/detail/series/${encodeURIComponent(room.contentId)}?season=${room.season}`;
  }
  return `/home/detail/${room.contentType}/${encodeURIComponent(room.contentId)}`;
}

export function WatchRoomClient({ room }: { room: WatchRoomDTO }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [join, setJoin] = useState<WatchJoinData | null>(null);
  const [error, setError] = useState<JoinError | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const response = await fetch(`/api/watch-rooms/${room.id}/join`, {
          method: "POST",
        });
        const data = (await response.json().catch(() => null)) as
          | (WatchJoinData & { code?: string })
          | null;
        if (cancelled) {
          return;
        }
        if (response.ok && data) {
          setJoin(data);
          return;
        }
        if (response.status === 409) {
          setError("full");
          return;
        }
        if (response.status === 410) {
          setError("ended");
          return;
        }
        setError("generic");
      } catch {
        if (!cancelled) {
          setError("generic");
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [room.id]);

  const back = () => router.replace(roomBackHref(room));
  const ErrorIcon =
    error === "full"
      ? UsersIcon
      : error === "ended"
        ? DoorClosedIcon
        : TriangleAlertIcon;

  if (error) {
    const title =
      error === "full"
        ? t("La sala está llena")
        : error === "ended"
          ? t("La sala terminó")
          : t("No se pudo entrar a la sala");
    const description =
      error === "full"
        ? t("Esta watch party ya tiene {{max}} personas.", {
            max: room.maxParticipants,
          })
        : error === "ended"
          ? t("El host cerró la watch party.")
          : t("Revisa tu conexión e inténtalo de nuevo.");
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-background px-6">
        <RoomBackdrop poster={room.poster} />
        <div className="relative flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl border border-border/60 bg-card/90 px-8 py-10 text-center shadow-2xl backdrop-blur-xl">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <ErrorIcon className="size-6 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="font-medium text-lg">{title}</p>
            <p className="text-muted-foreground text-sm">{description}</p>
          </div>
          <Button onClick={back} variant="secondary">
            {t("Volver")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <StreamOnevid
      contentBackground={room.background ?? undefined}
      contentId={room.contentId}
      contentPoster={room.poster ?? undefined}
      contentTitle={room.title}
      contentType={room.contentType}
      isAddon={room.isAddon}
      rawId={room.rawId}
      watchPartyJoining={!join}
      watchRoom={
        join
          ? {
              id: room.id,
              isHost: join.isHost,
              maxParticipants: room.maxParticipants,
              join,
            }
          : undefined
      }
      onWatchRoomLeave={back}
    />
  );
}
