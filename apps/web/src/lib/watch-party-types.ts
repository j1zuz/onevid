/**
 * Tipos compartidos entre el servidor (API/página) y el cliente de la sala.
 * Este archivo no debe importar nada de Stream ni de la base de datos: lo usa
 * el bundle del navegador.
 */

export const WATCH_ROOM_MAX_PARTICIPANTS = 5;

export type WatchContentType = "movie" | "series";
export type WatchRoomStatus = "open" | "ended";

export interface WatchRoomDTO {
  id: string;
  hostUserId: string;
  contentType: WatchContentType;
  contentId: string;
  rawId: string;
  isAddon: boolean;
  season: number;
  episode: number;
  title: string;
  poster: string | null;
  background: string | null;
  status: WatchRoomStatus;
  maxParticipants: number;
  createdAt: string;
}

export interface WatchRoomStateDTO {
  positionSec: number;
  playing: boolean;
  rate: number;
  /** ISO timestamp del servidor. */
  updatedAt: string;
}

export interface WatchJoinData {
  apiKey: string;
  token: string;
  userId: string;
  userName: string;
  /** Imagen de Stream (cuenta o avatar de gradiente del perfil). */
  userImage: string | null;
  /** Avatar del perfil de onevid: clave de gradiente o `sticker:<id>`. */
  userAvatar: string | null;
  channelId: string;
  channelType: string;
  room: WatchRoomDTO;
  state: WatchRoomStateDTO;
  /** Hora del servidor al emitir el token, para corregir el reloj local. */
  serverTime: number;
  isHost: boolean;
}

export interface WatchChatAttachment {
  type: string;
  asset_url?: string;
  image_url?: string;
  thumb_url?: string;
  title?: string;
  /** Duración en segundos (notas de voz). */
  duration?: number;
  giphy?: Record<string, { url?: string } | undefined>;
}

export interface WatchChatReaction {
  emoji: string;
  count: number;
  /** El usuario actual reaccionó con este emoji. */
  mine: boolean;
}

/** Cita de otro mensaje, tal como la devuelve Stream (`quoted_message`). */
export interface WatchChatQuotedMessage {
  id: string;
  text: string;
  userName: string;
  hasAttachment: boolean;
}

export interface WatchChatMessage {
  id: string;
  text: string;
  userId: string;
  userName: string;
  userImage: string | null;
  /** Avatar del perfil de onevid: clave de gradiente o `sticker:<id>`. */
  avatar: string | null;
  attachments: WatchChatAttachment[];
  reactions: WatchChatReaction[];
  /** Mensaje al que responde, si es una respuesta citada. */
  quoted: WatchChatQuotedMessage | null;
  /** Fijado por el host (o por quien tenga permiso). */
  pinned: boolean;
  createdAt: string;
}

export interface WatchMember {
  userId: string;
  name: string;
  image: string | null;
  /** Avatar del perfil de onevid: clave de gradiente o `sticker:<id>`. */
  avatar: string | null;
  /** Presencia de Stream: `null` si la app no la expone. */
  online: boolean | null;
}

export type WatchSyncAction = "play" | "pause" | "seek" | "rate" | "heartbeat";

export interface WatchSyncEvent {
  type: "watch_sync";
  action: WatchSyncAction;
  positionSec: number;
  playing: boolean;
  rate: number;
  hostId: string;
  sentAt: number;
}

export interface WatchRequestEvent {
  type: "watch_request";
}

export interface WatchHostEvent {
  type: "watch_host";
  hostId: string;
}

export interface WatchEndEvent {
  type: "watch_end";
}

export interface WatchReactionEvent {
  type: "watch_reaction";
  emoji: string;
  userId: string;
}
