import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { oneVid } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { normalizeDebridProvider } from "@/lib/debrid";
import { checkRateLimitDb } from "@/lib/rate-limit-db";
import { rateLimitResponse } from "@/lib/rate-limit";

function buildOneVidId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Proveedor debrid activo del usuario (el que resuelve los magnets). Cambiar
 * de proveedor no borra la key del otro: permite alternar sin volver a pegar
 * el token.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const limited = await checkRateLimitDb(
    `debrid-provider:${session.user.id}`,
    20,
    60_000
  );
  if (!limited.ok) return rateLimitResponse(limited.retryAfter);

  let provider = normalizeDebridProvider(null);
  try {
    const body = (await request.json()) as { provider?: unknown };
    provider = normalizeDebridProvider(body.provider);
  } catch {
    return Response.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  if (!provider) {
    return Response.json({ error: "Proveedor inválido" }, { status: 400 });
  }

  const [row] = await db
    .select({
      id: oneVid.id,
      torboxApiKey: oneVid.torboxApiKey,
      realDebridApiKey: oneVid.realDebridApiKey,
    })
    .from(oneVid)
    .where(eq(oneVid.userId, session.user.id))
    .limit(1);

  const hasKey = provider === "torbox"
    ? Boolean(row?.torboxApiKey)
    : Boolean(row?.realDebridApiKey);
  if (!hasKey) {
    return Response.json(
      { error: "Guarda primero la API key de ese proveedor" },
      { status: 400 }
    );
  }

  const now = new Date();
  if (row) {
    await db
      .update(oneVid)
      .set({ debridProvider: provider, updatedAt: now })
      .where(eq(oneVid.id, row.id));
  } else {
    await db.insert(oneVid).values({
      id: buildOneVidId(),
      userId: session.user.id,
      debridProvider: provider,
      createdAt: now,
      updatedAt: now,
    });
  }

  return Response.json({ ok: true, provider });
}
