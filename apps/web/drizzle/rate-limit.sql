-- Fixed-window rate limit shared across Worker isolates.
-- The in-memory limiter in lib/rate-limit.ts is per-isolate; this table is the
-- distributed fallback for auth, profile PIN, debrid and metadata routes.

CREATE TABLE IF NOT EXISTS "rate_limit_bucket" (
  "key" text PRIMARY KEY NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  "reset_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "rate_limit_bucket_reset_at"
  ON "rate_limit_bucket" ("reset_at");
