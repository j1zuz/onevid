"use client";

import { StreamChat } from "stream-chat";
import { connectWatchClient } from "@/components/watch/watch-chat";
import { useTranslation } from "@/lib/onevid-i18n-context";
import {
  reactionEmoji,
  reactionType,
} from "@/lib/watch-party-reactions";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  WatchChatAttachment,
  WatchChatMessage,
  WatchChatQuotedMessage,
  WatchChatReaction,
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
    quoted_message?: {
      attachments?: unknown[];
      id?: string;
      text?: string;
      user?: { id?: string; name?: string } | null;
    } | null;
    own_reactions?: unknown[] | null;
    pinned?: boolean;
    reaction_counts?: Record<string, number> | null;
    reaction_groups?: Record<string, { count?: number }> | null;
    reactions?: unknown[];
    text?: string;
    type?: string;
    user?: {
      id?: string;
      image?: string;
      name?: string;
      onevid_avatar?: string;
    } | null;
  };
  reaction?: { message_id?: string; type?: string };
  positionSec?: number;
  playing?: boolean;
  /** Marca de tiempo del host al emitir el evento (evita depender de created_at). */
  sentAt?: number;
  userId?: string;
  user?: { id?: string; name?: string; online?: boolean };
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

/**
 * Reacciones de un mensaje. La doc de Stream recomienda `reaction_groups` +
 * `own_reactions` en implementaciones propias (y no `reaction_counts`, que está
 * deprecado). `reactions` queda como último recurso para payloads antiguos.
 */
function toReactions(
  message: NonNullable<StreamEventLike["message"]>
): WatchChatReaction[] {
  const ownTypes = new Set(
    (Array.isArray(message.own_reactions) ? message.own_reactions : [])
      .map((reaction) =>
        reaction && typeof reaction === "object"
          ? stringField(reaction as Record<string, unknown>, "type")
          : undefined
      )
      .filter((type): type is string => Boolean(type))
  );

  const groups = message.reaction_groups ?? message.reaction_counts;
  if (groups && typeof groups === "object" && !Array.isArray(groups)) {
    return Object.entries(groups as Record<string, unknown>).flatMap(
      ([type, value]) => {
        const count =
          typeof value === "number"
            ? value
            : typeof value === "object" && value
              ? Number((value as { count?: unknown }).count) || 0
              : 0;
        return count > 0
          ? [{ emoji: reactionEmoji(type), count, mine: ownTypes.has(type) }]
          : [];
      }
    );
  }

  if (!Array.isArray(message.reactions)) {
    return [];
  }
  const byType = new Map<string, number>();
  for (const item of message.reactions) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const type = stringField(item as Record<string, unknown>, "type");
    if (type) {
      byType.set(type, (byType.get(type) ?? 0) + 1);
    }
  }
  return [...byType].map(([type, count]) => ({
    emoji: reactionEmoji(type),
    count,
    mine: ownTypes.has(type),
  }));
}

