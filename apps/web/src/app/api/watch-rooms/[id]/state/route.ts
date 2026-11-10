import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { watchRoom, watchRoomState } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { getWatchRoom } from "@/lib/watch-party";

const MAX_POSITION_SEC = 24 * 60 * 60;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id: roomId } = await context.params;
  const room = await getWatchRoom(roomId);
  if (!room) {
    return Response.json({ error: "Watch party no encontrada" }, { status: 404 });
  }
  if (room.status !== "open") {
    return Response.json({ error: "La watch party terminó" }, { status: 410 });
  }
  if (room.hostUserId !== session.user.id) {
    return Response.json(
      { error: "Solo el host controla la reproducción." },
      { status: 403 }
    );
  }

  const limit = checkRateLimit(
    `watch-room-state:${session.user.id}`,
    120,
    60 * 1000
  );
  if (!limit.ok) {
    return rateLimitResponse(limit.retryAfter);
  }

  let body: {
    positionSec?: unknown;
    playing?: unknown;
    rate?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const positionRaw =
    typeof body.positionSec === "number"
      ? body.positionSec
      : Number(body.positionSec);
  const positionSec = Number.isFinite(positionRaw)
    ? Math.min(MAX_POSITION_SEC, Math.max(0, Math.floor(positionRaw)))
    : 0;
  const rateRaw = typeof body.rate === "number" ? body.rate : Number(body.rate);
  const rate = Number.isFinite(rateRaw)
    ? Math.min(2, Math.max(0.5, rateRaw))
    : 1;
  const playing = body.playing === true;

  await db
    .insert(watchRoomState)
    .values({
      roomId,
      positionSec,
      isPlaying: playing,
      rate,
      updatedBy: session.user.id,
    })
    .onConflictDoUpdate({
      target: watchRoomState.roomId,
      set: {
        positionSec,
        isPlaying: playing,
        rate,
        updatedBy: session.user.id,
        updatedAt: new Date(),
      },
    });

  // Si la sala se cerró entre la lectura y el update, no reabrimos nada: el
  // estado solo se guarda para salas abiertas (el update de arriba no toca
  // `watch_room.status`).
  await db
    .update(watchRoom)
    .set({ updatedAt: new Date() })
    .where(eq(watchRoom.id, roomId));

  return Response.json({ ok: true, serverTime: Date.now() });
}
