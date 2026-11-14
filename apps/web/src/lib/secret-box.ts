import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/**
 * Cifrado simetrico para secretos de terceros guardados en la base de datos
 * (las API keys de TorBox y Real-Debrid). AES-256-GCM con IV aleatorio y tag de
 * autenticacion; el formato es versionado para poder migrar.
 *
 * v2 (actual): clave derivada con HKDF-SHA256 de un secreto **dedicado**
 * (`ONEVID_SECRET_KEY`) y un `info` de proposito distinto al de sesion/firma.
 * Si no hay secreto dedicado, las escrituras fallan cerradas; no se reutiliza
 * `BETTER_AUTH_SECRET`.
 *
 * v1 (legado): SHA-256 del secreto de auth. Solo se usa para DESCIFRAR filas
 * antiguas; no se escriben valores nuevos con esta clave. Los valores en claro
 * anteriores a v1 se siguen leyendo y se cifran al volver a guardar.
 */
const PREFIX_V2 = "v2:";
const PREFIX_V1 = "v1:";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MIN_SECRET_LENGTH = 16;
const V2_INFO = "onevid:debrid-key:v2";

let cachedKeyV2: Buffer | null | undefined;
let cachedKeyV1: Buffer | null | undefined;

function dedicatedSecret(): string {
  const raw = process.env.ONEVID_SECRET_KEY ?? "";
  return raw.length >= MIN_SECRET_LENGTH ? raw : "";
}

function legacySecret(): string {
  const raw =
    process.env.ONEVID_SECRET_KEY ??
    process.env.BETTER_AUTH_SECRET ??
    process.env.AUTH_SECRET ??
    "";
  return raw.length >= MIN_SECRET_LENGTH ? raw : "";
}

function keyV2(): Buffer | null {
  if (cachedKeyV2 === undefined) {
    const raw = dedicatedSecret();
    cachedKeyV2 = raw
      ? Buffer.from(
          hkdfSync(
            "sha256",
            Buffer.from(raw, "utf8"),
            Buffer.alloc(0),
            Buffer.from(V2_INFO, "utf8"),
            32
          )
        )
      : null;
  }
  return cachedKeyV2;
}

function keyV1(): Buffer | null {
  if (cachedKeyV1 === undefined) {
    const raw = legacySecret();
    cachedKeyV1 = raw
      ? createHash("sha256").update(raw, "utf8").digest()
      : null;
  }
  return cachedKeyV1;
}

export function encryptionAvailable(): boolean {
  return keyV2() !== null;
}

/** Cifra con la clave v2. Falla cerrado si no hay secreto dedicado. */
export function encryptSecret(plaintext: string): string {
  const key = keyV2();
  if (!key) {
    throw new Error("ONEVID_SECRET_KEY no está configurado");
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${PREFIX_V2}${Buffer.concat([iv, tag, ciphertext]).toString("base64url")}`;
}

function decryptWith(
  stored: string,
  prefix: string,
  key: Buffer | null
): string | null {
  if (!key) return null;
  try {
    const raw = Buffer.from(stored.slice(prefix.length), "base64url");
    if (raw.byteLength <= IV_BYTES + TAG_BYTES) return null;

    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Descifra un secreto guardado. Acepta v2, v1 y valores legacy en claro.
 * Devuelve `null` si el valor esta corrupto o si falta la clave de esa version.
 */
export function decryptSecret(stored: string): string | null {
  if (stored.startsWith(PREFIX_V2)) {
    return decryptWith(stored, PREFIX_V2, keyV2());
  }
  if (stored.startsWith(PREFIX_V1)) {
    return decryptWith(stored, PREFIX_V1, keyV1());
  }
  return stored;
}

/** Lee la key de TorBox de una fila, descifrandola si hace falta. */
export function readTorboxKey(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const value = decryptSecret(stored);
  return value && value.trim() ? value.trim() : null;
}

/** Lee la key de Real-Debrid de una fila, descifrandola si hace falta. */
export function readRealDebridKey(
  stored: string | null | undefined
): string | null {
  if (!stored) return null;
  const value = decryptSecret(stored);
  return value && value.trim() ? value.trim() : null;
}
