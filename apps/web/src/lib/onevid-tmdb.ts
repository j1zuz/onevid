/**
 * TMDB reads use a single owner-owned v4 read token (`TMDB_APP_READ_TOKEN`)
 * shared by every user, so nobody connects their own TMDB account. TMDB is only
 * ever used for reads (metadata, search, images, logos, trailers); favorites,
 * watchlist and progress live in onevid's own DB per profile.
 */
export function getTmdbReadToken(): string | null {
  return process.env.TMDB_APP_READ_TOKEN ?? null;
}
