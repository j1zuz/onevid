import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// expo-secure-store NO funciona en web (su implementación web es un no-op:
// `export default {}`), así que en el emulador/build web el token y el perfil
// nunca se guardaban y la sesión se perdía al recargar. Aquí usamos
// localStorage en web y SecureStore en nativo. Guardamos `typeof localStorage`
// porque el render estático de Expo Router (web output: "static") ejecuta el
// código en Node, donde no existe localStorage.
function webStorageAvailable(): boolean {
  return Platform.OS === 'web' && typeof localStorage !== 'undefined';
}

export async function storageSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (webStorageAvailable()) localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function storageGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return webStorageAvailable() ? localStorage.getItem(key) : null;
  }
  return SecureStore.getItemAsync(key);
}

export async function storageDelete(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (webStorageAvailable()) localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
