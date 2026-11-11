import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { watchRoomMember } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import {
  getWatchRoom,
  getWatchRoomMember,
  removeWatchChannelMember,
  sendWatchKickEvent,
} from "@/lib/watch-party";

/**
 * Saca a un participante de la watch party. Solo el host puede hacerlo y nunca
 * sobre sí mismo (para eso está "Salir").
 */
export async function POST(
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
    return Response.json(
      { error: "Watch party no encontrada" },
      { status: 404 }
    );
  }
  if (room.status !== "open") {
    return Response.json({ error: "La watch party terminó" }, { status: 410 });
  }
  if (room.hostUserId !== session.user.id) {
    return Response.json(
      { error: "Solo el host puede sacar a alguien." },
      { status: 403 }
    );
  }

  const limit = checkRateLimit(
    `watch-room-kick:${session.user.id}`,
    30,
    60 * 1000
  );
  if (!limit.ok) {
    return rateLimitResponse(limit.retryAfter);
  }

  const body = (await request.json().catch(() => null)) as {
    userId?: unknown;
  } | null;
  const userId = typeof body?.userId === "string" ? body.userId : "";
  if (!userId) {
    return Response.json({ error: "Falta el usuario" }, { status: 400 });
  }
  if (userId === session.user.id) {
    return Response.json(
      { error: "No puedes sacarte a ti mismo." },
      { status: 400 }
    );
  }

  const member = await getWatchRoomMember(roomId, userId);
  if (!member) {
    return Response.json({ ok: true });
  }

  await db
    .delete(watchRoomMember)
    .where(
      and(
        eq(watchRoomMember.roomId, roomId),
        eq(watchRoomMember.userId, userId)
      )
    );

  // Primero el aviso (para que su cliente se cierre al instante) y después la
  // salida del canal de Stream, que es best-effort.
  try {
    await sendWatchKickEvent(roomId, userId);
  } catch (error) {
    console.error("[watch-rooms] No se pudo avisar la expulsión", {
      type: error instanceof Error ? error.constructor.name : typeof error,
    });
  }
  try {
    await removeWatchChannelMember(roomId, userId);
  } catch (error) {
    console.error("[watch-rooms] No se pudo sacar al usuario del canal", {
      type: error instanceof Error ? error.constructor.name : typeof error,
    });
  }

  return Response.json({ ok: true });
}
