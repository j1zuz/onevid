import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { checkRateLimit, type RateLimitResult } from "@/lib/rate-limit";

/**
 * Limitador de ventana fija compartido por todos los isolates.
 *
 * El de `lib/rate-limit.ts` es un `Map` en memoria: en Workers cada isolate
 * tiene su propia cuenta y un atacante multiplica el límite. Este usa Postgres
 * (Hyperdrive) y por eso es global para el despliegue. Si la tabla no existe o
 * la consulta falla, cae al limitador en memoria para no romper la ruta.
 */
export async function checkRateLimitDb(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const safeWindow = Math.max(1, Math.floor(windowMs));
  try {
    const result = await db.execute(sql`
      WITH pruned AS (
        DELETE FROM rate_limit_bucket
        WHERE reset_at < now() - interval '1 day'
      )
      INSERT INTO rate_limit_bucket (key, count, reset_at)
      VALUES (${key}, 1, now() + (${safeWindow}::int * interval '1 millisecond'))
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN rate_limit_bucket.reset_at <= now() THEN 1
          ELSE rate_limit_bucket.count + 1
        END,
        reset_at = CASE
          WHEN rate_limit_bucket.reset_at <= now()
          THEN now() + (${safeWindow}::int * interval '1 millisecond')
          ELSE rate_limit_bucket.reset_at
        END
      RETURNING count, reset_at
    `);

    const row = firstRow(result);
    const count = Number(row?.count ?? 0);
    const resetAt = new Date(String(row?.reset_at ?? Date.now() + safeWindow));
    if (!Number.isFinite(count) || count <= limit) {
      return { ok: true };
    }
    return {
      ok: false,
      retryAfter: Math.max(
        1,
        Math.ceil((resetAt.getTime() - Date.now()) / 1000)
      ),
    };
  } catch {
    return checkRateLimit(`db-fallback:${key}`, limit, windowMs);
  }
}

function firstRow(result: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(result)) {
    return result[0] as Record<string, unknown> | undefined;
  }
  const rows = (result as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(rows)
    ? (rows[0] as Record<string, unknown> | undefined)
    : undefined;
}
