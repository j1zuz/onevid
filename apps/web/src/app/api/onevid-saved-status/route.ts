import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getProfileSavedStatus,
  resolveActiveProfile,
} from "@/lib/onevid-profile";

const NUMERIC_ID_RE = /^\d+$/;

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const mediaType = searchParams.get("mediaType")?.trim().toLowerCase();
  const mediaId = searchParams.get("mediaId")?.trim();

  if (mediaType !== "movie" && mediaType !== "series") {
    return NextResponse.json({ error: "mediaType inválido" }, { status: 400 });
  }
  if (!(mediaId && NUMERIC_ID_RE.test(mediaId))) {
    return NextResponse.json({ error: "mediaId inválido" }, { status: 400 });
  }

  const profileId = request.headers.get("x-profile-id");
  const resolved = await resolveActiveProfile(session.user.id, profileId);
  if (resolved.status === "no_profile") {
    return NextResponse.json({ error: "no_profile" }, { status: 409 });
  }
  if (resolved.status === "invalid_profile") {
    return NextResponse.json({ error: "invalid_profile" }, { status: 400 });
  }

  const status = await getProfileSavedStatus(
    resolved.profile.id,
    mediaType,
    mediaId
  );
  return NextResponse.json(status);
}
