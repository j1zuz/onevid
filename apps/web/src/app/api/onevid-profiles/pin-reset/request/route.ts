import { headers } from "next/headers";
import { Resend } from "resend";
import { renderPinResetEmail } from "@/email/email";
import { auth } from "@/lib/auth";
import {
  createPinResetCode,
  getPrimaryProfilePinHash,
} from "@/lib/onevid-profile";

const resend = new Resend(process.env.RESEND_API_KEY ?? "");

// Emails a one-time code to the account owner to reset the primary profile PIN.
export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

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
  const from = process.env.RESEND_FROM ?? "";
  const { error } = await resend.emails.send({
    from,
    to: email,
    subject,
    html,
  });
  if (error) {
    return Response.json({ error: "email_failed" }, { status: 502 });
  }

  return Response.json({ ok: true });
}
