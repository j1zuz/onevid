"use client";

import { Skeleton } from "@workspace/ui/components/skeleton";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useWatchParty } from "@/components/watch/use-watch-party";
import { WatchPartyChat } from "@/components/watch/watch-party-chat";
import { useTranslation } from "@/lib/onevid-i18n-context";
import type { WatchJoinData, WatchRoomDTO } from "@/lib/watch-party-types";

/**
 * Chat de la watch party para el móvil: mismo chat que `/watch/[roomId]` pero
 * sin reproductor. La TV reproduce y guarda la posición; aquí solo se escribe.
 */
export function WatchRoomChatClient({ room }: { room: WatchRoomDTO }) {
  const { t } = useTranslation();
  const [join, setJoin] = useState<WatchJoinData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const response = await fetch(`/api/watch-rooms/${room.id}/join`, {
          method: "POST",
        });
        const data = (await response.json().catch(() => null)) as
          | WatchJoinData
          | null;
        if (cancelled) {
          return;
        }
        if (response.ok && data) {
          setJoin(data);
          return;
        }
        setError(
          response.status === 409
            ? t("La sala está llena.")
            : response.status === 410 || response.status === 404
              ? t("La sala terminó.")
              : t("No se pudo entrar a la watch party. Inténtalo de nuevo."),
        );
      } catch {
        if (!cancelled) {
          setError(t("No se pudo entrar a la watch party. Inténtalo de nuevo."));
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [room.id, t]);

  if (error) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-6">
        <p className="max-w-sm text-center text-muted-foreground text-sm">
          {error}
        </p>
      </main>
    );
  }

  if (!join) {
    return (
      <main className="flex min-h-dvh flex-col gap-3 bg-background px-4 py-6">
        <Skeleton className="h-12 w-2/3 rounded-full" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-4/5 rounded-2xl" />
        <div className="mt-auto">
          <Skeleton className="h-11 w-full rounded-full" />
        </div>
      </main>
    );
  }

  return <ConnectedChat join={join} />;
}

function ConnectedChat({ join }: { join: WatchJoinData }) {
  const { t } = useTranslation();
  const party = useWatchParty({ join, video: null });
  const [busy, setBusy] = useState<"leave" | "end" | null>(null);
  const leavingRef = useRef(false);

  // Salir al cerrar la pestaña: la sala libera el hueco y, si era el último,
  // se borra. `sendBeacon` sobrevive a la descarga de la página.
  useEffect(() => {
    const leaveOnUnload = () => {
      if (leavingRef.current) return;
      leavingRef.current = true;
      const url = `/api/watch-rooms/${join.room.id}/leave`;
      if (typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon(url, new Blob([], { type: "application/json" }));
        return;
      }
      void fetch(url, { method: "POST", keepalive: true });
    };
    window.addEventListener("pagehide", leaveOnUnload);
    return () => window.removeEventListener("pagehide", leaveOnUnload);
  }, [join.room.id]);

  const handleLeave = async () => {
    if (busy) return;
    setBusy("leave");
    leavingRef.current = true;
    try {
      await fetch(`/api/watch-rooms/${join.room.id}/leave`, {
        method: "POST",
      }).catch(() => null);
      await party.disconnect();
      window.location.replace("/home");
    } finally {
      setBusy(null);
    }
  };

  const handleEnd = async () => {
    if (busy) return;
    setBusy("end");
    try {
      const response = await fetch(`/api/watch-rooms/${join.room.id}/end`, {
        method: "POST",
      });
      if (!response.ok) {
        toast.error(t("No se pudo terminar la sala."));
        return;
      }
      await party.disconnect();
      window.location.replace("/home");
    } catch {
      toast.error(t("No se pudo terminar la sala."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="flex h-dvh min-h-0 flex-col bg-background">
      <WatchPartyChat
        busy={busy}
        contentPoster={join.room.poster ?? undefined}
        contentTitle={join.room.title}
        error={party.error}
        hostId={party.hostId}
        isHost={party.isHost}
        join={join}
        members={party.members}
        messages={party.messages}
        onEnd={handleEnd}
        onKick={party.kickMember}
        onLeave={handleLeave}
        onPreviewGif={party.previewGif}
        onReaction={party.sendReaction}
        onRequestSync={party.requestSync}
        onSend={party.sendMessage}
        onSendFile={party.sendFile}
        onSendGif={party.sendGif}
        onSendVoice={party.sendVoice}
        onTogglePin={party.togglePin}
        onToggleReaction={party.toggleReaction}
        ready={party.ready}
        sending={party.sending}
        syncStatus={party.syncStatus}
      />
    </main>
  );
}
