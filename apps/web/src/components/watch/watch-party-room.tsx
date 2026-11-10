"use client";

import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable";
import { Separator } from "@workspace/ui/components/separator";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { PlayIcon, UsersIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import { useWatchParty } from "@/components/watch/use-watch-party";
import { WatchPartyChat } from "@/components/watch/watch-party-chat";
import { useTranslation } from "@/lib/onevid-i18n-context";
import type { WatchJoinData } from "@/lib/watch-party-types";

type PartyReaction = { emoji: string; id: number };

type PartyOverlayState = {
  ended: boolean;
  needsGesture: boolean;
  reactions: PartyReaction[];
  resumePlayback: () => void;
};

/**
 * Sala de watch party: reproductor + chat en un `ResizablePanelGroup` real.
 * El layout se monta desde el primer momento (incluso mientras se resuelve el
 * join) para no duplicar una pantalla de "Entrando…" ni remontar el player:
 * solo el contenido del panel de chat pasa de "conectando" a conectado.
 */
export function WatchPartyRoom({
  chatOpen = true,
  children,
  contentLogo,
  contentPoster,
  contentTitle,
  join,
  onChatOpenChange,
  onLeave,
  onUnreadChange,
  video,
}: {
  chatOpen?: boolean;
  children?: ReactNode;
  contentLogo?: string;
  contentPoster?: string;
  contentTitle?: string;
  join: WatchJoinData | null;
  onChatOpenChange?: (open: boolean) => void;
  onLeave: () => void;
  onUnreadChange?: (count: number) => void;
  video: HTMLVideoElement | null;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const chatPanelRef = useRef<PanelImperativeHandle | null>(null);
  const [overlay, setOverlay] = useState<PartyOverlayState | null>(null);
  const [forcedEnded, setForcedEnded] = useState(false);

  // El botón de la barra superior controla el panel; arrastrarlo hasta 0
  // también avisa hacia arriba para que el icono refleje el estado real.
  useEffect(() => {
    const panel = chatPanelRef.current;
    if (!panel) {
      return;
    }
    if (chatOpen && panel.isCollapsed()) {
      panel.expand();
    } else if (!chatOpen && !panel.isCollapsed()) {
      panel.collapse();
    }
  }, [chatOpen]);

  const chat = join ? (
    <WatchPartyConnectedChat
      chatOpen={chatOpen}
      join={join}
      onLeave={onLeave}
      onEnded={() => setForcedEnded(true)}
      onOverlay={setOverlay}
      onUnreadChange={onUnreadChange ?? (() => undefined)}
      video={video}
    />
  ) : (
    <PendingChat />
  );

  return (
    <TooltipProvider>
      {overlay?.ended || forcedEnded ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-md">
          <Card className="w-full max-w-sm rounded-3xl border border-border/60 bg-card/95 py-0 text-center shadow-2xl animate-in fade-in-0 zoom-in-95 duration-200 [--card-spacing:1.5rem]">
            <CardContent className="flex flex-col items-center gap-4 py-7">
              <ContentArt
                fallback={
                  <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                    <UsersIcon className="size-6 text-muted-foreground" />
                  </div>
                }
                logo={contentLogo}
                poster={contentPoster}
                title={contentTitle}
              />
              <div className="space-y-1">
                <CardTitle>{t("La sala terminó")}</CardTitle>
              </div>
              <Button className="btn-primary" onClick={onLeave}>
                {t("Volver al título")}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {children ? (
        <ResizablePanelGroup
          className="min-h-0 flex-1"
          orientation={isMobile ? "vertical" : "horizontal"}
        >
          <ResizablePanel
            className="relative min-w-0"
            defaultSize={isMobile ? "78" : "82"}
            minSize={isMobile ? "32" : "40"}
          >
            {children}

            {overlay?.needsGesture ? (
              <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-background/40 p-6 backdrop-blur-[2px]">
                <Card className="pointer-events-auto w-full max-w-sm rounded-3xl border border-border/60 bg-card/95 py-0 shadow-2xl animate-in fade-in-0 zoom-in-95 duration-200 [--card-spacing:1.5rem]">
                  <CardContent className="flex flex-col items-center gap-4 py-7 text-center">
                    <ContentArt
                      fallback={
                        <div className="flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary">
                          <PlayIcon className="size-6" />
                        </div>
                      }
                      logo={contentLogo}
                      poster={contentPoster}
                      title={contentTitle}
                    />
                    <div className="space-y-1">
                      <CardTitle>{t("Únete a la reproducción")}</CardTitle>
                      <CardDescription>
                        {t(
                          "El host ya está reproduciendo. Pulsa para sincronizarte."
                        )}
                      </CardDescription>
                    </div>
                    <Button
                      className="btn-primary gap-2"
                      data-dpad-focusable
                      onClick={overlay.resumePlayback}
                      size="lg"
                    >
                      <PlayIcon className="size-4 fill-current" />
                      {t("Unirse a la reproducción")}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {overlay && overlay.reactions.length > 0 ? (
              <div className="pointer-events-none absolute bottom-20 left-1/2 z-40 flex max-w-[80vw] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 md:bottom-6">
                {overlay.reactions.map((reaction) => (
                  <span
                    className="animate-bounce rounded-full border border-border/60 bg-card/80 px-2.5 py-1 text-xl shadow-lg backdrop-blur-md"
                    key={reaction.id}
                  >
                    {reaction.emoji}
                  </span>
                ))}
              </div>
            ) : null}
          </ResizablePanel>

          <ResizableHandle className="bg-border/70" withHandle />

          <ResizablePanel
            className="min-h-0 overflow-hidden bg-background"
            collapsedSize="0"
            collapsible
            defaultSize={isMobile ? "22" : "18"}
            maxSize={isMobile ? "68" : "55"}
            minSize={isMobile ? "22" : "18"}
            onResize={(size) => onChatOpenChange?.(size.asPercentage >= 1)}
            panelRef={chatPanelRef}
          >
            {chat}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="pointer-events-none absolute inset-0 z-30 flex justify-end bg-black/40 backdrop-blur-[2px]">
          <div className="pointer-events-auto h-full w-full max-w-sm border-border/60 border-l shadow-2xl">
            {chat}
          </div>
        </div>
      )}
    </TooltipProvider>
  );
}

/** Chat conectado: único punto donde vive `useWatchParty`. */
function WatchPartyConnectedChat({
  chatOpen,
  join,
  onEnded,
  onLeave,
  onOverlay,
  onUnreadChange,
  video,
}: {
  chatOpen: boolean;
  join: WatchJoinData;
  onEnded: () => void;
  onLeave: () => void;
  onOverlay: (state: PartyOverlayState) => void;
  onUnreadChange: (count: number) => void;
  video: HTMLVideoElement | null;
}) {
  const { t } = useTranslation();
  const party = useWatchParty({ join, video });
  const [busy, setBusy] = useState<"leave" | "end" | null>(null);
  const previousMessagesRef = useRef<number | null>(null);
  const unreadRef = useRef(0);

  useEffect(() => {
    const leaveOnUnload = () => {
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

  useEffect(() => {
    const count = party.messages.length;
    if (previousMessagesRef.current === null) {
      previousMessagesRef.current = count;
      return;
    }
    const previous = previousMessagesRef.current;
    previousMessagesRef.current = count;

    if (chatOpen) {
      unreadRef.current = 0;
      onUnreadChange(0);
      return;
    }
    if (count > previous) {
      unreadRef.current += count - previous;
      onUnreadChange(unreadRef.current);
    }
  }, [chatOpen, onUnreadChange, party.messages.length]);

  useEffect(() => {
    onOverlay({
      ended: party.ended,
      // El host no ve el aviso de "únete": si el autoplay fue bloqueado, usa
      // el botón de play del propio reproductor.
      needsGesture: party.needsGesture && !party.isHost,
      reactions: party.reactions,
      resumePlayback: party.resumePlayback,
    });
  }, [
    onOverlay,
    party.ended,
    party.isHost,
    party.needsGesture,
    party.reactions,
    party.resumePlayback,
  ]);

  const handleLeave = async () => {
    setBusy("leave");
    try {
      const response = await fetch(
        `/api/watch-rooms/${join.room.id}/leave`,
        { method: "POST" }
      ).catch(() => null);
      const data = (await response?.json().catch(() => null)) as {
        ended?: boolean;
      } | null;
      await party.disconnect();
      if (data?.ended) {
        // La sala se quedó sin miembros: se muestra el diálogo en vez de
        // sacar al usuario de golpe.
        onEnded();
        return;
      }
      onLeave();
    } finally {
      setBusy(null);
    }
  };

  const handleEnd = async () => {
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
      onEnded();
    } catch {
      toast.error(t("No se pudo terminar la sala."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <WatchPartyChat
      busy={busy}
      error={party.error}
      hostId={party.hostId}
      isHost={party.isHost}
      join={join}
      members={party.members}
      messages={party.messages}
      onEnd={handleEnd}
      onLeave={handleLeave}
      onReaction={party.sendReaction}
      onRequestSync={party.requestSync}
      onPreviewGif={party.previewGif}
      onSend={party.sendMessage}
      onSendFile={party.sendFile}
      onSendGif={party.sendGif}
      onSendVoice={party.sendVoice}
      ready={party.ready}
      sending={party.sending}
      syncStatus={party.syncStatus}
    />
  );
}

/** Skeleton del panel de chat mientras el join/la conexión están en curso. */
function PendingChat() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <div className="flex items-center gap-3 px-3 py-3">
        <Skeleton className="size-6 shrink-0 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-32 rounded-full" />
        </div>
        <Skeleton className="size-8 shrink-0 rounded-full" />
      </div>
      <Separator />
      <div className="px-3 pt-3">
        <Skeleton className="h-8 w-full rounded-full" />
      </div>
      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 px-3">
        {[0, 1, 2].map((index) => (
          <div
            className={cn(
              "flex gap-2",
              index % 2 === 0 ? "flex-row" : "flex-row-reverse"
            )}
            key={index}
          >
            <Skeleton className="size-6 shrink-0 rounded-full" />
            <Skeleton
              className={cn(
                "h-9",
                index === 0 ? "w-48" : index === 1 ? "w-56" : "w-36"
              )}
            />
          </div>
        ))}
      </div>
      <div className="p-3">
        <Skeleton className="h-10 w-full rounded-full" />
      </div>
    </div>
  );
}

/** Logo/póster del título para los diálogos de la sala. */
function ContentArt({
  fallback,
  logo,
  poster,
  title,
}: {
  fallback: ReactNode;
  logo?: string;
  poster?: string;
  title?: string;
}) {
  if (logo) {
    return (
      // biome-ignore lint/performance/noImgElement: logo externo de TMDB
      <img
        alt={title ?? ""}
        className="max-h-14 max-w-56 object-contain"
        src={logo}
      />
    );
  }
  if (poster) {
    return (
      // biome-ignore lint/performance/noImgElement: póster externo de TMDB
      <img
        alt={title ?? ""}
        className="h-24 w-16 rounded-xl object-cover shadow-lg"
        src={poster}
      />
    );
  }
  return <>{fallback}</>;
}
