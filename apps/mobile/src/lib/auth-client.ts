import { expoClient } from '@better-auth/expo/client';
import {
  GoogleSignin,
  isCancelledResponse,
  isSuccessResponse,
} from '@react-native-google-signin/google-signin';
import { createAuthClient } from 'better-auth/react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { API_URL, saveAccessToken } from './auth';

/**
 * Cliente Better Auth para la app nativa.
 *
 * `expoClient` guarda la cookie/sesión en SecureStore. El login con Google es
 * nativo (SDK de Google), no abre la web: obtenemos un `idToken` en el
 * dispositivo y Better Auth lo valida en el servidor con `signIn.social`.
 */
export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [
    expoClient({
      scheme: 'onevid',
      storagePrefix: 'onevid',
      storage: SecureStore,
    }),
  ],
});

// `webClientId` es el OAuth client de tipo Web: Google lo usa como audiencia
// del idToken y Better Auth lo valida contra GOOGLE_CLIENT_ID.
GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
});

/**
 * Inicia sesión con Google en el propio dispositivo (móvil y Android TV).
 * No abre navegador ni página de código. Si la TV no tiene Play Services o
 * Google no está configurado, lanza un error para que la hoja de login ofrezca
 * el código de dispositivo como respaldo.
 *
 * Devuelve `cancelled` cuando el usuario cierra la ventana de cuentas de
 * Google: eso no es un fallo, así que quien llama no debe mostrar un error.
 */
export type GoogleSignInResult = 'success' | 'cancelled';

export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  if (Platform.OS === 'android') {
    await GoogleSignin.hasPlayServices({
      showPlayServicesUpdateDialog: true,
    });
  }

  const response = await GoogleSignin.signIn();
  // Cerrar el selector de cuentas no es un error: el usuario canceló.
  if (isCancelledResponse(response)) {
    return 'cancelled';
  }
  if (!isSuccessResponse(response) || !response.data.idToken) {
    throw new Error('Vuelve a intentarlo.');
  }

  const { error } = await authClient.signIn.social({
    provider: 'google',
    idToken: { token: response.data.idToken },
  });
  if (error) {
    throw new Error(
      error.message || 'No se pudo validar la sesión de Google.',
    );
  }

  const { data, error: sessionError } = await authClient.getSession();
  const token = data?.session?.token;
  if (sessionError || !token) {
    throw new Error(
      'Google inició sesión, pero no se pudo activar la sesión en la app.',
    );
  }
  await saveAccessToken(token);
  return 'success';
}
