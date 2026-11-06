import { apiFetch, type MediaMeta } from './api';

export type SavedMediaType = 'movie' | 'series' | 'live';

export interface SavedStatus {
  favorite: boolean;
  watchlist: boolean;
}

export async function getSavedStatus(
  mediaType: SavedMediaType,
  mediaId: string,
): Promise<SavedStatus> {
  return apiFetch<SavedStatus>(
    `/api/onevid-saved-status?mediaType=${mediaType}&mediaId=${encodeURIComponent(mediaId)}`,
  );
}

/** Canales de Live TV guardados por el perfil (tipo "live"). */
export interface SavedLiveChannel {
  background?: string;
  id: string;
  name: string;
  poster?: string;
  type: 'live';
}

export async function getSavedLive(
  kind: 'favorite' | 'watchlist',
): Promise<SavedLiveChannel[]> {
  const endpoint =
    kind === 'favorite'
      ? '/api/onevid-favorites'
      : '/api/onevid-watchlist-items';
  const response = await apiFetch<{ results?: SavedLiveChannel[] }>(
    `${endpoint}?type=live`,
  );
  return Array.isArray(response.results)
    ? response.results.filter(
        (item) =>
          item &&
          typeof item.id === 'string' &&
          typeof item.name === 'string',
      )
    : [];
}

/** Estado de favorito/ver-después de varios canales en una sola petición. */
export async function getLiveSavedStatuses(
  ids: string[],
): Promise<Record<string, SavedStatus>> {
  if (ids.length === 0) return {};
  const response = await apiFetch<{
    statuses?: Record<string, SavedStatus>;
  }>('/api/onevid-saved-statuses', {
    method: 'POST',
    body: JSON.stringify({ mediaType: 'live', ids }),
  });
  return response.statuses ?? {};
}

export interface SavedSnapshot {
  name?: string;
  poster?: string;
  background?: string;
  year?: string;
}

export async function setFavorite(
  mediaType: SavedMediaType,
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
  mediaType: SavedMediaType,
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
