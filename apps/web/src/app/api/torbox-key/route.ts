import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { oneVid } from "@/lib/auth-schema";
import { db } from "@/lib/db";

function buildOneVidId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const [row] = await db
    .select({ torboxApiKey: oneVid.torboxApiKey })
    .from(oneVid)
    .where(eq(oneVid.userId, session.user.id))
    .limit(1);

  return Response.json({ hasKey: Boolean(row?.torboxApiKey) });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  let key: string;
  try {
    const body = (await request.json()) as { key?: unknown };
    key = typeof body.key === "string" ? body.key.trim() : "";
  } catch {
    return Response.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  if (!key) {
    return Response.json({ error: "API key requerida" }, { status: 400 });
  }
  if (key.length < 16) {
    return Response.json({ error: "API key inválida" }, { status: 400 });
  }

  const [existing] = await db
    .select({ id: oneVid.id })
    .from(oneVid)
    .where(eq(oneVid.userId, session.user.id))
    .limit(1);

  const now = new Date();

  if (existing) {
    await db
      .update(oneVid)
      .set({ torboxApiKey: key, updatedAt: now })
      .where(eq(oneVid.id, existing.id));
  } else {
    await db.insert(oneVid).values({
      id: buildOneVidId(),
      userId: session.user.id,
      torboxApiKey: key,
      createdAt: now,
      updatedAt: now,
    });
  }

  return Response.json({ ok: true });
}

export async function DELETE() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  await db
    .update(oneVid)
    .set({ torboxApiKey: null, updatedAt: new Date() })
    .where(eq(oneVid.userId, session.user.id));

  return Response.json({ ok: true });
}
