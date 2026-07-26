-- Adds the configurable home feed column that commit 58b5233e introduced in the
-- Drizzle schema (`one_vid.feed_rows`, jsonb) without a matching migration.
-- Selecting it before it existed crashed the /home catalog page with
-- `column "feed_rows" does not exist`. Idempotent so it is safe on databases
-- where the column was already added by hand (via the old one-off script).
ALTER TABLE "one_vid" ADD COLUMN IF NOT EXISTS "feed_rows" jsonb;
