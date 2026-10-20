// Flujo de autorización de dispositivo (OAuth 2.0 Device Authorization, RFC 8628)
// para el login desde una TV o desde la web (p. ej. móvil en el login dialog).
// Equivalente web de apps/mobile/src/lib/auth.ts: el cliente pide un código,
// lo muestra y hace polling; el usuario lo aprueba en /device desde otro
// dispositivo ya autenticado.
//
// /device/token solo devuelve un Bearer (session.token). En navegador hay que
// intercambiarlo por la cookie firmada vía POST /api/auth/device/cookie antes
// de navegar a /home (las páginas RSC leen cookie, no Authorization).

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

async function exchangeAccessTokenForCookie(
  accessToken: string
): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/device/cookie", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ access_token: accessToken }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function pollDeviceToken(deviceCode: string): Promise<PollOutcome> {
  const res = await fetch("/api/auth/device/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: CLIENT_ID,
    }),
  });
  const body = (await res.json().catch(() => null)) as DeviceTokenBody | null;

  if (res.ok && body?.access_token) {
    const cookieSet = await exchangeAccessTokenForCookie(body.access_token);
    if (!cookieSet) {
      return {
        kind: "error",
        message:
          "Se aprobó el código pero no se pudo activar la sesión en este navegador. Intenta de nuevo.",
      };
    }
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
