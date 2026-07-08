import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { oneVidProfile } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import {
  checkManageAuth,
  hashPin,
  isValidAvatar,
  isValidPin,
} from "@/lib/onevid-profile";

async function ownProfile(userId: string, id: string) {
  const [row] = await db
    .select({
      id: oneVidProfile.id,
      name: oneVidProfile.name,
      avatar: oneVidProfile.avatar,
      isKids: oneVidProfile.isKids,
      pinHash: oneVidProfile.pinHash,
      createdAt: oneVidProfile.createdAt,
    })
    .from(oneVidProfile)
    .where(and(eq(oneVidProfile.id, id), eq(oneVidProfile.userId, userId)))
    .limit(1);
  return row;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }
  const { id } = await context.params;

  let body: {
    name?: unknown;
    avatar?: unknown;
    isKids?: unknown;
    lockPin?: unknown;
    authPin?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const pinCheck = await checkManageAuth(
    session.user.id,
    typeof body.authPin === "string" ? body.authPin : undefined
  );
  if (pinCheck !== "ok") {
    return Response.json({ error: pinCheck }, { status: 403 });
  }

  const current = await ownProfile(session.user.id, id);
  if (!current) {
    return Response.json({ error: "invalid_profile" }, { status: 400 });
  }

  const updates: {
    name?: string;
    avatar?: string;
    isKids?: boolean;
    pinHash?: string | null;
  } = {};
  if (typeof body.name === "string" && body.name.trim()) {
    updates.name = body.name.trim();
  }
  if (isValidAvatar(body.avatar)) {
    updates.avatar = body.avatar;
  }
  if (typeof body.isKids === "boolean") {
    updates.isKids = body.isKids;
  }

  // lockPin: string → set/change this profile's PIN; null → remove the lock;
  // absent → leave the lock untouched.
  if ("lockPin" in body) {
    if (body.lockPin === null) {
      updates.pinHash = null;
    } else if (isValidPin(body.lockPin)) {
      updates.pinHash = await hashPin(body.lockPin);
    } else {
      return Response.json(
        { error: "El PIN debe tener 4 dígitos" },
        { status: 400 }
      );
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.update(oneVidProfile).set(updates).where(eq(oneVidProfile.id, id));
  }

  const pinHash = "pinHash" in updates ? updates.pinHash : current.pinHash;
  return Response.json({
    id: current.id,
    name: updates.name ?? current.name,
    avatar: updates.avatar ?? current.avatar,
    isKids: updates.isKids ?? current.isKids,
    hasPin: Boolean(pinHash),
    createdAt: current.createdAt,
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }
  const { id } = await context.params;

  // The authorizing PIN (any locked profile's PIN) travels in the X-Profile-Pin
  // header for DELETE, since the request has no body.
  const authPin = (await headers()).get("x-profile-pin");
  const pinCheck = await checkManageAuth(session.user.id, authPin);
  if (pinCheck !== "ok") {
    return Response.json({ error: pinCheck }, { status: 403 });
  }

  const current = await ownProfile(session.user.id, id);
  if (!current) {
    return Response.json({ error: "invalid_profile" }, { status: 400 });
  }

  await db.delete(oneVidProfile).where(eq(oneVidProfile.id, id));

  return Response.json({ ok: true });
}
