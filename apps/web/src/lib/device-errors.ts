/**
 * Maps better-auth device-flow errors to friendly Spanish copy. The raw
 * `error_description` from better-auth is an English, developer-facing string
 * (e.g. "Device code has not been claimed by a verifying session; call
 * `GET /device`…") and must never be shown to end users.
 */
interface DeviceAuthError {
  code?: string;
  error?: string;
  error_description?: string;
  message?: string;
  status?: number;
}

export function getDeviceErrorMessage(
  err: DeviceAuthError | null | undefined,
  fallback: string
): string {
  const key = `${err?.code ?? ""} ${err?.error ?? ""}`.toLowerCase();
  const text =
    `${err?.error_description ?? ""} ${err?.message ?? ""}`.toLowerCase();

  if (key.includes("expired") || text.includes("expired")) {
    return "El código expiró. Genera uno nuevo en tu TV e inténtalo otra vez.";
  }
  if (text.includes("not been claimed") || text.includes("verifying session")) {
    return "Primero valida el código en este dispositivo antes de autorizarlo.";
  }
  if (
    key.includes("not_found") ||
    key.includes("invalid") ||
    text.includes("not found") ||
    text.includes("invalid") ||
    err?.status === 404
  ) {
    return "El código no es válido. Revisa que lo hayas escrito bien.";
  }
  if (key.includes("denied") || text.includes("denied")) {
    return "La autorización fue rechazada.";
  }
  return fallback;
}
