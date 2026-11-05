import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/**
 * Cifrado simetrico para secretos de terceros guardados en la base de datos
 * (por ahora la API key de TorBox). AES-256-GCM con IV aleatorio y tag de
 * autenticacion; el formato es versionado para poder migrar despues.
 *
 * La clave se deriva de un secreto de entorno. Los valores antiguos en claro
 * se siguen leyendo (no empiezan por `v1:`) y se re-cifran la proxima vez que
 * el usuario guarda su key.
 */

const PREFIX = "v1:";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MIN_SECRET_LENGTH = 16;

let cachedKey: Buffer | null | undefined;

function keysFromEnv(): Buffer | null {
  const raw =
    process.env.ONEVID_SECRET_KEY ??
    process.env.BETTER_AUTH_SECRET ??
    process.env.AUTH_SECRET ??
    "";
  if (raw.length < MIN_SECRET_LENGTH) return null;
  // El secreto de entorno ya es de alta entropia; SHA-256 da una clave de 32
  // bytes estable sin necesitar KDF con sal (no hay passwords humanos aqui).
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptionAvailable(): boolean {
  if (cachedKey === undefined) cachedKey = keysFromEnv();
  return cachedKey !== null;
}

function currentKey(): Buffer | null {
  if (cachedKey === undefined) cachedKey = keysFromEnv();
  return cachedKey;
}

/** Cifra un secreto. Si no hay clave configurada devuelve el valor tal cual. */
export function encryptSecret(plaintext: string): string {
  const key = currentKey();
  if (!key) return plaintext;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${Buffer.concat([iv, tag, ciphertext]).toString("base64url")}`;
}

/**
 * Descifra un secreto guardado. Acepta valores legacy en claro.
 * Devuelve `null` si el valor esta corrupto o si no hay clave para leerlo.
 */
export function decryptSecret(stored: string): string | null {
  if (!stored.startsWith(PREFIX)) return stored;

  const key = currentKey();
  if (!key) return null;

  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), "base64url");
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

/** Lee la key de TorBox de una fila, descifrandola si hace falta. */
export function readTorboxKey(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const value = decryptSecret(stored);
  return value && value.trim() ? value.trim() : null;
}
