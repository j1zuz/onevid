import { headers } from "next/headers";
import { renderPinResetEmail } from "@/email/email";
import { auth } from "@/lib/auth";
import { getEmailBinding, getEmailFrom } from "@/lib/cloudflare-email";
import {
  createPinResetCode,
  getPrimaryProfilePinHash,
} from "@/lib/onevid-profile";
import { checkRateLimitDb } from "@/lib/rate-limit-db";
import { rateLimitResponse } from "@/lib/rate-limit";

// Emails a one-time code to the account owner to reset the primary profile PIN.
export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  // Un endpoint autenticado que manda email no puede ser un grifo gratis.
  const limited = await checkRateLimitDb(
    `pin-reset-request:${session.user.id}`,
    3,
    60 * 60 * 1000
  );
  if (!limited.ok) return rateLimitResponse(limited.retryAfter);

  const email = session.user.email;
  if (!email) {
    return Response.json({ error: "no_email" }, { status: 400 });
  }

  // Nothing to reset unless the primary profile is actually locked.
  const hash = await getPrimaryProfilePinHash(session.user.id);
  if (!hash) {
    return Response.json({ error: "no_pin" }, { status: 400 });
  }

  const code = await createPinResetCode(session.user.id);
  const { html, subject } = await renderPinResetEmail(code, email);
  const from = getEmailFrom();

  try {
    const emailBinding = getEmailBinding();
    if (emailBinding) {
      await emailBinding.send({ from, to: email, subject, html });
    } else if (process.env.NODE_ENV === "development") {
      // Local: sin proveedor de correo, el código va a la consola.
      console.info(`[onevid] código de reseteo de PIN (dev): ${code}`);
    } else {
      return Response.json({ error: "email_failed" }, { status: 502 });
    }
  } catch {
    return Response.json({ error: "email_failed" }, { status: 502 });
  }

  return Response.json({ ok: true });
}
