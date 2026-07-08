import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { oneVidProfile } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import {
  buildId,
  checkManageAuth,
  hashPin,
  isValidAvatar,
  isValidPin,
  MAX_PROFILES,
} from "@/lib/onevid-profile";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const rows = await db
    .select({
      id: oneVidProfile.id,
      name: oneVidProfile.name,
      avatar: oneVidProfile.avatar,
      isKids: oneVidProfile.isKids,
      pinHash: oneVidProfile.pinHash,
      createdAt: oneVidProfile.createdAt,
    })
    .from(oneVidProfile)
    .where(eq(oneVidProfile.userId, session.user.id))
    .orderBy(oneVidProfile.createdAt);

  const profiles = rows.map(({ pinHash, ...p }) => ({
    ...p,
    hasPin: Boolean(pinHash),
  }));

  return Response.json({ profiles, max: MAX_PROFILES });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  let name: string;
  let avatar: string;
  let isKids: boolean;
  let lockPin: string | null | undefined;
  let authPin: string | undefined;
  try {
    const body = (await request.json()) as {
      name?: unknown;
      avatar?: unknown;
      isKids?: unknown;
      lockPin?: unknown;
      authPin?: unknown;
    };
    name = typeof body.name === "string" ? body.name.trim() : "";
    avatar = isValidAvatar(body.avatar) ? body.avatar : "blue";
    isKids = Boolean(body.isKids);
    if (body.lockPin === null) {
      lockPin = null;
    } else if (typeof body.lockPin === "string") {
      lockPin = body.lockPin;
    } else {
      lockPin = undefined;
    }
    authPin = typeof body.authPin === "string" ? body.authPin : undefined;
  } catch {
    return Response.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  if (!name) {
    return Response.json({ error: "name requerido" }, { status: 400 });
  }

  const pinCheck = await checkManageAuth(session.user.id, authPin);
  if (pinCheck !== "ok") {
    return Response.json({ error: pinCheck }, { status: 403 });
  }

  // A provided lockPin must be exactly 4 digits; null/absent means no lock.
  if (typeof lockPin === "string" && !isValidPin(lockPin)) {
    return Response.json(
      { error: "El PIN debe tener 4 dígitos" },
      { status: 400 }
    );
  }

  const existing = await db
    .select({ id: oneVidProfile.id })
    .from(oneVidProfile)
    .where(eq(oneVidProfile.userId, session.user.id));

  if (existing.length >= MAX_PROFILES) {
    return Response.json({ error: "max_profiles" }, { status: 409 });
  }

  const pinHash = typeof lockPin === "string" ? await hashPin(lockPin) : null;

  const now = new Date();
  const id = buildId();
  await db.insert(oneVidProfile).values({
    id,
    userId: session.user.id,
    name,
    avatar,
    isKids,
    pinHash,
    createdAt: now,
  });

  return Response.json(
    { id, name, avatar, isKids, hasPin: Boolean(pinHash), createdAt: now },
    { status: 201 }
  );
}
