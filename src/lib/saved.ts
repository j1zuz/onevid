import * as WebBrowser from 'expo-web-browser';
import { apiFetch, type MediaMeta } from './api';

const TMDB_REDIRECT = '1vid://tmdb-approved';

/** Thrown (by message) when the user hasn't linked their TMDB account yet. */
export function isNotLinkedError(e: unknown): boolean {
  return e instanceof Error && e.message === 'tmdb_not_linked';
}

export async function getTmdbLinked(): Promise<boolean> {
  const r = await apiFetch<{ linked: boolean }>('/api/onevid-tmdb/status');
  return Boolean(r?.linked);
}

/**
 * Run the one-time TMDB approval flow: ask hackw for a request token + approve
 * URL, open it in an auth session, then exchange the (now approved) token for a
 * stored user access token. Returns whether the account ended up linked.
 */
export async function connectTmdb(): Promise<boolean> {
  const { approveUrl, request_token } = await apiFetch<{
    approveUrl: string;
    request_token: string;
  }>('/api/onevid-tmdb/connect-start', {
    method: 'POST',
    body: JSON.stringify({ redirect_to: TMDB_REDIRECT }),
  });

  const result = await WebBrowser.openAuthSessionAsync(
    approveUrl,
    TMDB_REDIRECT,
  );
  if (result.type !== 'success') return false;

  const finish = await apiFetch<{ linked: boolean }>(
    '/api/onevid-tmdb/connect-finish',
    { method: 'POST', body: JSON.stringify({ request_token }) },
  );
  return Boolean(finish?.linked);
}

export async function disconnectTmdb(): Promise<void> {
  await apiFetch('/api/onevid-tmdb/disconnect', { method: 'POST' });
}

export interface SavedStatus {
  favorite: boolean;
  watchlist: boolean;
}

export async function getSavedStatus(
  mediaType: 'movie' | 'series',
  mediaId: string,
): Promise<SavedStatus> {
  return apiFetch<SavedStatus>(
    `/api/onevid-saved-status?mediaType=${mediaType}&mediaId=${encodeURIComponent(mediaId)}`,
  );
}

export interface SavedSnapshot {
  name?: string;
  poster?: string;
  background?: string;
  year?: string;
}

export async function setFavorite(
  mediaType: 'movie' | 'series',
  mediaId: string,
  value: boolean,
  snapshot?: SavedSnapshot,
): Promise<void> {
  await apiFetch('/api/onevid-favorite', {
    method: 'POST',
    body: JSON.stringify({ mediaId, mediaType, value, ...snapshot }),
  });
}

export async function setWatchlist(
  mediaType: 'movie' | 'series',
  mediaId: string,
  value: boolean,
  snapshot?: SavedSnapshot,
): Promise<void> {
  await apiFetch('/api/onevid-watchlist', {
    method: 'POST',
    body: JSON.stringify({ mediaId, mediaType, value, ...snapshot }),
  });
}

export async function getFavorites(
  type: 'movie' | 'series',
): Promise<MediaMeta[]> {
  const r = await apiFetch<{ results: MediaMeta[] }>(
    `/api/onevid-favorites?type=${type}`,
  );
  return r.results ?? [];
}

export async function getWatchlistItems(
  type: 'movie' | 'series',
): Promise<MediaMeta[]> {
  const r = await apiFetch<{ results: MediaMeta[] }>(
    `/api/onevid-watchlist-items?type=${type}`,
  );
  return r.results ?? [];
}
