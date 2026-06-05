import * as SecureStore from 'expo-secure-store';
import { setActiveProfileId } from './active-profile';
import { apiFetch } from './api';
import type { AvatarKey } from './avatars';

export interface Profile {
  id: string;
  name: string;
  avatar: AvatarKey;
  isKids: boolean;
  hasPin?: boolean;
  createdAt?: string;
}

export interface ProfilesResponse {
  profiles: Profile[];
  max: number;
}

const ACTIVE_KEY = 'onevid_active_profile';

export async function loadActiveProfile(): Promise<Profile | null> {
  const raw = await SecureStore.getItemAsync(ACTIVE_KEY);
  if (!raw) {
    setActiveProfileId(null);
    return null;
  }
  try {
    const p = JSON.parse(raw) as Profile;
    setActiveProfileId(p.id);
    return p;
  } catch {
    setActiveProfileId(null);
    return null;
  }
}

export async function setActiveProfile(p: Profile): Promise<void> {
  setActiveProfileId(p.id);
  await SecureStore.setItemAsync(ACTIVE_KEY, JSON.stringify(p));
}

export async function clearActiveProfile(): Promise<void> {
  setActiveProfileId(null);
  await SecureStore.deleteItemAsync(ACTIVE_KEY);
}

// ─── API ────────────────────────────────────────────────────────────

export async function listProfiles(): Promise<ProfilesResponse> {
  return apiFetch<ProfilesResponse>('/api/onevid-profiles');
}

export async function createProfile(input: {
  name: string;
  avatar: AvatarKey;
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
    avatar?: AvatarKey;
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
  const r = await apiFetch<{ ok: boolean }>(
    `/api/onevid-profiles/${id}/verify`,
    { method: 'POST', body: JSON.stringify({ pin }) },
  );
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
