import { and, count, eq, ne } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { watchRoom, watchRoomMember } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import {
  deleteWatchRoom,
  getWatchRoom,
  getWatchRoomMember,
  removeWatchChannelMember,
  sendWatchEndEvent,
  sendWatchHostEvent,
} from "@/lib/watch-party";

export async function POST(
  _request: Request,
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

  const limit = checkRateLimit(
    `watch-room-leave:${session.user.id}`,
    60,
    60 * 1000
  );
  if (!limit.ok) {
    return rateLimitResponse(limit.retryAfter);
  }

  const member = await getWatchRoomMember(roomId, session.user.id);
  if (!member) {
    return Response.json({ ok: true, ended: room.status !== "open" });
  }

  await db
    .delete(watchRoomMember)
    .where(
      and(
        eq(watchRoomMember.roomId, roomId),
        eq(watchRoomMember.userId, session.user.id)
      )
    );

  let ended = room.status !== "open";
  let nextHostId: string | null = null;

  if (room.hostUserId === session.user.id && !ended) {
    const [next] = await db
      .select({
        userId: watchRoomMember.userId,
        role: watchRoomMember.role,
      })
      .from(watchRoomMember)
      .where(
        and(
          eq(watchRoomMember.roomId, roomId),
          ne(watchRoomMember.userId, session.user.id)
        )
      )
      .orderBy(watchRoomMember.joinedAt)
      .limit(1);

    if (next) {
      nextHostId = next.userId;
      await db
        .update(watchRoom)
        .set({ hostUserId: next.userId, updatedAt: new Date() })
        .where(eq(watchRoom.id, roomId));
      await db
        .update(watchRoomMember)
        .set({ role: "host" })
        .where(
          and(
            eq(watchRoomMember.roomId, roomId),
            eq(watchRoomMember.userId, next.userId)
          )
        );
      try {
        await sendWatchHostEvent(roomId, next.userId);
      } catch (error) {
        console.error("[watch-rooms] No se pudo avisar el nuevo host", {
          type: error instanceof Error ? error.constructor.name : typeof error,
        });
      }
    } else {
      ended = true;
      await db
        .update(watchRoom)
        .set({ status: "ended", updatedAt: new Date() })
        .where(eq(watchRoom.id, roomId));
      try {
        await sendWatchEndEvent(roomId, session.user.id);
      } catch (error) {
        console.error("[watch-rooms] No se pudo avisar el fin de la sala", {
          type: error instanceof Error ? error.constructor.name : typeof error,
        });
      }
    }
  }

  try {
    await removeWatchChannelMember(roomId, session.user.id);
  } catch (error) {
    // Salir del canal es best-effort: la membresía de la sala ya se borró.
    console.error("[watch-rooms] No se pudo salir del canal de Stream", {
      type: error instanceof Error ? error.constructor.name : typeof error,
    });
  }

  const [remaining] = await db
    .select({ value: count() })
    .from(watchRoomMember)
    .where(eq(watchRoomMember.roomId, roomId));
  if (Number(remaining?.value ?? 0) === 0) {
    // Sin miembros la sala ya no sirve: se borra el chat y la fila.
    await deleteWatchRoom(roomId).catch((error) => {
      console.error("[watch-rooms] No se pudo borrar la sala vacía", {
        type: error instanceof Error ? error.constructor.name : typeof error,
      });
    });
  }

  return Response.json({ ok: true, ended, hostId: nextHostId });
}
