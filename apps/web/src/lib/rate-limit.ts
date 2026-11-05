/**
 * Limitador de ventana fija en memoria.
 *
 * No sustituye a un limitador distribuido (cada instancia serverless lleva su
 * propia cuenta), pero corta el abuso obvio de endpoints caros desde una misma
 * sesion: fan-out a addons, catalogos Xtream y creacion de torrents.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 10_000;

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfter: number };

function pruneExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();

  if (buckets.size >= MAX_TRACKED_KEYS) {
    pruneExpired(now);
    // Si aun asi esta lleno, vaciamos para no crecer sin control. Preferimos
    // perder el estado del limitador antes que agotar memoria.
    if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear();
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  if (bucket.count >= limit) {
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return { ok: true };
}

export function rateLimitResponse(retryAfter: number): Response {
  return Response.json(
    {
      error:
        "Demasiadas solicitudes. Espera unos segundos antes de volver a intentarlo.",
    },
    {
      status: 429,
      headers: {
        "Cache-Control": "private, no-store",
        "Retry-After": String(retryAfter),
      },
    }
  );
}
