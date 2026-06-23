import * as SecureStore from 'expo-secure-store';

// Preferencia de modo para usuarios CON sesión: 'stream' (catálogo) o 'local'
// (Reproducir video). Sin sesión la app siempre es local, así que esto solo
// aplica cuando hay sesión y permite "salir del modo stream" sin cerrar sesión.
export type AppMode = 'local' | 'stream';

const MODE_KEY = 'onevid_mode';

export async function loadAppMode(): Promise<AppMode> {
  const raw = await SecureStore.getItemAsync(MODE_KEY);
  // Por defecto stream: un usuario logueado espera el catálogo.
  return raw === 'local' ? 'local' : 'stream';
}

export async function setAppMode(mode: AppMode): Promise<void> {
  await SecureStore.setItemAsync(MODE_KEY, mode);
}
