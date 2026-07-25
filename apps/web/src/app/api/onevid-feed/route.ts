import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { oneVid } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { DEFAULT_FEED_ROWS, parseFeedRows } from "@/lib/onevid-feed";
import { posthogServerCapture } from "@/lib/posthog-server";

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
    .select({ feedRows: oneVid.feedRows })
    .from(oneVid)
    .where(eq(oneVid.userId, session.user.id))
    .limit(1);

  const parsed = parseFeedRows(row?.feedRows);

  // `configured` se decide por "es un array", no por longitud: así el paso 2 del
  // stepper sabe si el usuario ya guardó su feed aunque luego lo dejara corto.
  return Response.json({
    configured: parsed !== null,
    rows: parsed ?? DEFAULT_FEED_ROWS,
  });
}

export async function PUT(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: { rows?: unknown };
  try {
    body = (await request.json()) as { rows?: unknown };
  } catch {
    return Response.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const rows = parseFeedRows(body.rows);

  if (rows === null) {
    return Response.json(
      { error: "Formato de filas inválido" },
      { status: 400 }
    );
  }
  if (rows.length === 0) {
    return Response.json(
      { error: "Elige al menos una fila para tu inicio" },
      { status: 400 }
    );
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
      .set({ feedRows: rows, updatedAt: now })
      .where(eq(oneVid.id, existing.id));
  } else {
    await db.insert(oneVid).values({
      id: buildOneVidId(),
      userId: session.user.id,
      feedRows: rows,
      createdAt: now,
      updatedAt: now,
    });
  }

  posthogServerCapture({
    event: "onevid_feed_saved",
    distinctId: session.user.id,
    properties: { row_count: rows.length },
  }).catch(() => {
    /* ignore */
  });

  // Devolvemos las filas NORMALIZADAS para que el cliente se quede con lo mismo
  // que hay en la DB (sin duplicados, sin cadena en trending, capado a 10).
  return Response.json({ ok: true, rows });
}