function toQuotedMessage(
  raw: NonNullable<StreamEventLike["message"]>["quoted_message"]
): WatchChatQuotedMessage | null {
  if (!raw || typeof raw !== "object" || !raw.id) {
    return null;
  }
  return {
    id: raw.id,
    text: raw.text ?? "",
    userName: raw.user?.name ?? raw.user?.id ?? "",
    hasAttachment: Array.isArray(raw.attachments) && raw.attachments.length > 0,
  };
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
    reactions: toReactions(message),
    quoted: toQuotedMessage(message.quoted_message),
    pinned: message.pinned === true,
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
      // Presencia de Stream: `null` cuando la app no la expone.
      online:
        typeof member.user?.online === "boolean" ? member.user.online : null,
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
  const [kicked, setKicked] = useState(false);
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
  // Última posición conocida del host. `resumePlayback` la usa para arrancar
  // ya sincronizado aunque el usuario pulse el botón antes de que llegue un
  // heartbeat nuevo.
  const latestSyncRef = useRef<{
    at: number;
    playing: boolean;
    positionSec: number;
    rate: number;
  } | null>(null);
  // El usuario pidió reproducir y el <video> todavía no estaba montado. El
  // efecto de abajo reintenta en cuanto aparece.
  const resumeRequestedRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactionIdRef = useRef(0);

  useEffect(() => {
    videoRef.current = video;
  }, [video]);

  const serverNow = useCallback(() => Date.now() + serverOffsetRef.current, []);

  /**
   * Arranca la reproducción en la última posición conocida del host. Se llama
   * desde el botón "Unirse" (gesto de usuario) y, si el <video> aún no existía,
   * en cuanto se monta. El overlay se oculta de inmediato: esperar a que
   * resuelva `play()` hacía que el clic pareciera no hacer nada en conexiones
   * lentas o mientras el navegador preparaba el buffer.
   */
  const playFromLatestSync = useCallback(
    (player: HTMLVideoElement) => {
      const sync = latestSyncRef.current;
      applyingUntilRef.current = Date.now() + 1500;
      if (sync) {
        const elapsed = Math.max(0, (serverNow() - sync.at) / 1000);
        const expected =
          sync.positionSec + (sync.playing ? elapsed * sync.rate : 0);
        try {
          player.playbackRate = sync.rate;
        } catch {
          /* velocidad no soportada en este navegador */
        }
        try {
          player.currentTime = Math.max(0, expected);
        } catch {
          /* el <video> aún no tiene metadata; el heartbeat lo corrige */
        }
        // El host está en pausa: no arrancamos nada, solo quitamos la tarjeta.
        if (!sync.playing) {
          player.pause();
          resumeRequestedRef.current = false;
          setNeedsGesture(false);
          return;
        }
      }
      setNeedsGesture(false);
      const attempt = player.play();
      if (attempt && typeof attempt.then === "function") {
        void attempt
          .then(() => {
            resumeRequestedRef.current = false;
            setNeedsGesture(false);
          })
          .catch(() => {
            // Si sigue bloqueado o no puede reproducir, se vuelve a mostrar la
            // tarjeta para reintentar con otro gesto. Se comprueba un instante
            // después: un `play()` cancelado por un seek/heartbeat no debe
            // tapar la reproducción que sí arrancó.
            window.setTimeout(() => {
              if (player.paused) {
                setNeedsGesture(true);
              }
            }, 700);
          });
      }
    },
    [serverNow]
  );

  // Si el usuario pulsó "Unirse" antes de que el player publicara el <video>,
  // reintenta en cuanto esté disponible en vez de dejar el overlay colgado.
  useEffect(() => {
    if (video && resumeRequestedRef.current) {
      resumeRequestedRef.current = false;
      playFromLatestSync(video);
    }
  }, [playFromLatestSync, video]);

  /**
   * Reemplaza solo la lista de reacciones de un mensaje. Los eventos y la
   * respuesta de Stream no siempre traen el mensaje completo (a veces solo id y
   * `reactions`), así que no se puede rehacer el mensaje entero.
   */
  const applyReactions = useCallback(
    (message: NonNullable<StreamEventLike["message"]>) => {
      if (!message.id) {
        return;
      }
      const reactions = toReactions(message);
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id ? { ...item, reactions } : item
        )
      );
    },
    []
  );

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
      // `sentAt` viene en el payload custom; `created_at` se pierde porque
      // Stream entrega el evento dentro de `custom`. Sin esto se calculaba un
      // elapsed de 0 y cada heartbeat podía corregir la posición de golpe.
      const eventAt =
        Number(event.sentAt) ||
        Date.parse(event.created_at ?? "") ||
        serverNow();
      const elapsed = Math.max(0, (serverNow() - eventAt) / 1000);
      const expected = positionSec + (playing ? elapsed * rate : 0);
      const drift = player.currentTime - expected;

      latestSyncRef.current = {
        at: serverNow(),
        playing,
        positionSec: expected,
        rate,
      };
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
            .catch(() => {
              window.setTimeout(() => {
                if (player.paused) {
                  setNeedsGesture(true);
                }
              }, 700);
            });
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
      // Reacciones: del evento solo nos interesan sus reacciones, no el mensaje
      // entero (puede venir incompleto).
      const onReaction = (event: StreamEventLike) => {
        if (event.message) {
          applyReactions(event.message);
        }
      };
      on("reaction.new", onReaction);
      on("reaction.updated", onReaction);
      on("reaction.deleted", onReaction);
      const refreshMembers = () => setMembers(toMembers(nextChannel, t("Espectador")));
      on("member.added", refreshMembers);
      on("member.removed", refreshMembers);
      on("member.updated", refreshMembers);
      // Presencia en vivo: el evento trae el usuario ya actualizado.
      on("user.presence.changed", (rawEvent) => {
        const event = eventPayload(rawEvent);
        const user = event.user;
        if (!(user?.id && typeof user.online === "boolean")) {
          return;
        }
        setMembers((current) =>
          current.map((member) =>
            member.userId === user.id
              ? { ...member, online: user.online === true }
              : member
          )
        );
      });

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
      on("watch_kick", (rawEvent) => {
        const event = eventPayload(rawEvent);
        if (event.userId !== join.userId) {
          return;
        }
        // Expulsado: se corta el sync y el reproductor se cierra en la sala.
        endedRef.current = true;
        setKicked(true);
      });
      on("watch_reaction", (rawEvent) => {
        const event = eventPayload(rawEvent);
        if (event.emoji && event.userId !== join.userId) {
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
    applyReactions,
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

    latestSyncRef.current = {
      at: serverNow(),
      playing: state.playing,
      positionSec: expected,
      rate: state.rate,
    };
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

  const sendMessage = useCallback(
    async (text: string, quotedMessageId?: string) => {
      const channel = channelRef.current;
      const trimmed = text.trim();
      if (!(channel && trimmed)) {
        return false;
      }
      setSending(true);
      try {
        let response;
        try {
          response = await channel.sendMessage({
            text: trimmed,
            ...(quotedMessageId
              ? { quoted_message_id: quotedMessageId }
              : {}),
          });
        } catch (error) {
          // Si el canal no admite respuestas citadas, el mensaje no se pierde:
          // se envía suelto.
          if (!quotedMessageId) {
            throw error;
          }
          response = await channel.sendMessage({ text: trimmed });
        }
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

  /**
   * Alterna una reacción del usuario actual en un mensaje. El estado no se toca
   * a mano: Stream devuelve el mensaje actualizado y llega también por
   * `reaction.new` / `reaction.deleted`.
   */
  const toggleReaction = useCallback(
    async (messageId: string, emoji: string, alreadyReacted: boolean) => {
      const channel = channelRef.current;
      if (!channel) {
        return false;
      }
      const type = reactionType(emoji);
      try {
        const response = alreadyReacted
          ? await channel.deleteReaction(messageId, type)
          : await channel.sendReaction(messageId, { type });
        // Se pinta ya con la respuesta y no solo con el evento: así el chip
        // aparece aunque la sala tarde en reenviar `reaction.new`.
        if (response.message) {
          applyReactions(response.message as never);
        }
        return true;
      } catch (error) {
        console.error("[watch-party] no se pudo reaccionar", error);
        toast.error(t("No se pudo reaccionar."));
        return false;
      }
    },
    [applyReactions, t]
  );

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

  /**
   * Fija o desfija un mensaje (`client.pinMessage`/`unpinMessage`). El estado se
   * actualiza al momento y el servidor confirma con `message.updated`.
   */
  const togglePin = useCallback(
    async (messageId: string, pinned: boolean) => {
      const client = clientRef.current;
      if (!client) {
        return false;
      }
      try {
        if (pinned) {
          await client.unpinMessage(messageId);
        } else {
          await client.pinMessage(messageId);
        }
        setMessages((current) =>
          current.map((item) =>
            item.id === messageId ? { ...item, pinned: !pinned } : item
          )
        );
        return true;
      } catch (error) {
        console.error("[watch-party] no se pudo fijar el mensaje", error);
        return false;
      }
    },
    []
  );

  /** Solo el host: saca a un participante de la sala. */
  const kickMember = useCallback(
    async (userId: string) => {
      try {
        const response = await fetch(
          `/api/watch-rooms/${join.room.id}/kick`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId }),
          }
        );
        return response.ok;
      } catch {
        return false;
      }
    },
    [join.room.id]
  );

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
    // Pedir al host un estado fresco: si el usuario pulsó antes del primer
    // heartbeat, la posición conocida puede ser la del join.
    void channelRef.current
      ?.sendEvent({
        type: "watch_request",
      } as unknown as Parameters<StreamChannel["sendEvent"]>[0])
      .catch(() => undefined);
    setNeedsGesture(false);
    const player = videoRef.current;
    if (!player) {
      // El player todavía no está montado: el efecto de `video` reintenta.
      resumeRequestedRef.current = true;
      return;
    }
    resumeRequestedRef.current = false;
    playFromLatestSync(player);
  }, [playFromLatestSync]);

  const sendReaction = useCallback(
    (emoji: string) => {
      // Se pinta aquí y se avisa a la sala. El evento vuelve también al emisor,
      // así que se marca con `userId` para no animarlo dos veces.
      addReaction(emoji);
      void channelRef.current
        ?.sendEvent({
          type: "watch_reaction",
          emoji,
          userId: join.userId,
        } as unknown as Parameters<StreamChannel["sendEvent"]>[0])
        .catch(() => undefined);
    },
    [addReaction, join.userId]
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
    kicked,
    kickMember,
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
    togglePin,
    toggleReaction,
  };
}
