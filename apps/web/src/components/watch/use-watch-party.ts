"use client";

import { StreamChat } from "stream-chat";
import { connectWatchClient } from "@/components/watch/watch-chat";
import { useTranslation } from "@/lib/onevid-i18n-context";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WatchChatAttachment,
  WatchChatMessage,
  WatchJoinData,
  WatchMember,
  WatchSyncAction,
} from "@/lib/watch-party-types";

type StreamChannel = ReturnType<StreamChat["channel"]>;

type StreamEventLike = {
  action?: string;
  created_at?: string;
  custom?: StreamEventLike;
  emoji?: string;
  hostId?: string;
  message?: {
    attachments?: unknown[];
    created_at?: string | Date;
    id?: string;
    text?: string;
    type?: string;
    user?: {
      id?: string;
      image?: string;
      name?: string;
      onevid_avatar?: string;
    } | null;
  };
  positionSec?: number;
  playing?: boolean;
  rate?: number;
  type?: string;
};

/** Los custom events de Stream pueden venir con el payload en la raíz o en `custom`. */
function eventPayload(event: StreamEventLike): StreamEventLike {
  return event.custom ?? event;
}

type Reaction = { emoji: string; id: number };

function stringField(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function toAttachments(raw: unknown): WatchChatAttachment[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const attachment = item as Record<string, unknown>;
    const type = stringField(attachment, "type");
    if (!type) {
      return [];
    }
    return [
      {
        type,
        asset_url: stringField(attachment, "asset_url"),
        image_url: stringField(attachment, "image_url"),
        thumb_url: stringField(attachment, "thumb_url"),
        title: stringField(attachment, "title"),
        duration:
          typeof attachment.duration === "number"
            ? attachment.duration
            : undefined,
        giphy:
          attachment.giphy && typeof attachment.giphy === "object"
            ? (attachment.giphy as WatchChatAttachment["giphy"])
            : undefined,
      },
    ];
  });
}

function toChatMessage(
  message: NonNullable<StreamEventLike["message"]>
): WatchChatMessage | null {
  if (!message.id) {
    return null;
  }
  if (message.type && message.type !== "regular") {
    return null;
  }
  const attachments = toAttachments(message.attachments);
  const text = message.text ?? "";
  // Los GIFs y las notas de voz llegan como mensajes sin texto.
  if (!(text || attachments.length > 0)) {
    return null;
  }
  const userId = message.user?.id ?? "desconocido";
  const createdAt =
    message.created_at instanceof Date
      ? message.created_at.toISOString()
      : (message.created_at ?? new Date().toISOString());
  return {
    id: message.id,
    text,
    userId,
    userName: message.user?.name ?? userId,
    userImage: message.user?.image ?? null,
    avatar: message.user?.onevid_avatar ?? null,
    attachments,
    createdAt,
  };
}

function toMembers(
  channel: StreamChannel,
  fallbackName: string
): WatchMember[] {
  return Object.values(channel.state.members ?? {})
    .map((member) => ({
      userId: member.user?.id ?? "",
      name: member.user?.name ?? member.user?.id ?? fallbackName,
      image: member.user?.image ?? null,
      avatar:
        (member.user as { onevid_avatar?: string } | null | undefined)
          ?.onevid_avatar ?? null,
    }))
    .filter((member) => member.userId);
}

function upsertMessage(
  list: WatchChatMessage[],
  message: WatchChatMessage
): WatchChatMessage[] {
  const index = list.findIndex((item) => item.id === message.id);
  if (index === -1) {
    return [...list, message].slice(-200);
  }
  const next = [...list];
  next[index] = message;
  return next;
}

