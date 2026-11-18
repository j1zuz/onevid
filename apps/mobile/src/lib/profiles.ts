import * as SecureStore from 'expo-secure-store';
import {
  getActiveProfileId,
  setActiveProfileId,
  setActiveProfileToken,
} from './active-profile';
import { apiFetch } from './api';
import { queryClient } from './query';

export interface Profile {
  id: string;
  name: string;
  /** Clave de gradiente ('black', 'blue'…) o 'sticker:<id>'. */
  avatar: string;
  isKids: boolean;
  hasPin?: boolean;
  createdAt?: string;
}

export interface ProfilesResponse {
  profiles: Profile[];
  max: number;
}

const ACTIVE_KEY = 'onevid_active_profile';
const PROFILE_TOKEN_PREFIX = 'onevid_profile_token_';

function profileTokenKey(id: string): string {
  return `${PROFILE_TOKEN_PREFIX}${id}`;
}

// El perfil activo se guarda en SecureStore, pero varias pantallas (p. ej. el
// icono del tab "Perfil") copian su valor a estado local. Sin aviso, tras
// editar el avatar el tab seguía mostrando el anterior hasta cambiar de perfil.
type ActiveProfileListener = (profile: Profile | null) => void;
const activeProfileListeners = new Set<ActiveProfileListener>();

/**
 * Copia en memoria del perfil activo.
 *
 * SecureStore es asíncrono y el tab "Perfil" lee el perfil justo después de
 * elegirlo (antes de que termine la escritura), así que se quedaba con
 * `undefined` y pintaba el avatar negro por defecto en vez del elegido. Con
 * esta copia la lectura es síncrona y siempre coincide con lo seleccionado.
 */
let currentProfile: Profile | null = null;

/** Perfil activo en memoria (síncrono) o null si todavía no se cargó. */
export function getActiveProfileSnapshot(): Profile | null {
  return currentProfile;
}

// Suscriptores del snapshot (sin argumento): los usa `useActiveProfile` con
// `useSyncExternalStore` para repintar el icono del tab aunque el navegador no
// vuelva a evaluar sus `options`.
const profileSnapshotListeners = new Set<() => void>();

export function subscribeProfileSnapshot(listener: () => void): () => void {
  profileSnapshotListeners.add(listener);
  return () => profileSnapshotListeners.delete(listener);
}

function setCurrentProfile(profile: Profile | null) {
  currentProfile = profile;
  for (const listener of profileSnapshotListeners) listener();
}

export function subscribeActiveProfile(
  listener: ActiveProfileListener,
): () => void {
  activeProfileListeners.add(listener);
  return () => activeProfileListeners.delete(listener);
}

function emitActiveProfile(profile: Profile | null) {
  for (const listener of activeProfileListeners) listener(profile);
}

export async function loadActiveProfile(): Promise<Profile | null> {
  const raw = await SecureStore.getItemAsync(ACTIVE_KEY);
  if (!raw) {
    // Sin copia en disco puede ser que `setActiveProfile` aún no haya
    // terminado de escribir: si ya hay perfil en memoria, gana ese.
    if (currentProfile) {
      return currentProfile;
    }
    setActiveProfileId(null);
    return null;
  }
  try {
    const p = JSON.parse(raw) as Profile;
    // Notifica solo si cambió (mismo perfil con el mismo avatar no repinta).
    if (
      !currentProfile ||
      currentProfile.id !== p.id ||
      currentProfile.avatar !== p.avatar ||
      currentProfile.name !== p.name
    ) {
      setCurrentProfile(p);
    }
    setActiveProfileId(p.id);
    setActiveProfileToken(
      await SecureStore.getItemAsync(profileTokenKey(p.id)),
    );
    return p;
  } catch {
    setActiveProfileId(null);
    setActiveProfileToken(null);
    return null;
  }
}

/**
 * Relee el perfil activo: primero la copia local (instantánea y offline) y, si
 * hay red, la lista real del backend.
 *
 * La copia de SecureStore solo se actualiza desde este dispositivo, pero el
 * avatar y el nombre también se pueden cambiar desde la web (misma cuenta), así
 * que el tab "Perfil" —y Configuración— se quedaban con el avatar viejo. Esto
 * los sincroniza en cada focus; sin red devuelve la copia local tal cual.
 */
