import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getProfilePinHashById, verifyPin } from "@/lib/onevid-profile";

// Verifies a single profile's lock PIN when selecting it (Netflix-style).
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }
  const { id } = await context.params;

  let pin: string;
  try {
    const body = (await request.json()) as { pin?: unknown };
    pin = typeof body.pin === "string" ? body.pin : "";
  } catch {
    return Response.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const { found, hash } = await getProfilePinHashById(session.user.id, id);
  if (!found) {
    return Response.json({ error: "invalid_profile" }, { status: 400 });
  }

  // No lock on this profile → nothing to verify.
  if (!hash) {
    return Response.json({ ok: true });
  }

  const ok = Boolean(pin) && (await verifyPin(hash, pin));
  return Response.json({ ok });
}
