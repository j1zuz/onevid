-- Actividad diaria por perfil: cuántos segundos se vieron cada día.
--
-- `onevid_profile_progress` guarda SOLO la última posición de cada título (una
-- fila por película/episodio), así que no permite dibujar un calendario de
-- "qué días vi algo". Esta tabla acumula el tiempo real visto por día y es la
-- fuente del heatmap de estadísticas (día/mes).
--
-- La escribe `POST /api/onevid-progress` (cada guardado de progreso, ~60 s):
-- suma el tiempo transcurrido desde `last_seen_at` con un tope de 2 min, para
-- no contar pausas largas ni pestañas dormidas. En la primera escritura del día
-- el incremento es 0 (no hay `last_seen_at` previo), así que ese día empieza a
-- contar desde el segundo guardado.
--
-- No hay histórico hacia atrás: los datos empiezan a llenarse desde el deploy.

CREATE TABLE IF NOT EXISTS "onevid_profile_activity" (
  "profile_id" text NOT NULL REFERENCES "onevid_profile"("id") ON DELETE CASCADE,
  "day" date NOT NULL,
  "seconds" integer DEFAULT 0 NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("profile_id", "day")
);

-- Consultas del heatmap: últimos N días de un perfil, ordenados por fecha.
CREATE INDEX IF NOT EXISTS "onevid_profile_activity_profile_day"
  ON "onevid_profile_activity" ("profile_id", "day");
