import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { oneVid } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { checkRateLimitDb } from "@/lib/rate-limit-db";
import { rateLimitResponse } from "@/lib/rate-limit";
import { encryptSecret, encryptionAvailable } from "@/lib/secret-box";

const MAX_TORBOX_KEY_LENGTH = 512;

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

  const limited = await checkRateLimitDb(`torbox-key:${session.user.id}`, 10, 60_000);
  if (!limited.ok) return rateLimitResponse(limited.retryAfter);

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
  if (key.length < 16 || key.length > MAX_TORBOX_KEY_LENGTH) {
    return Response.json({ error: "API key inválida" }, { status: 400 });
  }
  if (/[\u0000-\u001f\u007f]/.test(key)) {
    return Response.json({ error: "API key inválida" }, { status: 400 });
  }

  // No se guarda una credencial si el cifrado no está configurado: el fallback
  // de `encryptSecret` escribiría la key en claro en la base de datos.
  if (!encryptionAvailable()) {
    return Response.json(
      { error: "El cifrado de credenciales no está configurado" },
      { status: 500 }
    );
  }

  // Nunca se guarda en claro: el valor en BD lleva version + AES-256-GCM.
  const storedKey = encryptSecret(key);

  const [existing] = await db
    .select({ id: oneVid.id })
    .from(oneVid)
    .where(eq(oneVid.userId, session.user.id))
    .limit(1);

  const now = new Date();

  if (existing) {
    await db
      .update(oneVid)
      .set({
        torboxApiKey: storedKey,
        debridProvider: "torbox",
        updatedAt: now,
      })
      .where(eq(oneVid.id, existing.id));
  } else {
    await db.insert(oneVid).values({
      id: buildOneVidId(),
      userId: session.user.id,
      torboxApiKey: storedKey,
      debridProvider: "torbox",
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

  const [row] = await db
    .select({ realDebridApiKey: oneVid.realDebridApiKey })
    .from(oneVid)
    .where(eq(oneVid.userId, session.user.id))
    .limit(1);

  await db
    .update(oneVid)
    .set({
      torboxApiKey: null,
      // Igual que al borrar la key de Real-Debrid: si había otra configurada,
      // el proveedor activo cae en ella en vez de quedar vacío.
      debridProvider: row?.realDebridApiKey ? "realdebrid" : null,
      updatedAt: new Date(),
    })
    .where(eq(oneVid.userId, session.user.id));

  return Response.json({ ok: true });
}
