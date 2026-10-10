// Flujo de autorización de dispositivo (OAuth 2.0 Device Authorization, RFC 8628)
// para el login desde una TV. Es el equivalente web de apps/mobile/src/lib/auth.ts:
// la TV pide un código, lo muestra en pantalla y hace polling; el usuario lo
// aprueba desde el teléfono en /device.
//
// Diferencia con el móvil: aquí corremos en un navegador REAL y al mismo origen,
// así que no hace falta guardar un Bearer. Al aprobarse, /device/token llama a
// `setNewSession` en el backend y deja la COOKIE de sesión en este navegador
// (verificado en el handler de better-auth), por lo que el resto de la web
// funciona tal cual y basta con navegar a /home.

// Mismo client_id que la app móvil (hackw-tv); el backend no valida el id
// (sin `validateClient`), pero mantenerlo igual alinea telemetría y reglas.
const CLIENT_ID = "hackw-tv";
const SCOPE = "openid profile email";

export interface DeviceCodeData {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export async function requestDeviceCode(): Promise<DeviceCodeData> {
  const res = await fetch("/api/auth/device/code", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: SCOPE }),
  });
  if (!res.ok) {
    throw new Error(`No se pudo generar el código (HTTP ${res.status}).`);
  }
  return (await res.json()) as DeviceCodeData;
}

export type PollOutcome =
  | { kind: "approved" }
  // `intervalDelta` sube el intervalo de polling cuando el server pide "slow_down".
  | { kind: "pending"; intervalDelta: number }
  | { kind: "denied" }
  | { kind: "expired" }
  | { kind: "error"; message: string };

interface DeviceTokenBody {
  access_token?: string;
  error?: string;
  error_description?: string;
}

export async function pollDeviceToken(deviceCode: string): Promise<PollOutcome> {
  const res = await fetch("/api/auth/device/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: CLIENT_ID,
    }),
  });
  const body = (await res.json().catch(() => null)) as DeviceTokenBody | null;
  // Éxito: el backend ya dejó la cookie de sesión en este navegador.
  if (res.ok && body?.access_token) {
    return { kind: "approved" };
  }
  switch (body?.error) {
    case "authorization_pending":
      return { kind: "pending", intervalDelta: 0 };
    case "slow_down":
      return { kind: "pending", intervalDelta: 5 };
    case "access_denied":
      return { kind: "denied" };
    case "expired_token":
      return { kind: "expired" };
    default:
      return {
        kind: "error",
        message:
          body?.error_description ??
          "Ocurrió un error inesperado. Vuelve a intentarlo.",
      };
  }
}
