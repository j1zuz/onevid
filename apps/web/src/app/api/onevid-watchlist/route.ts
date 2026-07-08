import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  resolveActiveProfile,
  type SavedInput,
  setProfileSaved,
} from "@/lib/onevid-profile";

const NUMERIC_ID_RE = /^\d+$/;

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  let mediaId: string;
  let mediaType: string;
  let value: boolean;
  let extra: Partial<SavedInput>;
  try {
    const body = (await request.json()) as {
      mediaId?: unknown;
      mediaType?: unknown;
      value?: unknown;
      name?: unknown;
      poster?: unknown;
      background?: unknown;
      year?: unknown;
    };
    mediaId =
      typeof body.mediaId === "number"
        ? String(body.mediaId)
        : String(body.mediaId ?? "").trim();
    mediaType = String(body.mediaType ?? "")
      .trim()
      .toLowerCase();
    value = Boolean(body.value);
    extra = {
      name: typeof body.name === "string" ? body.name : undefined,
      poster: typeof body.poster === "string" ? body.poster : undefined,
      background:
        typeof body.background === "string" ? body.background : undefined,
      year: typeof body.year === "string" ? body.year : undefined,
    };
  } catch {
    return Response.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  if (!NUMERIC_ID_RE.test(mediaId)) {
    return Response.json({ error: "mediaId inválido" }, { status: 400 });
  }
  if (mediaType !== "movie" && mediaType !== "series") {
    return Response.json({ error: "mediaType inválido" }, { status: 400 });
  }

  const profileId = request.headers.get("x-profile-id");
  const resolved = await resolveActiveProfile(session.user.id, profileId);
  if (resolved.status === "no_profile") {
    return Response.json({ error: "no_profile" }, { status: 409 });
  }
  if (resolved.status === "invalid_profile") {
    return Response.json({ error: "invalid_profile" }, { status: 400 });
  }

  await setProfileSaved(
    resolved.profile.id,
    "watchlist",
    { mediaId, mediaType, ...extra },
    value
  );
  return Response.json({ ok: true, watchlist: value });
}
