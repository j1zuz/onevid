import { eq } from "drizzle-orm";
import { oneVid } from "@/lib/auth-schema";
import { db } from "@/lib/db";

export interface OneVidTmdb {
  /** TMDB v4 account id tied to the user access token (null if not linked). */
  accountId: string | null;
  /** Token to use for reads: user access token preferred, legacy read token as fallback. */
  effectiveToken: string | null;
  /** True when the user has connected their TMDB account (v4 user token present). */
  linked: boolean;
  /** Legacy "Read Access Token" from the deprecated paste flow. */
  readAccessToken: string | null;
  /** TMDB OAuth v4 user access token (read + write). */
  userAccessToken: string | null;
}

/**
 * Resolves the TMDB credentials for a hackw user. The OAuth v4 user token is a
 * superset of the legacy read token, so reads use it when present and fall back
 * to the read token for users who haven't migrated yet. Writes (favorite /
 * watchlist) require `linked === true` and `accountId`.
 */
export async function getOneVidTmdb(userId: string): Promise<OneVidTmdb> {
  const [row] = await db
    .select({
      userAccessToken: oneVid.tmdbUserAccessToken,
      readAccessToken: oneVid.tmdbReadAccessToken,
      accountId: oneVid.tmdbAccountId,
    })
    .from(oneVid)
    .where(eq(oneVid.userId, userId))
    .limit(1);

  const userAccessToken = row?.userAccessToken ?? null;
  const readAccessToken = row?.readAccessToken ?? null;

  return {
    userAccessToken,
    readAccessToken,
    accountId: row?.accountId ?? null,
    effectiveToken: userAccessToken ?? readAccessToken,
    linked: Boolean(userAccessToken),
  };
}
