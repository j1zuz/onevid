import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { TmdbAuthError, tmdbCreateRequestToken } from "@/lib/tmdb";

const DEFAULT_REDIRECT = "onevid://tmdb-approved";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user?.id) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const appToken = process.env.TMDB_APP_READ_TOKEN;
  if (!appToken) {
    return Response.json({ error: "tmdb_app_not_configured" }, { status: 500 });
  }

  let redirectTo = DEFAULT_REDIRECT;
  try {
    const body = (await request.json()) as { redirect_to?: unknown };
    if (typeof body.redirect_to === "string" && body.redirect_to.trim()) {
      redirectTo = body.redirect_to.trim();
    }
  } catch {
    // empty / invalid body → use default redirect
  }

  try {
    const requestToken = await tmdbCreateRequestToken(appToken, redirectTo);
    return Response.json({
      approveUrl: `https://www.themoviedb.org/auth/access?request_token=${requestToken}`,
      request_token: requestToken,
    });
  } catch (error) {
    if (error instanceof TmdbAuthError) {
      return Response.json(
        { error: "tmdb_app_token_invalid" },
        { status: 502 }
      );
    }
    return Response.json(
      { error: "tmdb_request_token_failed" },
      { status: 502 }
    );
  }
}
