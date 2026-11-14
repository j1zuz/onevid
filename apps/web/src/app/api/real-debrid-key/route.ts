import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { oneVid } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { checkRateLimitDb } from "@/lib/rate-limit-db";
import { rateLimitResponse } from "@/lib/rate-limit";
import { validateRealDebridKey } from "@/lib/real-debrid";
import { encryptSecret, encryptionAvailable } from "@/lib/secret-box";

const MAX_KEY_LENGTH = 512;
const MIN_KEY_LENGTH = 8;

function buildOneVidId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function invalidKeyResponse() {
  return Response.json(
    { error: "API key de Real-Debrid inválida" },
    { status: 400 }
  );
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const [row] = await db
    .select({ realDebridApiKey: oneVid.realDebridApiKey })
    .from(oneVid)
    .where(eq(oneVid.userId, session.user.id))
    .limit(1);

  return Response.json({ hasKey: Boolean(row?.realDebridApiKey) });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const limited = await checkRateLimitDb(
    `real-debrid-key:${session.user.id}`,
    10,
    60_000
  );
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
  if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) {
    return invalidKeyResponse();
  }
  if (/[\u0000-\u001f\u007f]/.test(key)) {
    return invalidKeyResponse();
  }

  // No se guarda una credencial si el cifrado no está configurado: el fallback
  // de `encryptSecret` escribiría el token en claro en la base de datos.
  if (!encryptionAvailable()) {
    return Response.json(
      { error: "El cifrado de credenciales no está configurado" },
      { status: 500 }
    );
  }

  // Se valida antes de guardar: un token vencido no debe quedar "conectado"
  // hasta que el usuario intente reproducir y vea un error críptico.
  const user = await validateRealDebridKey(key);
  if (!user.valid) {
    return invalidKeyResponse();
  }
  if (!user.premium) {
    return Response.json(
      { error: "Real-Debrid requiere una cuenta Premium activa" },
      { status: 400 }
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
        realDebridApiKey: storedKey,
        debridProvider: "realdebrid",
        updatedAt: now,
      })
      .where(eq(oneVid.id, existing.id));
  } else {
    await db.insert(oneVid).values({
      id: buildOneVidId(),
      userId: session.user.id,
      realDebridApiKey: storedKey,
      debridProvider: "realdebrid",
      createdAt: now,
      updatedAt: now,
    });
  }

  return Response.json({ ok: true, username: user.username });
}

export async function DELETE() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const [row] = await db
    .select({ torboxApiKey: oneVid.torboxApiKey })
    .from(oneVid)
    .where(eq(oneVid.userId, session.user.id))
    .limit(1);

  await db
    .update(oneVid)
    .set({
      realDebridApiKey: null,
      // Si el proveedor activo era Real-Debrid, se vuelve a TorBox cuando
      // exista key: borrar una key no debe dejar la cuenta sin proveedor.
      debridProvider: row?.torboxApiKey ? "torbox" : null,
      updatedAt: new Date(),
    })
    .where(eq(oneVid.userId, session.user.id));

  return Response.json({ ok: true });
}
