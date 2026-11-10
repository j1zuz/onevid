import { and, eq } from "drizzle-orm";
import { type ChannelData, StreamChat } from "stream-chat";
import {
  watchRoom,
  watchRoomMember,
  watchRoomState,
} from "@/lib/auth-schema";
import { db } from "@/lib/db";
import {
  WATCH_ROOM_MAX_PARTICIPANTS,
  type WatchContentType,
  type WatchRoomDTO,
  type WatchRoomStateDTO,
} from "@/lib/watch-party-types";

export const WATCH_CHANNEL_TYPE = "team";

export type WatchRoomRow = typeof watchRoom.$inferSelect;
export type WatchRoomStateRow = typeof watchRoomState.$inferSelect;
export type WatchRoomMemberRow = typeof watchRoomMember.$inferSelect;

let cachedStreamClient: StreamChat | null = null;

/**
 * Cliente servidor de Stream Chat. Devuelve `null` si faltan credenciales para
 * que las rutas puedan responder 503 en vez de romper el build o el runtime.
 */
export function getStreamServerClient(): StreamChat | null {
  if (cachedStreamClient) {
    return cachedStreamClient;
  }
  const apiKey = process.env.STREAM_API_KEY;
  const apiSecret = process.env.STREAM_API_SECRET;
  if (!(apiKey && apiSecret)) {
    return null;
  }
  cachedStreamClient = StreamChat.getInstance(apiKey, apiSecret);
  return cachedStreamClient;
}

export function watchChannelId(roomId: string): string {
  return `watch-${roomId}`;
}

export function createId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function toWatchRoomDTO(
  room: WatchRoomRow
): WatchRoomDTO {
  return {
    id: room.id,
    hostUserId: room.hostUserId,
    contentType: room.contentType as WatchContentType,
    contentId: room.contentId,
    rawId: room.rawId,
    isAddon: room.isAddon,
    season: room.season,
    episode: room.episode,
    title: room.title,
    poster: room.poster,
    background: room.background,
    status: room.status as WatchRoomDTO["status"],
    maxParticipants: room.maxParticipants,
    createdAt: room.createdAt.toISOString(),
  };
}

export function toWatchStateDTO(
  state: WatchRoomStateRow | undefined
): WatchRoomStateDTO {
  return {
    positionSec: state?.positionSec ?? 0,
    playing: state?.isPlaying ?? false,
    rate: state?.rate ?? 1,
    updatedAt: (state?.updatedAt ?? new Date()).toISOString(),
  };
}

export async function getWatchRoom(
  roomId: string
): Promise<WatchRoomRow | null> {
  const [room] = await db
    .select()
    .from(watchRoom)
    .where(eq(watchRoom.id, roomId))
    .limit(1);
  return room ?? null;
}

export async function getWatchRoomWithState(
  roomId: string
): Promise<{ room: WatchRoomRow; state: WatchRoomStateRow | undefined } | null> {
  const room = await getWatchRoom(roomId);
  if (!room) {
    return null;
  }
  const [state] = await db
    .select()
    .from(watchRoomState)
    .where(eq(watchRoomState.roomId, roomId))
    .limit(1);
  return { room, state };
}

export async function getWatchRoomMember(
  roomId: string,
  userId: string
): Promise<WatchRoomMemberRow | null> {
  const [member] = await db
    .select()
    .from(watchRoomMember)
    .where(
      and(
        eq(watchRoomMember.roomId, roomId),
        eq(watchRoomMember.userId, userId)
      )
    )
    .limit(1);
  return member ?? null;
}

/**
 * Crea (o recupera) el canal de Chat de la sala y garantiza que el usuario
 * esté suscrito. `channel.create()` es idempotente: si el canal ya existe,
 * devuelve su estado sin borrar a los miembros anteriores.
 */
export async function ensureWatchChannel(params: {
  room: WatchRoomRow;
  userId: string;
  userName: string;
  userImage?: string | null;
  /** Avatar del perfil de onevid (clave de gradiente o `sticker:<id>`). */
  userAvatar?: string | null;
}): Promise<{ client: StreamChat; channelId: string; channelType: string }> {
  const client = getStreamServerClient();
  if (!client) {
    throw new Error("Stream no está configurado");
  }

  const { room, userId, userName, userImage, userAvatar } = params;
  await client.upsertUser({
    id: userId,
    name: userName,
    image: userImage ?? undefined,
    // Campo custom para que la sala pinte el avatar de perfil de onevid
    // (incluidos los stickers) en vez del avatar de la cuenta de hackw.
    onevid_avatar: userAvatar ?? undefined,
  } as unknown as Parameters<typeof client.upsertUser>[0]);

  const channelId = watchChannelId(room.id);
  const channel = client.channel(
    WATCH_CHANNEL_TYPE,
    channelId,
    {
      name: room.title,
      created_by_id: room.hostUserId,
      watch_room_id: room.id,
      members: [userId],
    } as ChannelData & { watch_room_id: string }
  );

  await channel.create();
  await channel.addMembers([userId]);

  return {
    client,
    channelId,
    channelType: WATCH_CHANNEL_TYPE,
  };
}

/** Avisa al canal de que la sala cambió de host (p. ej. al salir el host). */
export async function sendWatchHostEvent(roomId: string, hostId: string) {
  const client = getStreamServerClient();
  if (!client) {
    return;
  }
  const channel = client.channel(WATCH_CHANNEL_TYPE, watchChannelId(roomId));
  await channel.sendEvent({
    type: "watch_host",
    hostId,
    user_id: hostId,
  } as unknown as Parameters<typeof channel.sendEvent>[0]);
}

/** Avisa a los invitados de que la sala terminó. */
export async function sendWatchEndEvent(roomId: string, userId: string) {
  const client = getStreamServerClient();
  if (!client) {
    return;
  }
  const channel = client.channel(WATCH_CHANNEL_TYPE, watchChannelId(roomId));
  await channel.sendEvent({
    type: "watch_end",
    user_id: userId,
  } as unknown as Parameters<typeof channel.sendEvent>[0]);
}

/**
 * Borra el canal de Stream de una sala. `hard_delete` elimina también los
 * mensajes y adjuntos: la watch party es efímera y no guardamos historial.
 */
export async function deleteWatchChannel(
  roomId: string,
  channelType: string = WATCH_CHANNEL_TYPE
) {
  const client = getStreamServerClient();
  if (!client) {
    return;
  }
  const channel = client.channel(channelType, watchChannelId(roomId));
  await channel.delete({ hard_delete: true });
}

/**
 * Borra el canal de Chat y la fila de la sala (los miembros y el estado caen
 * por `onDelete: cascade`). Incluye el tipo legacy `messaging` para limpiar las
 * salas creadas antes de separar los canales de hackw.
 */
export async function deleteWatchRoom(roomId: string) {
  await Promise.allSettled([
    deleteWatchChannel(roomId, WATCH_CHANNEL_TYPE),
    deleteWatchChannel(roomId, "messaging"),
  ]);
  await db.delete(watchRoom).where(eq(watchRoom.id, roomId));
}

/** Quita al usuario del canal de Chat para que deje de recibir eventos. */
export async function removeWatchChannelMember(
  roomId: string,
  userId: string
) {
  const client = getStreamServerClient();
  if (!client) {
    return;
  }
  const channel = client.channel(WATCH_CHANNEL_TYPE, watchChannelId(roomId));
  await channel.removeMembers([userId]);
}

export { WATCH_ROOM_MAX_PARTICIPANTS };