export function useWatchParty({
  join,
  video,
}: {
  join: WatchJoinData;
  video: HTMLVideoElement | null;
}) {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(join.room.status !== "open");
  const [isHost, setIsHost] = useState(join.isHost);
  const [hostId, setHostId] = useState(join.room.hostUserId);
  const [messages, setMessages] = useState<WatchChatMessage[]>([]);
  const [members, setMembers] = useState<WatchMember[]>([]);
  const [sending, setSending] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"synced" | "drifting">("synced");
  const [reactions, setReactions] = useState<Reaction[]>([]);

  const videoRef = useRef<HTMLVideoElement | null>(video);
  const clientRef = useRef<StreamChat | null>(null);
  const channelRef = useRef<StreamChannel | null>(null);
  const isHostRef = useRef(join.isHost);
  const endedRef = useRef(join.room.status !== "open");
  const serverOffsetRef = useRef(join.serverTime - Date.now());
  const applyingUntilRef = useRef(0);
  const initialAppliedRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactionIdRef = useRef(0);

  useEffect(() => {
    videoRef.current = video;
  }, [video]);

  const serverNow = useCallback(() => Date.now() + serverOffsetRef.current, []);

  const addReaction = useCallback((emoji: string) => {
    reactionIdRef.current += 1;
    const id = reactionIdRef.current;
    setReactions((current) => [...current, { id, emoji }].slice(-12));
    window.setTimeout(() => {
      setReactions((current) => current.filter((item) => item.id !== id));
    }, 2200);
  }, []);

  const sendSyncEvent = useCallback(
    (action: WatchSyncAction) => {
      const channel = channelRef.current;
      const player = videoRef.current;
      if (!channel || !player) {
        return;
      }
      void channel
        .sendEvent({
          type: "watch_sync",
          action,
          positionSec: player.currentTime,
          playing: !player.paused,
          rate: player.playbackRate,
          hostId: join.userId,
          sentAt: serverNow(),
        } as unknown as Parameters<StreamChannel["sendEvent"]>[0])
        .catch(() => {
          /* un evento perdido se recupera con el siguiente heartbeat */
        });
    },
    [join.userId, serverNow]
  );

  const persistState = useCallback(
    (player: HTMLVideoElement) => {
      if (persistTimerRef.current !== null) {
        clearTimeout(persistTimerRef.current);
      }
      persistTimerRef.current = setTimeout(() => {
        void fetch(`/api/watch-rooms/${join.room.id}/state`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            positionSec: player.currentTime,
            playing: !player.paused,
            rate: player.playbackRate,
          }),
        }).catch(() => {
          /* el heartbeat mantiene la sala viva aunque falle un guardado */
        });
      }, 500);
    },
    [join.room.id]
  );

  const applyRemote = useCallback(
    (rawEvent: StreamEventLike) => {
      const event = eventPayload(rawEvent);
      const player = videoRef.current;
      if (!player || isHostRef.current || endedRef.current) {
        return;
      }

      const positionSec = Number(event.positionSec) || 0;
      const playing = event.playing === true;
      const rate = Number(event.rate) || 1;
      const eventAt = Date.parse(event.created_at ?? "") || serverNow();
      const elapsed = Math.max(0, (serverNow() - eventAt) / 1000);
      const expected = positionSec + (playing ? elapsed * rate : 0);
      const drift = player.currentTime - expected;

      applyingUntilRef.current = Date.now() + 1000;

      if (Math.abs(player.playbackRate - rate) > 0.01) {
        try {
          player.playbackRate = rate;
        } catch {
          /* algunos navegadores limitan playbackRate */
        }
      }

      if (event.action === "seek" || Math.abs(drift) > 1.5) {
        try {
          player.currentTime = Math.max(0, expected);
        } catch {
          /* el player puede no estar listo para seek todavía */
        }
      }

      if (playing) {
        if (player.paused) {
          void player
            .play()
            .then(() => setNeedsGesture(false))
            .catch(() => setNeedsGesture(true));
        }
      } else if (!player.paused) {
        player.pause();
      }

      setSyncStatus(Math.abs(drift) > 2.5 ? "drifting" : "synced");
    },
    [serverNow]
  );

  useEffect(() => {
    let cancelled = false;
    const client = StreamChat.getInstance(join.apiKey);
    clientRef.current = client;
    let channel: StreamChannel | null = null;
    const subscriptions: Array<
      { unsubscribe: () => void } | (() => void)
    > = [];

    const on = (event: string, handler: (event: StreamEventLike) => void) => {
      if (!channel) {
        return;
      }
      const subscription = channel.on(
        event as never,
        handler as never
      ) as unknown as { unsubscribe: () => void } | (() => void);
      subscriptions.push(subscription);
    };

    const run = async () => {
      const connectedClient = await connectWatchClient(join);
      clientRef.current = connectedClient;
      if (cancelled) {
        return;
      }

      const nextChannel = connectedClient.channel(
        join.channelType,
        join.channelId
      );
      channel = nextChannel;
      channelRef.current = nextChannel;

      await nextChannel.watch();
      if (cancelled) {
        await nextChannel.stopWatching().catch(() => undefined);
        return;
      }

      setMessages(
        nextChannel.state.messages
          .map((message) => toChatMessage(message))
          .filter((message): message is WatchChatMessage => message !== null)
      );
      setMembers(toMembers(nextChannel, t("Espectador")));

      on("message.new", (event) => {
        if (!event.message) {
          return;
        }
        const message = toChatMessage(event.message);
        if (message) {
          setMessages((current) => upsertMessage(current, message));
        }
      });
      on("message.updated", (event) => {
        if (!event.message) {
          return;
        }
        const message = toChatMessage(event.message);
        if (message) {
          setMessages((current) => upsertMessage(current, message));
        }
      });
      on("message.deleted", (event) => {
        const id = event.message?.id;
        if (id) {
          setMessages((current) => current.filter((item) => item.id !== id));
        }
      });
      const refreshMembers = () => setMembers(toMembers(nextChannel, t("Espectador")));
      on("member.added", refreshMembers);
      on("member.removed", refreshMembers);
      on("member.updated", refreshMembers);

      on("watch_sync", applyRemote);
      on("watch_request", () => {
        if (isHostRef.current) {
          sendSyncEvent("heartbeat");
        }
      });
      on("watch_host", (rawEvent) => {
        const event = eventPayload(rawEvent);
        if (!event.hostId) {
          return;
        }
        setHostId(event.hostId);
        const nextIsHost = event.hostId === join.userId;
        isHostRef.current = nextIsHost;
        setIsHost(nextIsHost);
      });
      on("watch_end", () => {
        endedRef.current = true;
        setEnded(true);
      });
      on("watch_reaction", (rawEvent) => {
        const event = eventPayload(rawEvent);
        if (event.emoji) {
          addReaction(event.emoji);
        }
      });

      setReady(true);
    };

    run().catch((cause) => {
      if (!cancelled) {
        console.error("[watch-party] No se pudo conectar", cause);
        setError(t("No se pudo conectar con la sala."));
      }
    });

    return () => {
      cancelled = true;
      for (const subscription of subscriptions) {
        if (typeof subscription === "function") {
          subscription();
        } else {
          subscription.unsubscribe();
        }
      }
      void channel?.stopWatching().catch(() => undefined);
    };
  }, [
    addReaction,
    applyRemote,
    join.apiKey,
    join.channelId,
    join.channelType,
    join.token,
    join.userAvatar,
    join.userId,
    join.userImage,
    join.userName,
    sendSyncEvent,
    t,
  ]);

  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  useEffect(() => {
    const player = video;
    if (!(player && ready) || initialAppliedRef.current) {
      return;
    }
    initialAppliedRef.current = true;
    const state = join.state;
    const updatedAt = Date.parse(state.updatedAt) || Date.now();
    const elapsed = Math.max(0, (serverNow() - updatedAt) / 1000);
    const expected =
      state.positionSec + (state.playing ? elapsed * state.rate : 0);

    applyingUntilRef.current = Date.now() + 1200;
    try {
      player.playbackRate = state.rate;
    } catch {
      /* velocidad no soportada en este navegador */
    }
    try {
      player.currentTime = Math.max(0, expected);
    } catch {
      /* el <video> aún no tiene metadata; el heartbeat lo corrige */
    }
    if (state.playing) {
      void player.play().catch(() => setNeedsGesture(true));
    } else {
      player.pause();
    }
  }, [join.state, ready, serverNow, video]);

  useEffect(() => {
    const player = video;
    if (!(player && ready && isHost)) {
      return;
    }
    const emit = (action: WatchSyncAction) => {
      if (Date.now() < applyingUntilRef.current) {
        return;
      }
      sendSyncEvent(action);
      persistState(player);
    };
    const onPlay = () => emit("play");
    const onPause = () => emit("pause");
    const onSeeked = () => emit("seek");
    const onRateChange = () => emit("rate");

    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("seeked", onSeeked);
    player.addEventListener("ratechange", onRateChange);

    return () => {
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("seeked", onSeeked);
      player.removeEventListener("ratechange", onRateChange);
    };
  }, [isHost, persistState, ready, sendSyncEvent, video]);

  useEffect(() => {
    const player = video;
    if (!(player && ready && isHost)) {
      return;
    }
    const timer = window.setInterval(() => {
      sendSyncEvent("heartbeat");
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isHost, ready, sendSyncEvent, video]);

  useEffect(
    () => () => {
      if (persistTimerRef.current !== null) {
        clearTimeout(persistTimerRef.current);
      }
    },
    []
  );

  const sendMessage = useCallback(async (text: string) => {
    const channel = channelRef.current;
    const trimmed = text.trim();
    if (!(channel && trimmed)) {
      return false;
    }
    setSending(true);
    try {
      const response = await channel.sendMessage({ text: trimmed });
      const message = toChatMessage(response.message);
      if (message) {
        setMessages((current) => upsertMessage(current, message));
      }
      return true;
    } catch {
      return false;
    } finally {
      setSending(false);
    }
  }, []);

  const sendVoice = useCallback(
    async (blob: Blob, durationSec: number) => {
      const channel = channelRef.current;
      if (!channel) {
        return false;
      }
      setSending(true);
      try {
        const contentType = blob.type.split(";")[0] || "audio/webm";
        const extension = contentType.includes("mp4")
          ? "m4a"
          : contentType.includes("ogg")
            ? "ogg"
            : "webm";
        const file = new File([blob], `voice-${Date.now()}.${extension}`, {
          type: contentType,
        });
        const uploaded = await channel.sendFile(
          file,
          file.name,
          file.type
        );
        const response = await channel.sendMessage({
          attachments: [
            {
              type: "voice",
              asset_url: uploaded.file,
              duration: Math.max(1, Math.round(durationSec)),
            },
          ],
        } as unknown as Parameters<StreamChannel["sendMessage"]>[0]);
        const message = toChatMessage(response.message);
        if (message) {
          setMessages((current) => upsertMessage(current, message));
        }
        return true;
      } catch {
        return false;
      } finally {
        setSending(false);
      }
    },
    []
  );

  const sendFile = useCallback(async (file: File) => {
    const channel = channelRef.current;
    if (!channel) {
      return false;
    }
    setSending(true);
    try {
      const uploaded = await channel.sendFile(file, file.name, file.type);
      const isImage = file.type.startsWith("image/");
      const response = await channel.sendMessage({
        attachments: [
          {
            type: isImage ? "image" : "file",
            asset_url: uploaded.file,
            image_url: isImage ? uploaded.file : undefined,
            thumb_url: isImage ? uploaded.file : undefined,
            title: file.name,
          },
        ],
      } as unknown as Parameters<StreamChannel["sendMessage"]>[0]);
      const message = toChatMessage(response.message);
      if (message) {
        setMessages((current) => upsertMessage(current, message));
      }
      return true;
    } catch {
      return false;
    } finally {
      setSending(false);
    }
  }, []);

  /**
   * Pide el GIF al comando `/giphy` sin publicarlo. Stream responde con un
   * mensaje efímero (solo lo ve quien lo pide); devolvemos sus adjuntos para
   * enseñar el preview y enviarlo después como mensaje normal.
   */
  const previewGif = useCallback(async (query: string) => {
    const channel = channelRef.current;
    const trimmed = query.trim();
    if (!(channel && trimmed)) {
      return null;
    }
    setSending(true);
    try {
      const command = await channel.sendMessage({
        text: `/giphy ${trimmed}`,
      } as unknown as Parameters<StreamChannel["sendMessage"]>[0]);
      return command.message.attachments ?? null;
    } catch {
      return null;
    } finally {
      setSending(false);
    }
  }, []);

  /** Publica el GIF que ya se previsualizó. */
  const sendGif = useCallback(async (attachments: unknown[]) => {
    const channel = channelRef.current;
    if (!(channel && attachments.length > 0)) {
      return false;
    }
    setSending(true);
    try {
      const response = await channel.sendMessage({
        attachments,
      } as unknown as Parameters<StreamChannel["sendMessage"]>[0]);
      const message = toChatMessage(response.message);
      if (message) {
        setMessages((current) => upsertMessage(current, message));
      }
      return true;
    } catch {
      return false;
    } finally {
      setSending(false);
    }
  }, []);

  const requestSync = useCallback(() => {
    void channelRef.current
      ?.sendEvent({
        type: "watch_request",
      } as unknown as Parameters<StreamChannel["sendEvent"]>[0])
      .catch(() => undefined);
    const player = videoRef.current;
    if (player) {
      applyingUntilRef.current = Date.now() + 1000;
    }
  }, []);

  const resumePlayback = useCallback(() => {
    const player = videoRef.current;
    if (!player) {
      return;
    }
    applyingUntilRef.current = Date.now() + 800;
    void player
      .play()
      .then(() => setNeedsGesture(false))
      .catch(() => undefined);
  }, []);

  const sendReaction = useCallback(
    (emoji: string) => {
      addReaction(emoji);
      void channelRef.current
        ?.sendEvent({
          type: "watch_reaction",
          emoji,
        } as unknown as Parameters<StreamChannel["sendEvent"]>[0])
        .catch(() => undefined);
    },
    [addReaction]
  );

  const disconnect = useCallback(async () => {
    await channelRef.current?.stopWatching().catch(() => undefined);
    if (clientRef.current?.userID) {
      await clientRef.current.disconnectUser().catch(() => undefined);
    }
  }, []);

  return {
    disconnect,
    ended,
    error,
    hostId,
    isHost,
    members,
    messages,
    needsGesture,
    reactions,
    ready,
    requestSync,
    previewGif,
    resumePlayback,
    sendFile,
    sendGif,
    sendMessage,
    sendReaction,
    sendVoice,
    sending,
    syncStatus,
  };
}
