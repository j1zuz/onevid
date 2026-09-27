import { count, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { oneVid, oneVidAddon } from "@/lib/auth-schema";
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
    .select({
      torboxApiKey: oneVid.torboxApiKey,
      setupCompleted: oneVid.setupCompleted,
    })
    .from(oneVid)
    .where(eq(oneVid.userId, session.user.id))
    .limit(1);

  const [addons] = await db
    .select({ value: count() })
    .from(oneVidAddon)
    .where(eq(oneVidAddon.userId, session.user.id));

  return Response.json({
    setupCompleted: row?.setupCompleted ?? false,
    hasTorboxKey: Boolean(row?.torboxApiKey),
    addonsCount: addons?.value ?? 0,
  });
}

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  // TMDB ya no se conecta por usuario (usa el token global del dueño); los
  // complementos (addons) y la API key de TorBox son opcionales. Completar el
  // setup solo marca la bandera.
  const [existing] = await db
    .select({ id: oneVid.id })
    .from(oneVid)
    .where(eq(oneVid.userId, session.user.id))
    .limit(1);

  const now = new Date();

  if (existing) {
    await db
      .update(oneVid)
      .set({ setupCompleted: true, updatedAt: now })
      .where(eq(oneVid.id, existing.id));
  } else {
    await db.insert(oneVid).values({
      id: buildOneVidId(),
      userId: session.user.id,
      setupCompleted: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  return Response.json({ ok: true });
}
