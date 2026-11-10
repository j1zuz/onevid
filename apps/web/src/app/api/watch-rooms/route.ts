import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { watchRoom, watchRoomMember, watchRoomState } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import {
  createId,
  ensureWatchChannel,
  getStreamServerClient,
  toWatchRoomDTO,
  WATCH_ROOM_MAX_PARTICIPANTS,
} from "@/lib/watch-party";
import type { WatchContentType } from "@/lib/watch-party-types";

const MAX_TEXT = 500;
const MAX_POSITION_SEC = 24 * 60 * 60;

interface CreateBody {
  background?: unknown;
  contentId?: unknown;
  contentType?: unknown;
  episode?: unknown;
  isAddon?: unknown;
  playing?: unknown;
  positionSec?: unknown;
  poster?: unknown;
  rawId?: unknown;
  season?: unknown;
  title?: unknown;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_TEXT) : null;
}

function requiredText(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Poster/fondo: solo https o rutas locales absolutas (/...). */
function safeImageUrl(value: unknown): string | null {
  const text = optionalText(value);
  if (!text) {
    return null;
  }
  if (text.startsWith("/") && !text.startsWith("//")) {
    return text;
  }
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function nonNegativeInt(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const limit = checkRateLimit(
    `watch-room-create:${session.user.id}`,
    10,
    60 * 60 * 1000
  );
  if (!limit.ok) {
    return rateLimitResponse(limit.retryAfter);
  }

  if (!getStreamServerClient()) {
    return Response.json(
      { error: "Stream no está configurado en este entorno." },
      { status: 503 }
    );
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return Response.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const contentType: WatchContentType | null =
    body.contentType === "series"
      ? "series"
      : body.contentType === "movie"
        ? "movie"
        : null;
  const contentId = requiredText(body.contentId, 120);
  const rawId = requiredText(body.rawId, 160);
  const title = requiredText(body.title, 200);
  if (!(contentType && contentId && rawId && title)) {
    return Response.json(
      { error: "Datos de la watch party inválidos." },
      { status: 400 }
    );
  }

  const positionRaw =
    typeof body.positionSec === "number"
      ? body.positionSec
      : Number(body.positionSec);
  const positionSec = Number.isFinite(positionRaw)
    ? Math.min(MAX_POSITION_SEC, Math.max(0, Math.floor(positionRaw)))
    : 0;
  const playing = body.playing === true;
  const isAddon = body.isAddon === true;
  const season = nonNegativeInt(body.season);
  const episode = nonNegativeInt(body.episode);
  const poster = safeImageUrl(body.poster);
  const background = safeImageUrl(body.background);

  const roomId = createId();
  const userId = session.user.id;
  const userName =
    session.user.name?.trim() ||
    session.user.email?.trim() ||
    "Espectador";
  const userImage = session.user.image ?? null;
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(watchRoom).values({
      id: roomId,
      hostUserId: userId,
      contentType,
      contentId,
      rawId,
      isAddon,
      season,
      episode,
      title,
      poster,
      background,
      status: "open",
      maxParticipants: WATCH_ROOM_MAX_PARTICIPANTS,
    });
    await tx.insert(watchRoomState).values({
      roomId,
      positionSec,
      isPlaying: playing,
      rate: 1,
      updatedBy: userId,
    });
    await tx.insert(watchRoomMember).values({
      id: createId(),
      roomId,
      userId,
      name: userName,
      image: userImage,
      role: "host",
    });
  });

  const roomRow = {
    id: roomId,
    hostUserId: userId,
    contentType,
    contentId,
    rawId,
    isAddon,
    season,
    episode,
    title,
    poster,
    background,
    status: "open",
    maxParticipants: WATCH_ROOM_MAX_PARTICIPANTS,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await ensureWatchChannel({
      room: roomRow,
      userId,
      userName,
      userImage,
    });
  } catch (error) {
    console.error("[watch-rooms] No se pudo crear el canal de Stream", {
      type: error instanceof Error ? error.constructor.name : typeof error,
    });
    await db.delete(watchRoom).where(eq(watchRoom.id, roomId));
    return Response.json(
      { error: "No se pudo crear la watch party. Inténtalo de nuevo." },
      { status: 503 }
    );
  }

  return Response.json({
    id: roomId,
    url: `/watch/${roomId}`,
    room: toWatchRoomDTO(roomRow),
  });
}
