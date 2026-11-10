import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { watchRoom } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import {
  deleteWatchRoom,
  getWatchRoom,
  sendWatchEndEvent,
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
    return Response.json({ error: "Sala no encontrada" }, { status: 404 });
  }
  if (room.hostUserId !== session.user.id) {
    return Response.json(
      { error: "Solo el host puede terminar la sala." },
      { status: 403 }
    );
  }

  if (room.status !== "open") {
    await deleteWatchRoom(roomId).catch(() => undefined);
    return Response.json({ ok: true });
  }

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

  await deleteWatchRoom(roomId).catch((error) => {
    console.error("[watch-rooms] No se pudo borrar la sala terminada", {
      type: error instanceof Error ? error.constructor.name : typeof error,
    });
  });

  return Response.json({ ok: true });
}
