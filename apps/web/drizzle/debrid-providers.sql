-- Proveedores debrid: Real-Debrid como alternativa a TorBox.
-- Todo son columnas opcionales: las cuentas existentes siguen usando TorBox
-- porque `debrid_provider` queda NULL y el código cae a la key que exista.

ALTER TABLE "one_vid"
  ADD COLUMN IF NOT EXISTS "real_debrid_api_key" text;

ALTER TABLE "one_vid"
  ADD COLUMN IF NOT EXISTS "debrid_provider" text;
