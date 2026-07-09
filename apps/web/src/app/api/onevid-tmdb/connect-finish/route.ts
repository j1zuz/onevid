import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { oneVid } from "@/lib/auth-schema";
import { db } from "@/lib/db";
import { tmdbCreateAccessToken } from "@/lib/tmdb";

function buildOneVidId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user?.id) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const appToken = process.env.TMDB_APP_READ_TOKEN;
  if (!appToken) {
    return Response.json({ error: "tmdb_app_not_configured" }, { status: 500 });
  }

  let requestToken: string;
  try {
    const body = (await request.json()) as { request_token?: unknown };
    requestToken =
      typeof body.request_token === "string" ? body.request_token.trim() : "";
  } catch {
    return Response.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  if (!requestToken) {
    return Response.json({ error: "request_token requerido" }, { status: 400 });
  }

  let accessToken: string;
  let accountId: string;
  try {
    ({ accessToken, accountId } = await tmdbCreateAccessToken(
      appToken,
      requestToken
    ));
  } catch {
    // A 401 here almost always means the user hasn't approved the request_token
    // yet (the app token was just used successfully in connect-start), so we
    // surface a single actionable error rather than branching on TmdbAuthError.
    return Response.json(
      { error: "tmdb_access_token_failed" },
      { status: 502 }
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
      .set({
        tmdbUserAccessToken: accessToken,
        tmdbAccountId: accountId,
        updatedAt: now,
      })
      .where(eq(oneVid.id, existing.id));
  } else {
    await db.insert(oneVid).values({
      id: buildOneVidId(),
      userId: session.user.id,
      tmdbUserAccessToken: accessToken,
      tmdbAccountId: accountId,
      createdAt: now,
      updatedAt: now,
    });
  }

  return Response.json({ linked: true });
}
