import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { oneVid } from "@/lib/auth-schema";
import { db } from "@/lib/db";

/**
 * Disconnect the user's TMDB account and reset the onevid setup so the user goes
 * back through the configuration flow from scratch. Clears the v4 user token +
 * account id and flips setupCompleted off.
 */
export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user?.id) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const [existing] = await db
    .select({ id: oneVid.id })
    .from(oneVid)
    .where(eq(oneVid.userId, session.user.id))
    .limit(1);

  if (existing) {
    await db
      .update(oneVid)
      .set({
        tmdbUserAccessToken: null,
        tmdbAccountId: null,
        setupCompleted: false,
        updatedAt: new Date(),
      })
      .where(eq(oneVid.id, existing.id));
  }

  return Response.json({ linked: false });
}
