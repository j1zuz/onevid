/**
 * Puente entre el Worker entrypoint y el código de la app para el binding
 * `EMAIL` de Cloudflare Email Sending.
 *
 * El entrypoint recibe `env` en cada petición y llama a `setEmailBinding`; así
 * el resto de módulos no necesita importar `cloudflare:workers` (que no existe
 * en `next dev`). Si no hay binding (desarrollo local), los llamadores usan
 * Resend como fallback.
 */
export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailMessage {
  to: string | EmailAddress | Array<string | EmailAddress>;
  from: string | EmailAddress;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string | EmailAddress;
}

export interface CloudflareEmailBinding {
  send(message: EmailMessage): Promise<{ messageId: string }>;
}

let binding: CloudflareEmailBinding | undefined;

export function setEmailBinding(value: unknown): void {
  binding = value as CloudflareEmailBinding | undefined;
}

export function getEmailBinding(): CloudflareEmailBinding | undefined {
  return binding;
}
