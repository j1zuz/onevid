import { count, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { oneVid, oneVidAddon } from "@/lib/auth-schema";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const [row] = await db
    .select({
      tmdbUserAccessToken: oneVid.tmdbUserAccessToken,
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
    hasTmdbToken: Boolean(row?.tmdbUserAccessToken),
    hasTorboxKey: Boolean(row?.torboxApiKey),
    addonsCount: addons?.value ?? 0,
  });
}

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const [existing] = await db
    .select({
      id: oneVid.id,
      tmdbUserAccessToken: oneVid.tmdbUserAccessToken,
    })
    .from(oneVid)
    .where(eq(oneVid.userId, session.user.id))
    .limit(1);

  // Mirror the page gating: only the OAuth v4 user token counts as "connected".
  // Los complementos (addons) y la API key de TorBox son opcionales; no se
  // exigen para completar el setup.
  if (!existing?.tmdbUserAccessToken) {
    return Response.json(
      { error: "Conecta primero tu cuenta de TMDB" },
      { status: 400 }
    );
  }

  await db
    .update(oneVid)
    .set({ setupCompleted: true, updatedAt: new Date() })
    .where(eq(oneVid.id, existing.id));

  return Response.json({ ok: true });
}
