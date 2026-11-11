import { and, count, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  oneVidProfile,
  watchRoom,
  watchRoomMember,
} from "@/lib/auth-schema";
import { PROFILE_AVATARS } from "@/lib/onevid-avatars";
import { db } from "@/lib/db";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import {
  createId,
  ensureWatchChannel,
  getStreamServerClient,
  getWatchRoom,
  getWatchRoomMember,
  getWatchRoomWithState,
  toWatchRoomDTO,
  toWatchStateDTO,
  WATCH_CHANNEL_TYPE,
} from "@/lib/watch-party";

class RoomFullError extends Error {
  constructor() {
    super("watch-room-full");
  }
}

const ACTIVE_PROFILE_COOKIE = "onevid-active-profile";
const VERIFIED_PROFILE_COOKIE = "onevid-verified-profile";

/**
 * `image` de Stream a partir del avatar del perfil de onevid. Los stickers no
 * tienen URL (se pintan como componente), así que ahí devolvemos `null` y el
 * cliente usa el campo custom `onevid_avatar`.
 */
function streamImageForAvatar(avatar: string | null): string | null {
  if (!avatar) {
    return null;
  }
  return (PROFILE_AVATARS as readonly string[]).includes(avatar)
    ? `/avatar/${avatar}.jpg`
    : null;
}

async function addMemberIfRoomHasSpace(params: {
  roomId: string;
  userId: string;
  name: string;
  image: string | null;
}): Promise<"joined" | "already" | "full" | "ended"> {
  return await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(watchRoom)
      .where(eq(watchRoom.id, params.roomId))
      .for("update")
      .limit(1);

    if (!locked || locked.status !== "open") {
      return "ended";
    }

    const [existing] = await tx
      .select({ id: watchRoomMember.id })
      .from(watchRoomMember)
      .where(
        and(
          eq(watchRoomMember.roomId, params.roomId),
          eq(watchRoomMember.userId, params.userId)
        )
      )
      .limit(1);

    if (existing) {
      return "already";
    }

    const [total] = await tx
      .select({ value: count() })
      .from(watchRoomMember)
      .where(eq(watchRoomMember.roomId, params.roomId));

    if (Number(total?.value ?? 0) >= locked.maxParticipants) {
      throw new RoomFullError();
    }

    await tx.insert(watchRoomMember).values({
      id: createId(),
      roomId: params.roomId,
      userId: params.userId,
      name: params.name,
      image: params.image,
      role: "guest",
    });

    return "joined";
  });
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id: roomId } = await context.params;
  if (!roomId) {
    return Response.json({ error: "Watch party inválida" }, { status: 400 });
  }

  const limit = checkRateLimit(
    `watch-room-join:${session.user.id}`,
    60,
    60 * 1000
  );
  if (!limit.ok) {
    return rateLimitResponse(limit.retryAfter);
  }

  const room = await getWatchRoom(roomId);
  if (!room) {
    return Response.json({ error: "Watch party no encontrada" }, { status: 404 });
  }
  if (room.status !== "open") {
    return Response.json({ error: "La watch party terminó" }, { status: 410 });
  }

  const userId = session.user.id;
  // La sala usa el perfil activo de onevid (nombre y avatar), no la cuenta de
  // hackw: son cosas distintas y el avatar de hackw no es el que el usuario
  // eligió en su perfil.
  const cookieStore = await cookies();
  const profileId = cookieStore.get(ACTIVE_PROFILE_COOKIE)?.value ?? null;
  const verifiedProfileId =
    cookieStore.get(VERIFIED_PROFILE_COOKIE)?.value ?? null;
  // Igual que el provider de perfiles: si no hay cookie válida se usa el
  // perfil primario (el más antiguo), no la cuenta de hackw. Además, un perfil
  // con PIN solo se usa si esta sesión lo verificó: una cookie de perfil activo
  // no puede saltarse el bloqueo parental.
  const profiles = await db
    .select({
      id: oneVidProfile.id,
      name: oneVidProfile.name,
      avatar: oneVidProfile.avatar,
      pinHash: oneVidProfile.pinHash,
    })
    .from(oneVidProfile)
    .where(eq(oneVidProfile.userId, session.user.id))
    .orderBy(oneVidProfile.createdAt);
  const activeProfile = profiles.find((item) => item.id === profileId);
  const verifiedProfile = profiles.find(
    (item) => item.id === verifiedProfileId
  );
  const profile =
    activeProfile &&
    (!activeProfile.pinHash || activeProfile.id === verifiedProfileId)
      ? activeProfile
      : (verifiedProfile ??
        profiles.find((item) => !item.pinHash) ??
        undefined);
  const userName =
    profile?.name.trim() ||
    session.user.name?.trim() ||
    session.user.email?.trim() ||
    "Espectador";
  const userAvatar = profile?.avatar ?? null;
  // Con perfil de onevid no usamos nunca la imagen de la cuenta de hackw: los
  // stickers no tienen URL y se pintan con el campo custom `onevid_avatar`.
  const userImage = profile
    ? streamImageForAvatar(userAvatar)
    : (session.user.image ?? null);

  let outcome: "joined" | "already" | "full" | "ended";
  try {
    outcome = await addMemberIfRoomHasSpace({
      roomId,
      userId,
      name: userName,
      image: userImage,
    });
  } catch (error) {
    if (error instanceof RoomFullError) {
      return Response.json(
        { error: "La watch party está llena", code: "room_full" },
        { status: 409 }
      );
    }
    throw error;
  }

  if (outcome === "full") {
    return Response.json(
      { error: "La watch party está llena", code: "room_full" },
      { status: 409 }
    );
  }
  if (outcome === "ended") {
    return Response.json({ error: "La watch party terminó" }, { status: 410 });
  }

  const client = getStreamServerClient();
  const apiKey = process.env.STREAM_API_KEY;
  if (!(client && apiKey)) {
    return Response.json(
      { error: "Stream no está configurado en este entorno." },
      { status: 503 }
    );
  }

  let watchChannelType = WATCH_CHANNEL_TYPE;
  let watchChannelId = `watch-${roomId}`;
  try {
    const ensured = await ensureWatchChannel({
      room,
      userId,
      userName,
      userImage,
      userAvatar,
    });
    watchChannelType = ensured.channelType;
    watchChannelId = ensured.channelId;
  } catch (error) {
    console.error("[watch-rooms] No se pudo unir al canal de Stream", {
      type: error instanceof Error ? error.constructor.name : typeof error,
    });
    return Response.json(
      { error: "No se pudo entrar a la watch party. Inténtalo de nuevo." },
      { status: 503 }
    );
  }

  const fresh = await getWatchRoomWithState(roomId);
  const member = await getWatchRoomMember(roomId, userId);
  if (!(fresh && member)) {
    return Response.json(
      { error: "No se pudo cargar la watch party." },
      { status: 503 }
    );
  }

  return Response.json({
    apiKey,
    token: client.createToken(userId),
    userId,
    userName,
    userImage,
    userAvatar,
    channelId: watchChannelId,
    channelType: watchChannelType,
    room: toWatchRoomDTO(fresh.room),
    state: toWatchStateDTO(fresh.state),
    serverTime: Date.now(),
    isHost: fresh.room.hostUserId === userId,
  });
}
