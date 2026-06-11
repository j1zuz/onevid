import * as SecureStore from 'expo-secure-store';

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://www.hackw.tech';
export const CLIENT_ID =
  process.env.EXPO_PUBLIC_HACKW_CLIENT_ID ?? 'hackw-tv';
export const SCOPE = 'openid profile email';

const TOKEN_KEY = 'hackw_access_token';

export interface DeviceCodeData {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface DeviceTokenSuccess {
  // `access_token` es el token de sesión de Better Auth: se guarda y se manda
  // como `Authorization: Bearer ...`. Better Auth usa sesiones (7 días por
  // defecto) y NO emite refresh_token, así que no hay nada que renovar; cuando
  // la sesión expira se vuelve a iniciar con el flujo de dispositivo.
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export type DeviceTokenError =
  | 'authorization_pending'
  | 'slow_down'
  | 'access_denied'
  | 'expired_token'
  | string;

interface BetterAuthError {
  error: DeviceTokenError;
  error_description?: string;
}

export async function requestDeviceCode(): Promise<DeviceCodeData> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/auth/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: CLIENT_ID, scope: SCOPE }),
    });
  } catch (e) {
    throw new Error(
      `No se pudo contactar a ${API_URL}. Revisa tu conexión o la URL del servidor.`,
    );
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as BetterAuthError | null;
    if (err?.error_description) {
      throw new Error(err.error_description);
    }
    if (res.status >= 500) {
      throw new Error(
        `Error del servidor (HTTP ${res.status}). El endpoint /api/auth/device/code está fallando en el backend.`,
      );
    }
    throw new Error(`device/code HTTP ${res.status}`);
  }
  return (await res.json()) as DeviceCodeData;
}

export type PollOutcome =
  | { kind: 'approved'; token: DeviceTokenSuccess }
  | { kind: 'pending'; intervalDelta: number }
  | { kind: 'denied' }
  | { kind: 'expired' }
  | { kind: 'error'; message: string };

export async function pollDeviceToken(deviceCode: string): Promise<PollOutcome> {
  const res = await fetch(`${API_URL}/api/auth/device/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: CLIENT_ID,
    }),
  });
  const body = (await res.json().catch(() => null)) as
    | DeviceTokenSuccess
    | BetterAuthError
    | null;
  if (res.ok && body && 'access_token' in body) {
    return { kind: 'approved', token: body };
  }
  const err = body && 'error' in body ? body : null;
  switch (err?.error) {
    case 'authorization_pending':
      return { kind: 'pending', intervalDelta: 0 };
    case 'slow_down':
      return { kind: 'pending', intervalDelta: 5 };
    case 'access_denied':
      return { kind: 'denied' };
    case 'expired_token':
      return { kind: 'expired' };
    default:
      return {
        kind: 'error',
        message:
          err?.error_description ??
          'Ocurrió un error inesperado. Vuelve a intentarlo.',
      };
  }
}

export async function saveAccessToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearAccessToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

// El backend usa Better Auth (sesiones de 7 días), no OAuth con refresh: el
// `access_token` que guardamos ES el token de sesión y se valida como Bearer.
// Por eso, al arrancar, no basta con saber que existe un token: hay que
// preguntarle al backend si la sesión sigue viva. Devuelve true sólo si
// /api/auth/get-session responde con una sesión válida.
export async function validateSession(): Promise<boolean> {
  const token = await getAccessToken();
  if (!token) return false;
  try {
    const res = await fetch(`${API_URL}/api/auth/get-session`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      // 401/403 → sesión inválida o expirada: limpiamos para volver al login.
      if (res.status === 401 || res.status === 403) {
        await clearAccessToken();
      }
      return false;
    }
    const data = (await res.json().catch(() => null)) as {
      session?: unknown;
    } | null;
    // Better Auth devuelve `null` (cuerpo vacío) si no hay sesión válida.
    if (!data || !data.session) {
      await clearAccessToken();
      return false;
    }
    return true;
  } catch {
    // Sin red no podemos validar: conservamos el token y dejamos pasar para no
    // expulsar al usuario por un fallo de conexión puntual.
    return true;
  }
}
