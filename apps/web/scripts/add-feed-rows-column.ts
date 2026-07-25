/**
 * Añade `one_vid.feed_rows` (jsonb) — el feed de inicio configurable.
 *
 * `drizzle-kit push` necesita TTY (falla en scripts/CI), así que el DDL se
 * aplica con pg directo. Es idempotente: se puede correr en cualquier entorno
 * las veces que haga falta.
 *
 *   cd apps/web && bun run scripts/add-feed-rows-column.ts
 */
import { config } from "dotenv";
import { Pool } from "pg";

// En apps/web la DATABASE_URL vive en .env.local, no en .env.
config({ path: ".env.local" });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("Falta DATABASE_URL (revisa apps/web/.env.local)");
  process.exit(1);
}

const pool = new Pool({ connectionString });

try {
  await pool.query(
    'ALTER TABLE "one_vid" ADD COLUMN IF NOT EXISTS "feed_rows" jsonb;'
  );
  console.log("ok: one_vid.feed_rows");
} finally {
  await pool.end();
}
