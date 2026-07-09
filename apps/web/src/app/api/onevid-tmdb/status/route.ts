import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getOneVidTmdb } from "@/lib/onevid-tmdb";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user?.id) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const { linked } = await getOneVidTmdb(session.user.id);
  return Response.json({ linked });
}
