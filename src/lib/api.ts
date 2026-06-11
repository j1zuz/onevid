import { getActiveProfileId } from './active-profile';
import { API_URL, clearAccessToken, getAccessToken } from './auth';

// Rewrite TMDB image URLs to higher resolution. Backend defaults to smaller
// sizes (w300 for stills, w780 for backdrops) which are blurry on HiDPI mobile
// screens. Pass `targetSize` for the desired bucket; default 'w780' suits
// medium images, 'w1280' is best for hero/full-width.
const TMDB_SIZE_RE =
  /image\.tmdb\.org\/t\/p\/(w92|w154|w185|w300|w342|w500|w780|w1280|original)\//;

export function tmdbImage(
  url: string | undefined,
  targetSize: 'w500' | 'w780' | 'w1280' | 'original' = 'w780',
): string | undefined {
  if (!url) return url;
  return url.replace(TMDB_SIZE_RE, `image.tmdb.org/t/p/${targetSize}/`);
}

export interface CastMember {
  id: string;
  name: string;
  character?: string;
  profile?: string;
}

export interface NetworkInfo {
  id: number;
  name: string;
  logo?: string;
}

export interface MediaMeta {
  id: string;
  name: string;
  type: 'movie' | 'series';
  year?: string;
  poster?: string;
  background?: string;
  description?: string;
  genres?: string[];
  imdbId?: string;
  imdbRating?: string;
  logo?: string;
  cast?: CastMember[];
  director?: string[];
  networks?: NetworkInfo[];
  status?: string;
  runtime?: number;
  episodeRunTime?: number;
  releaseDate?: string;
  related?: MediaMeta[];
}

export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = await getAccessToken();
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const profileId = getActiveProfileId();
  if (profileId && !headers.has('X-Profile-Id')) {
    headers.set('X-Profile-Id', profileId);
  }
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  // Sesión inválida/expirada (Better Auth): limpiamos el token para que el
  // próximo arranque caiga al login en vez de reintentar con un token muerto.
  if (res.status === 401) {
    await clearAccessToken();
  }
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  if (!res.ok) {
    let message = `${path} HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed?.error) message = parsed.error;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${path}: respuesta inválida del servidor`);
  }
}

