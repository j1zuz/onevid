import type { Channel } from 'stream-chat';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  connectWatchClient,
  toChatMessage,
  toMembers,
  upsertMessage,
  type WatchChatMessage,
  type WatchJoinData,
  type WatchMember,
  type WatchSyncAction,
} from '@/lib/watch-party';

type StreamUser = {
  id?: string;
  name?: string;
  image?: string;
  onevid_avatar?: string;
};

type StreamMessage = {
  id?: string;
  text?: string;
  created_at?: string | Date;
  user?: StreamUser | null;
};

type StreamEventLike = {
  custom?: unknown;
  message?: StreamMessage;
  user?: StreamUser;
  action?: string;
  positionSec?: number;
  playing?: boolean;
  rate?: number;
  hostId?: string;
  sentAt?: number;
  userId?: string;
};

export interface RemoteSync {
  action: WatchSyncAction;
  hostId: string;
  playing: boolean;
  positionSec: number;
  rate: number;
  sentAt: number;
}

/** Los custom events de Stream llegan con el payload en la raíz o en `custom`. */
function payloadOf(event: StreamEventLike): StreamEventLike {
  return (event.custom as StreamEventLike) ?? event;
}

/**
 * Estado de la watch party en la app: chat, miembros y sincronización.
 *
 * El servidor sigue mandando (miembros, estado, cierre); Stream solo transporta
 * mensajes y los eventos `watch_sync` / `watch_request`. Quien reproduce
 * (host) publica su posición; los demás la aplican en su propio reproductor.
 */
