import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { parseLiveSavedId } from "@/lib/live-tv-saved";
import {
  listProfileSavedStatuses,
  resolveActiveProfile,
  type SavedMediaKind,
} from "@/lib/onevid-profile";

const NUMERIC_ID_RE = /^\d+$/;
const MAX_IDS = 12;

/**
 * Estado favorito/ver-después de varios títulos a la vez. La guía de Live TV
 * muestra 10 canales por página y no queremos 20 peticiones por render.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  let mediaType: string;
  let ids: string[];
  try {
    const body = (await request.json()) as {
      mediaType?: unknown;
      ids?: unknown;
    };
    mediaType = String(body.mediaType ?? "")
      .trim()
      .toLowerCase();
    ids = Array.isArray(body.ids)
      ? body.ids.map((id) => String(id).trim()).filter(Boolean)
      : [];
  } catch {
    return Response.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  if (
    mediaType !== "movie" &&
    mediaType !== "series" &&
    mediaType !== "live"
  ) {
    return Response.json({ error: "mediaType inválido" }, { status: 400 });
  }
  if (ids.length === 0 || ids.length > MAX_IDS) {
    return Response.json({ error: "ids inválidos" }, { status: 400 });
  }
  const unique = [...new Set(ids)];
  if (
    unique.some((id) =>
      mediaType === "live"
        ? !parseLiveSavedId(id)
        : id.length > 32 || !NUMERIC_ID_RE.test(id)
    )
  ) {
    return Response.json({ error: "ids inválidos" }, { status: 400 });
  }

  const profileId = request.headers.get("x-profile-id");
  const resolved = await resolveActiveProfile(session.user.id, profileId);
  if (resolved.status === "no_profile") {
    return Response.json({ error: "no_profile" }, { status: 409 });
  }
  if (resolved.status === "invalid_profile") {
    return Response.json({ error: "invalid_profile" }, { status: 400 });
  }

  const statuses = await listProfileSavedStatuses(
    resolved.profile.id,
    mediaType as SavedMediaKind,
    unique
  );
  return Response.json({ statuses });
}
