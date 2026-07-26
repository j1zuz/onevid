# Database migrations

SQL migrations for the `one_vid` Postgres database, applied by
[`drizzle-orm`](https://orm.drizzle.team). They are run automatically on deploy
by `bun run db:migrate`, which is chained into `next start` (see
`package.json`). Drizzle records applied migrations in the
`__drizzle_migrations` table, so `db:migrate` is idempotent and safe to run on
every boot.

This history was adopted mid-project: `0000_add_feed_rows.sql` only adds the
column that had drifted ahead of the database (`one_vid.feed_rows`) rather than
recreating the whole schema, and uses `IF NOT EXISTS` so it is safe on
databases where the column was already added by hand.

## Adding a schema change

1. Edit `src/lib/auth-schema.ts`.
2. Add a new `NNNN_description.sql` file here with the DDL and register it in
   `meta/_journal.json` (next `idx`, matching `tag`). Prefer idempotent DDL
   (`IF NOT EXISTS`) so partial/hand-applied databases stay safe.
3. Commit it — it ships to the database on the next deploy.

For quick local iteration you can instead push the schema straight to your dev
database with `bun run db:push` (drizzle-kit diffs and applies directly; it does
**not** create migration files, so use it for dev only).