export async function refreshActiveProfile(): Promise<Profile | null> {
  // Snapshot primero: si el usuario acaba de elegir perfil, la escritura en
  // SecureStore puede no haber terminado y la copia en disco estaría vacía.
  const local =
    getActiveProfileSnapshot() ?? (await loadActiveProfile().catch(() => null));
  if (!local) {
    return null;
  }
  try {
    const { profiles } = await listProfiles();
    const fresh = profiles.find((p) => p.id === local.id);
    if (!fresh) {
      return local;
    }
    if (
      fresh.avatar !== local.avatar ||
      fresh.name !== local.name ||
      fresh.isKids !== local.isKids
    ) {
      // `setActiveProfile` persiste y avisa a los suscriptores (tab, Config).
      await setActiveProfile(fresh);
    }
    return fresh;
  } catch {
    return local;
  }
}

export async function setActiveProfile(p: Profile): Promise<void> {
  const previousId = getActiveProfileId();
  // Síncrono a propósito: el tab "Perfil" (y cualquier suscriptor) tiene que
  // ver el avatar al instante. Antes el aviso llegaba después del `await` de
  // SecureStore, y como la navegación a los tabs ocurre antes, el tab se
  // quedaba con el avatar por defecto hasta el siguiente foco.
  setCurrentProfile(p);
  setActiveProfileId(p.id);
  emitActiveProfile(p);
  // El token firmado solo existe si el perfil tiene PIN y se verificó. Al
  // cambiar a un perfil sin PIN se limpia para no reutilizar una capacidad.
  setActiveProfileToken(
    await SecureStore.getItemAsync(profileTokenKey(p.id)),
  );
  // `apiFetch` manda `X-Profile-Id` en cada llamada, así que la MISMA query key
  // (p. ej. ['continue-watching', lang]) puede tener una respuesta distinta por
  // perfil. Al cambiar de perfil hay que vaciar SOLO lo que es por perfil, para
  // que nadie vea datos del perfil anterior. El catálogo (Inicio, Descubrir,
  // detalle, búsqueda…) NO depende del perfil: se conserva para que al entrar
  // no se vuelva a ver el skeleton (antes se limpiaba todo con `clear()`).
  if (previousId !== p.id) {
    for (const key of ['continue-watching', 'watch-state', 'library', 'saved']) {
      queryClient.removeQueries({ queryKey: [key] });
    }
  }
  await SecureStore.setItemAsync(ACTIVE_KEY, JSON.stringify(p));
}

export async function clearActiveProfile(): Promise<void> {
  setCurrentProfile(null);
  setActiveProfileId(null);
  setActiveProfileToken(null);
  emitActiveProfile(null);
  await SecureStore.deleteItemAsync(ACTIVE_KEY);
}

// ─── API ────────────────────────────────────────────────────────────

export async function listProfiles(): Promise<ProfilesResponse> {
  return apiFetch<ProfilesResponse>('/api/onevid-profiles');
}

export async function createProfile(input: {
  name: string;
  avatar: string;
  isKids: boolean;
  lockPin?: string | null;
  authPin?: string;
}): Promise<Profile> {
  return apiFetch<Profile>('/api/onevid-profiles', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateProfile(
  id: string,
  input: {
    name?: string;
    avatar?: string;
    isKids?: boolean;
    lockPin?: string | null;
    authPin?: string;
  },
): Promise<Profile> {
  return apiFetch<Profile>(`/api/onevid-profiles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteProfile(id: string, authPin?: string): Promise<void> {
  await apiFetch(`/api/onevid-profiles/${id}`, {
    method: 'DELETE',
    headers: authPin ? { 'X-Profile-Pin': authPin } : undefined,
  });
}

/** Verify a profile's own lock PIN (used when selecting a locked profile). */
export async function verifyProfilePin(
  id: string,
  pin: string,
): Promise<boolean> {
  const r = await apiFetch<{ ok: boolean; token?: string }>(
    `/api/onevid-profiles/${id}/verify`,
    { method: 'POST', body: JSON.stringify({ pin }) },
  );
  if (r?.ok && typeof r.token === 'string' && r.token) {
    setActiveProfileToken(r.token);
    await SecureStore.setItemAsync(profileTokenKey(id), r.token);
  }
  return Boolean(r?.ok);
}

/** Email an OTP to reset (remove) the primary profile's management PIN. */
export async function requestPinReset(): Promise<void> {
  await apiFetch('/api/onevid-profiles/pin-reset/request', { method: 'POST' });
}

/** Confirm the emailed OTP; on success the primary profile's lock is removed. */
export async function confirmPinReset(code: string): Promise<boolean> {
  const r = await apiFetch<{ ok: boolean }>(
    '/api/onevid-profiles/pin-reset/confirm',
    { method: 'POST', body: JSON.stringify({ code }) },
  );
  return Boolean(r?.ok);
}
