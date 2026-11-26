import { StreamChat } from 'stream-chat';
import { apiFetch } from './api';

/**
 * Cliente de Stream Chat para la sala de "Ver juntos" en la app.
 *
 * La app solo chatea: la reproducción vive en la TV (o en la web). El servidor
 * sigue siendo el dueño de la sala (miembros, estado, cierre); aquí solo se
 * replica el chat y la lista de participantes con el mismo contrato que usa la
 * web (`/api/watch-rooms/[id]/join`).
 */

export interface WatchRoomDTO {
  id: string;
  title: string;
  contentType: 'movie' | 'series';
  status: 'open' | 'ended';
  poster: string | null;
  background: string | null;
  contentId: string;
  rawId: string;
  isAddon: boolean;
  season: number;
  episode: number;
}

export interface WatchJoinData {
  apiKey: string;
  token: string;
  userId: string;
  userName: string;
  userImage: string | null;
  userAvatar: string | null;
  channelId: string;
  channelType: string;
  room: WatchRoomDTO;
  serverTime: number;
  isHost: boolean;
}

export interface WatchChatReaction {
  emoji: string;
  count: number;
  /** El usuario actual reaccionó con este emoji. */
  mine: boolean;
}

export interface WatchChatAttachment {
  type: string;
  imageUrl?: string;
  assetUrl?: string;
  title?: string;
}

/** Emojis rápidos del chat (mismo orden que la web). */
export const WATCH_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'] as const;

export interface WatchChatMessage {
  id: string;
  text: string;
  userId: string;
  userName: string;
  userImage: string | null;
  avatar: string | null;
  createdAt: string;
  reactions: WatchChatReaction[];
  attachments: WatchChatAttachment[];
}

export type WatchSyncAction = 'play' | 'pause' | 'seek' | 'heartbeat';

export interface WatchMember {
  userId: string;
  name: string;
  image: string | null;
  avatar: string | null;
  online: boolean | null;
}

interface StreamUser {
  id?: string;
  name?: string;
  image?: string;
  onevid_avatar?: string;
  online?: boolean;
}

export class WatchJoinError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Entra (o vuelve a entrar) a la sala y devuelve el token de Stream.
 *
 * Usa `apiFetch` para mandar el Bearer, el perfil activo y el User-Agent que
 * Cloudflare deja pasar: la ruta exige sesión.
 */
export async function joinWatchRoom(roomId: string): Promise<WatchJoinData> {
  try {
    return await apiFetch<WatchJoinData>(
      `/api/watch-rooms/${encodeURIComponent(roomId)}/join`,
      { method: 'POST' },
    );
  } catch (e) {
    throw new WatchJoinError(
      e instanceof Error ? e.message : 'No se pudo entrar a la sala.',
      0,
    );
  }
}

type StreamMessage = {
  id?: string;
  text?: string;
  created_at?: string | Date;
  attachments?: {
    type?: string;
    image_url?: string;
    asset_url?: string;
    title?: string;
  }[];
  reaction_counts?: Record<string, number> | null;
  own_reactions?: { type?: string }[] | null;
  user?: {
    id?: string;
    name?: string;
    image?: string;
    onevid_avatar?: string;
  } | null;
};

/** Convierte un mensaje de Stream al modelo de la app. */
export function toChatMessage(
  message: StreamMessage,
  fallbackName: string,
): WatchChatMessage | null {
  if (!message.id) return null;
  const createdAt =
    message.created_at instanceof Date
      ? message.created_at.toISOString()
      : (message.created_at ?? new Date().toISOString());
  const own = new Set(
    (message.own_reactions ?? [])
      .map((reaction) => reaction.type)
      .filter((type): type is string => Boolean(type)),
  );
  const reactions = Object.entries(message.reaction_counts ?? {})
    .map(([emoji, count]) => ({
      count: Number(count) || 0,
      emoji,
      mine: own.has(emoji),
    }))
    .filter((reaction) => reaction.count > 0)
    .sort((a, b) => b.count - a.count);

  return {
    id: message.id,
    text: (message.text ?? '').trim(),
    userId: message.user?.id ?? '',
    userName: message.user?.name?.trim() || fallbackName,
    userImage: message.user?.image ?? null,
    avatar: message.user?.onevid_avatar ?? null,
    createdAt,
    attachments: (message.attachments ?? [])
      .map((attachment) => ({
        type: attachment.type ?? 'file',
        imageUrl: attachment.image_url,
        assetUrl: attachment.asset_url,
        title: attachment.title,
      }))
      .filter((attachment) => attachment.imageUrl || attachment.assetUrl),
    reactions,
  };
}

/** Une mensajes sin duplicar (eventos y estado inicial pueden solaparse). */
export function upsertMessage(
  list: WatchChatMessage[],
  next: WatchChatMessage,
): WatchChatMessage[] {
  const index = list.findIndex((item) => item.id === next.id);
  if (index === -1) return [...list, next].sort(byCreatedAt);
  const copy = [...list];
  copy[index] = next;
  return copy.sort(byCreatedAt);
}

function byCreatedAt(a: WatchChatMessage, b: WatchChatMessage): number {
  return a.createdAt.localeCompare(b.createdAt);
}

/** Miembros de la sala a partir del estado del canal (Stream los indexa por id). */
export function toMembers(
  members:
    | Record<string, { user?: StreamUser | null }>
    | { user?: StreamUser | null }[],
  fallbackName: string,
): WatchMember[] {
  const list = Array.isArray(members) ? members : Object.values(members);
  return list
    .map((member) => member.user)
    .filter((user): user is StreamUser & { id: string } => Boolean(user?.id))
    .map((user) => ({
      userId: user.id,
      name: user.name?.trim() || fallbackName,
      image: user.image ?? null,
      avatar: user.onevid_avatar ?? null,
      online: typeof user.online === 'boolean' ? user.online : null,
    }));
}

let connecting: Promise<StreamChat> | null = null;

/**
 * Conexión única al chat. Compartir la promesa evita abrir dos WebSocket si la
 * pantalla se monta dos veces (Fast Refresh, navegación rápida).
 */
export async function connectWatchClient(
  join: WatchJoinData,
): Promise<StreamChat> {
  const client = StreamChat.getInstance(join.apiKey);
  if (client.userID === join.userId) return client;
  if (connecting) return connecting;

  if (client.userID) {
    await client.disconnectUser();
  }

  connecting = client
    .connectUser(
      {
        id: join.userId,
        name: join.userName,
        image: join.userImage ?? undefined,
        onevid_avatar: join.userAvatar ?? undefined,
      } as never,
      join.token,
    )
    .then(() => client)
    .finally(() => {
      connecting = null;
    });

  return connecting;
}
