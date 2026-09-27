import { apiFetch, type MediaMeta } from './api';

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
