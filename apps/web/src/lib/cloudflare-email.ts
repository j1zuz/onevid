/**
 * Puente entre el Worker entrypoint y el código de la app para el binding
 * `EMAIL` de Cloudflare Email Sending.
 *
 * El entrypoint recibe `env` en cada petición y llama a `setEmailBinding`; así
 * el resto de módulos no necesita importar `cloudflare:workers` (que no existe
 * en `next dev`). Sin binding no se manda correo: en desarrollo se escribe el
 * enlace/código en consola y en producción se falla de forma visible. No hay
 * proveedor alternativo (Resend se retiró).
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

/**
 * Remitente de los correos transaccionales. `EMAIL_FROM` es el nombre actual;
 * se acepta `RESEND_FROM` mientras un despliegue anterior siga sirviendo el
 * binding viejo (mismo valor: una dirección del dominio verificado).
 */
export function getEmailFrom(): string {
  return process.env.EMAIL_FROM ?? process.env.RESEND_FROM ?? "";
}
