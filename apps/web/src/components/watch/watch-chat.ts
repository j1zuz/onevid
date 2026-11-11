"use client";

import { StreamChat } from "stream-chat";
import type { WatchJoinData } from "@/lib/watch-party-types";

/**
 * Conexión única al cliente de Chat para una sala. React StrictMode monta los
 * efectos dos veces; compartir la promesa evita abrir un segundo WebSocket
 * antes de que el primero termine de autenticarse.
 */
let activeConnect: { key: string; promise: Promise<unknown> } | null = null;

function connectUserPayload(join: WatchJoinData) {
  return {
    id: join.userId,
    name: join.userName,
    image: join.userImage ?? undefined,
    // Campo custom con el avatar del perfil de onevid para que el chat de la
    // sala no use el avatar de la cuenta de hackw.
    onevid_avatar: join.userAvatar ?? undefined,
  } as unknown as Parameters<StreamChat["connectUser"]>[0];
}

/**
 * Si el cliente ya estaba conectado (misma sala u otra del mismo usuario), su
 * copia local del usuario puede conservar el nombre/avatar viejos. Actualizarla
 * evita que los mensajes nuevos salgan con el avatar de hackw.
 */
async function updateConnectedUser(
  client: StreamChat,
  join: WatchJoinData
): Promise<void> {
  await client
    .partialUpdateUser({
      id: join.userId,
      set: {
        name: join.userName,
        image: join.userImage ?? undefined,
        onevid_avatar: join.userAvatar ?? undefined,
      },
    } as unknown as Parameters<StreamChat["partialUpdateUser"]>[0])
    .catch(() => undefined);
}

export async function connectWatchClient(
  join: WatchJoinData
): Promise<StreamChat> {
  const client = StreamChat.getInstance(join.apiKey);
  const key = `${join.apiKey}:${join.userId}`;

  if (activeConnect?.key === key) {
    await activeConnect.promise;
  }

  if (client.userID === join.userId) {
    await updateConnectedUser(client, join);
    return client;
  }

  if (client.userID) {
    await client.disconnectUser();
  }

  const promise = client.connectUser(
    connectUserPayload(join),
    join.token
  );
  activeConnect = { key, promise };
  try {
    await promise;
  } catch (error) {
    console.error("[watch-party] connectUser falló", {
      userId: join.userId,
      type: error instanceof Error ? error.constructor.name : typeof error,
    });
    throw error;
  } finally {
    if (activeConnect?.promise === promise) {
      activeConnect = null;
    }
  }

  return client;
}
