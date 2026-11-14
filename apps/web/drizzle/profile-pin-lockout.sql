-- PIN lockout persistente por perfil.
-- Sin esto, el PIN de 4 dígitos se puede adivinar en paralelo entre isolates.

ALTER TABLE "onevid_profile"
  ADD COLUMN IF NOT EXISTS "pin_failed_attempts" integer DEFAULT 0 NOT NULL;

ALTER TABLE "onevid_profile"
  ADD COLUMN IF NOT EXISTS "pin_locked_until" timestamp with time zone;
