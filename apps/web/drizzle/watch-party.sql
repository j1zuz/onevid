-- Watch party: salas privadas de co-visualización.
-- El estado de reproducción se guarda para que un invitado que entra tarde
-- sepa dónde está el host; el video en sí nunca pasa por Postgres.

CREATE TABLE IF NOT EXISTS "watch_room" (
  "id" text PRIMARY KEY NOT NULL,
  "host_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "content_type" text NOT NULL,
  "content_id" text NOT NULL,
  "raw_id" text NOT NULL,
  "is_addon" boolean DEFAULT false NOT NULL,
  "season" integer DEFAULT 0 NOT NULL,
  "episode" integer DEFAULT 0 NOT NULL,
  "title" text NOT NULL,
  "poster" text,
  "background" text,
  "status" text DEFAULT 'open' NOT NULL,
  "max_participants" integer DEFAULT 5 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "watch_room_host"
  ON "watch_room" ("host_user_id");
CREATE INDEX IF NOT EXISTS "watch_room_status"
  ON "watch_room" ("status", "created_at");

CREATE TABLE IF NOT EXISTS "watch_room_member" (
  "id" text PRIMARY KEY NOT NULL,
  "room_id" text NOT NULL REFERENCES "watch_room"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "image" text,
  "role" text DEFAULT 'guest' NOT NULL,
  "joined_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "watch_room_member_unique"
  ON "watch_room_member" ("room_id", "user_id");
CREATE INDEX IF NOT EXISTS "watch_room_member_room"
  ON "watch_room_member" ("room_id", "joined_at");

CREATE TABLE IF NOT EXISTS "watch_room_state" (
  "room_id" text PRIMARY KEY NOT NULL REFERENCES "watch_room"("id") ON DELETE CASCADE,
  "position_sec" integer DEFAULT 0 NOT NULL,
  "is_playing" boolean DEFAULT false NOT NULL,
  "rate" real DEFAULT 1 NOT NULL,
  "updated_by" text,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
