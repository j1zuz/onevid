import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listProfileSaved, resolveActiveProfile } from "@/lib/onevid-profile";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const type = request.nextUrl.searchParams.get("type")?.trim().toLowerCase();
  if (type !== "movie" && type !== "series") {
    return NextResponse.json({ error: "type inválido" }, { status: 400 });
  }

  const profileId = request.headers.get("x-profile-id");
  const resolved = await resolveActiveProfile(session.user.id, profileId);
  if (resolved.status === "no_profile") {
    return NextResponse.json({ error: "no_profile" }, { status: 409 });
  }
  if (resolved.status === "invalid_profile") {
    return NextResponse.json({ error: "invalid_profile" }, { status: 400 });
  }

  const results = await listProfileSaved(
    resolved.profile.id,
    "watchlist",
    type
  );
  return NextResponse.json({ results });
}
