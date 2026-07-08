import * as SecureStore from 'expo-secure-store';

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://www.hackw.tech';
export const CLIENT_ID =
  process.env.EXPO_PUBLIC_HACKW_CLIENT_ID ?? 'hackw-tv';
export const SCOPE = 'openid profile email';

const TOKEN_KEY = 'hackw_access_token';

// User-Agent que identifica a la app como "onevid". Va en TODAS las peticiones
// al backend para que en Cloudflare se pueda crear una regla (WAF Skip) que
// matchee `http.user_agent contains "onevid"` y deje pasar solo el tráfico de la
// app, sin bajar la protección del resto. Mantiene tokens de navegador para no
// disparar detecciones genéricas por UA "vacío" de apps nativas.
const APP_UA =
  'onevid-app/1.0 (Android) Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

// Header propio adicional (por si prefieres matchear por header en vez de UA).
export const APP_CLIENT_HEADER = 'X-Onevid-Client';
export const APP_CLIENT_TOKEN = 'onevid';

// Cabeceras comunes que identifican a la app ante Cloudflare. Se reúsan en todas
// las peticiones (api.ts y las de auth aquí).
export const appClientHeaders = (): Record<string, string> => ({
  'User-Agent': APP_UA,
  [APP_CLIENT_HEADER]: APP_CLIENT_TOKEN,
});

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
  // como `Authorization: Bearer ...`. Better Auth usa sesiones (30 días) y NO
  // emite refresh_token, así que no hay nada que renovar; cuando la sesión
  // expira se vuelve a iniciar con el flujo de dispositivo.
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
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...appClientHeaders(),
      },
      body: JSON.stringify({ client_id: CLIENT_ID, scope: SCOPE }),
    });
  } catch (e) {
    throw new Error(
      `No se pudo contactar a ${API_URL}. Revisa tu conexión o la URL del servidor.`,
    );
  }
  if (!res.ok) {
    // Cloudflare puede interponer un "managed challenge" (página "Just a
    // moment...") a la petición nativa: responde 403 con HTML, no JSON. No es
    // un fallo de la app; hay que permitir /api/auth/device/* en Cloudflare.
    const contentType = res.headers.get('content-type') ?? '';
    const cfChallenge =
      res.headers.get('cf-mitigated') === 'challenge' ||
      contentType.includes('text/html');
    if (cfChallenge) {
      throw new Error(
        'El servidor bloqueó la solicitud (protección de Cloudflare). Hay que permitir el endpoint de inicio de sesión en Cloudflare.',
      );
    }
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
    headers: { 'Content-Type': 'application/json', ...appClientHeaders() },
    body: JSON.stringify({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: CLIENT_ID,
    }),
  });
  // Cloudflare puede interponer un "managed challenge" (HTML, no JSON) a esta
  // petición de polling: el token nunca llega y la sesión no se guarda. Lo
  // detectamos para mostrar un error claro en vez de uno genérico.
  const contentType = res.headers.get('content-type') ?? '';
  if (
    res.headers.get('cf-mitigated') === 'challenge' ||
    contentType.includes('text/html')
  ) {
    return {
      kind: 'error',
      message:
        'El servidor bloqueó la solicitud (protección de Cloudflare). Hay que permitir el endpoint de inicio de sesión en Cloudflare.',
    };
  }
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

// El backend usa Better Auth (sesiones de 30 días), no OAuth con refresh: el
// `access_token` que guardamos ES el token de sesión y se valida como Bearer.
// Por eso, al arrancar, no basta con saber que existe un token: hay que
// preguntarle al backend si la sesión sigue viva.
//
// IMPORTANTE: validamos contra /api/onevid-setup-complete, NO contra
// /api/auth/get-session. El endpoint público get-session devuelve 200 con cuerpo
// `null` para el Bearer del flujo de dispositivo (no lo reconoce), lo que hacía
// que borráramos un token VÁLIDO y la sesión no sobreviviera al reinicio. Los
// endpoints onevid usan `auth.api.getSession` internamente, que SÍ lee el Bearer:
// responden 401 sin sesión y 200 con sesión. Por eso son un check fiable.
export async function validateSession(): Promise<boolean> {
  const token = await getAccessToken();
  if (!token) return false;
  try {
    const res = await fetch(`${API_URL}/api/onevid-setup-complete`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...appClientHeaders(),
      },
    });
    // Solo un 401/403 (sesión inválida/expirada) limpia el token. Un 200 o
    // cualquier error no-auth (5xx, red) conserva la sesión para no expulsar al
    // usuario por un fallo puntual.
    if (res.status === 401 || res.status === 403) {
      await clearAccessToken();
      return false;
    }
    return true;
  } catch {
    // Sin red no podemos validar: conservamos el token y dejamos pasar.
    return true;
  }
}
