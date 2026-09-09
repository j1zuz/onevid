const logoCache = new Map<string, Promise<string | null>>();

export function getTmdbLogo(
  type: "movie" | "series",
  id: string
): Promise<string | null> {
  const key = `${type}:${id}`;
  const cached = logoCache.get(key);
  if (cached) {
    return cached;
  }

  const request = fetch(
    `/api/tmdb-logo?type=${type}&id=${encodeURIComponent(id)}`
  )
    .then((res) =>
      res.ok ? (res.json() as Promise<{ logo?: string | null }>) : null
    )
    .then((data) => data?.logo ?? null)
    .catch(() => null);

  logoCache.set(key, request);
  return request;
}
