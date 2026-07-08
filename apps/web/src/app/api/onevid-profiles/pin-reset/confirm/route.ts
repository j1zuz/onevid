import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  clearPrimaryProfilePin,
  consumePinResetCode,
} from "@/lib/onevid-profile";

// Verifies the emailed code and, on success, removes the primary profile's lock.
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  let code: string;
  try {
    const body = (await request.json()) as { code?: unknown };
    code = typeof body.code === "string" ? body.code : "";
  } catch {
    return Response.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const ok = await consumePinResetCode(session.user.id, code);
  if (!ok) {
    return Response.json({ error: "code_invalid" }, { status: 403 });
  }

  await clearPrimaryProfilePin(session.user.id);
  return Response.json({ ok: true });
}