export function useWatchPartyChat({
  enabled,
  fallbackName,
  join,
  onRemoteSync,
  onSyncRequest,
}: {
  enabled: boolean;
  fallbackName: string;
  join: WatchJoinData | null;
  onRemoteSync?: (sync: RemoteSync) => void;
  onSyncRequest?: () => void;
}) {
  const [messages, setMessages] = useState<WatchChatMessage[]>([]);
  const [members, setMembers] = useState<WatchMember[]>([]);
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<Channel | null>(null);
  const channelId = join?.channelId;

  // Los callbacks cambian en cada render del reproductor; los guardamos en refs
  // para no reconectar el WebSocket por eso.
  const remoteSyncRef = useRef(onRemoteSync);
  const syncRequestRef = useRef(onSyncRequest);
  useEffect(() => {
    remoteSyncRef.current = onRemoteSync;
    syncRequestRef.current = onSyncRequest;
  }, [onRemoteSync, onSyncRequest]);

  useEffect(() => {
    if (!enabled || !join || !channelId) return;
    let cancelled = false;
    const subscriptions: ({ unsubscribe?: () => void } | (() => void))[] = [];

    async function run() {
      try {
        const client = await connectWatchClient(join as WatchJoinData);
        if (cancelled) return;

        const channel = client.channel(join!.channelType, join!.channelId);
        await channel.watch();
        if (cancelled) {
          await channel.stopWatching().catch(() => undefined);
          return;
        }
        channelRef.current = channel;

        setMessages(
          channel.state.messages
            .map((message) => toChatMessage(message, fallbackName))
            .filter((message): message is WatchChatMessage => message !== null),
        );
        setMembers(toMembers(channel.state.members, fallbackName));
        setReady(true);

        const on = (event: string, handler: (payload: StreamEventLike) => void) => {
          subscriptions.push(
            channel.on(event as never, handler as never) as unknown as {
              unsubscribe: () => void;
            },
          );
        };

        const onMessage = (event: StreamEventLike) => {
          if (!event.message) return;
          const message = toChatMessage(event.message, fallbackName);
          if (!message) return;
          setMessages((current) => {
            const exists = current.some((item) => item.id === message.id);
            if (!exists && !current.length) return current;
            return exists ? upsertMessage(current, message) : [...current, message];
          });
        };

        // Reacciones: el evento no trae el mensaje completo, así que releemos la
        // copia del canal (Stream ya la actualizó).
        const onReaction = (event: StreamEventLike) => {
          const id = event.message?.id;
          if (!id) return;
          const fresh = channel.state.messages.find((item) => item.id === id);
          if (!fresh) return;
          const mapped = toChatMessage(fresh, fallbackName);
          if (mapped) setMessages((current) => upsertMessage(current, mapped));
        };
        on('reaction.new', onReaction);
        on('reaction.updated', onReaction);
        on('reaction.deleted', onReaction);

        on('message.new', onMessage);
        on('message.updated', onMessage);
        on('message.deleted', (event) => {
          const id = event.message?.id;
          if (id) setMessages((current) => current.filter((m) => m.id !== id));
        });

        on('watch_sync', (event) => {
          const payload = payloadOf(event);
          // Ignorar el eco del propio host.
          if (!payload.hostId || payload.hostId === join!.userId) return;
          remoteSyncRef.current?.({
            action: (payload.action as WatchSyncAction) ?? 'heartbeat',
            hostId: payload.hostId,
            playing: payload.playing === true,
            positionSec: Number(payload.positionSec) || 0,
            rate: Number(payload.rate) || 1,
            sentAt: Number(payload.sentAt) || Date.now(),
          });
        });

        // Un invitado pide el estado; el host responde con su `watch_sync`.
        on('watch_request', (event) => {
          const payload = payloadOf(event);
          if (payload.userId === join!.userId) return;
          syncRequestRef.current?.();
        });

        on('watch_end', () => {
          setError('La sala terminó.');
        });

        const refreshMembers = () =>
          setMembers(toMembers(channel.state.members, fallbackName));
        on('member.added', refreshMembers);
        on('member.removed', refreshMembers);
        on('member.updated', refreshMembers);
        on('user.presence.changed', refreshMembers);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : 'No se pudo conectar el chat de la sala.',
          );
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
      channelRef.current = null;
      setReady(false);
      for (const subscription of subscriptions) {
        if (typeof subscription === 'function') subscription();
        else subscription.unsubscribe?.();
      }
    };
  }, [channelId, enabled, fallbackName, join]);

  const sendMessage = useCallback(
    async (text: string): Promise<boolean> => {
      const channel = channelRef.current;
      const body = text.trim();
      if (!channel || !body || sending) return false;
      setSending(true);
      try {
        await channel.sendMessage({ text: body });
        return true;
      } catch {
        return false;
      } finally {
        setSending(false);
      }
    },
    [sending],
  );

  const sendSync = useCallback(
    (action: WatchSyncAction, positionSec: number, playing: boolean) => {
      if (!join) return;
      void channelRef.current
        ?.sendEvent({
          type: 'watch_sync',
          action,
          hostId: join.userId,
          playing,
          positionSec,
          rate: 1,
          sentAt: Date.now(),
        } as never)
        .catch(() => undefined);
    },
    [join],
  );

  const requestSync = useCallback(
    (userId: string) => {
      void channelRef.current
        ?.sendEvent({ type: 'watch_request', userId } as never)
        .catch(() => undefined);
    },
    [],
  );

  /** Alterna una reacción del usuario en un mensaje. */
  const toggleReaction = useCallback(
    async (messageId: string, emoji: string, mine: boolean) => {
      const channel = channelRef.current;
      if (!channel) return;
      try {
        if (mine) await channel.deleteReaction(messageId, emoji);
        else await channel.sendReaction(messageId, { type: emoji });
      } catch {
        /* la reacción se recupera con el siguiente evento */
      }
    },
    [],
  );

  /** Sube imágenes y las envía como mensaje con adjuntos. */
  const sendImages = useCallback(
    async (
      files: { uri: string; name: string; type: string }[],
    ): Promise<boolean> => {
      const channel = channelRef.current;
      if (!channel || files.length === 0 || sending) return false;
      setSending(true);
      try {
        const attachments = [];
        for (const file of files) {
          const uploaded = await channel.sendImage(
            file.uri,
            file.name,
            file.type,
          );
          const url = (uploaded as { file?: string }).file;
          if (url) {
            attachments.push({
              asset_url: url,
              image_url: url,
              type: 'image',
            });
          }
        }
        if (attachments.length === 0) return false;
        await channel.sendMessage({ attachments, text: '' });
        return true;
      } catch {
        return false;
      } finally {
        setSending(false);
      }
    },
    [sending],
  );

  const leave = useCallback(async () => {
    await channelRef.current?.stopWatching().catch(() => undefined);
  }, []);

  return {
    error,
    leave,
    members,
    messages,
    ready,
    requestSync,
    sendImages,
    sendMessage,
    sendSync,
    sending,
    toggleReaction,
  };
}
