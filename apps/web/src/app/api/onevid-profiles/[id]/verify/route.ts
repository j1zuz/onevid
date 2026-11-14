import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  getProfilePinHashById,
  registerProfilePinFailure,
  resetProfilePinFailures,
  verifyPin,
} from "@/lib/onevid-profile";
import {
  mintProfileToken,
  profileTokenCookie,
} from "@/lib/profile-token";
import { checkRateLimitDb } from "@/lib/rate-limit-db";
import { rateLimitResponse } from "@/lib/rate-limit";

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

  // Un PIN de 4 dígitos sin límite es un oráculo de 10.000 intentos. El
  // limitador es por isolate; la regla de borde sigue siendo necesaria, pero
  // esto corta el abuso trivial desde una sesión.
  const limited = await checkRateLimitDb(
    `profile-pin-verify:${session.user.id}:${id}`,
    10,
    60_000
  );
  if (!limited.ok) return rateLimitResponse(limited.retryAfter);

  let pin: string;
  try {
    const body = (await request.json()) as { pin?: unknown };
    pin = typeof body.pin === "string" ? body.pin : "";
  } catch {
    return Response.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const { found, hash, lockedUntil } = await getProfilePinHashById(
    session.user.id,
    id
  );
  if (!found) {
    return Response.json({ error: "invalid_profile" }, { status: 400 });
  }

  // No lock on this profile → nothing to verify and no token needed.
  if (!hash) {
    return Response.json({ ok: true });
  }

  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    const retryAfter = Math.max(
      1,
      Math.ceil((lockedUntil.getTime() - Date.now()) / 1000)
    );
    return Response.json(
      { error: "pin_locked", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  const ok = Boolean(pin) && (await verifyPin(hash, pin));
  if (!ok) {
    const failure = await registerProfilePinFailure(id);
    if (failure.locked) {
      const retryAfter = Math.max(
        1,
        Math.ceil(
          ((failure.lockedUntil?.getTime() ?? Date.now()) - Date.now()) / 1000
        )
      );
      return Response.json(
        { error: "pin_locked", retryAfter },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }
    return Response.json({ ok: false });
  }

  await resetProfilePinFailures(id);

  // Token firmado y ligado a (usuario, perfil, hash del PIN). Es lo que el
  // servidor exige para las rutas de datos del perfil; la cookie de UI no
  // autoriza nada, y cambiar el PIN invalida el token anterior.
  const token = mintProfileToken(session.user.id, id, hash);
  if (!token) {
    return Response.json(
      { error: "La verificación de perfiles no está configurada" },
      { status: 500 }
    );
  }

  return Response.json(
    { ok: true, token },
    { headers: { "Set-Cookie": profileTokenCookie(token) } }
  );
}
