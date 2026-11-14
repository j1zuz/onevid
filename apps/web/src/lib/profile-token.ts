import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Token firmado que prueba que un perfil con PIN fue verificado en esta
 * sesión. La cookie `onevid-verified-profile` que escribe el cliente es solo
 * estado de UI; el servidor no la usa para autorizar. Este token sí:
 *
 *   v1.<payload base64url>.<hmac base64url>
 *   payload = { u: userId, p: profileId, e: epoch ms }
 *
 * Es un bearer de perfil: si se filtra, permite actuar como ese perfil hasta
 * su expiración. Por eso se emite HttpOnly y dura lo mismo que la selección de
 * perfil (30 días), y solo se exige para perfiles con `pinHash`.
 */
const PREFIX = "v1";
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PROFILE_TOKEN_COOKIE = "onevid-profile-token";

function secret(): Buffer | null {
  const raw =
    process.env.ONEVID_SECRET_KEY ??
    process.env.BETTER_AUTH_SECRET ??
    process.env.AUTH_SECRET ??
    "";
  if (raw.length < 16) {
    return null;
  }
  // La clave de firma se deriva con un dominio propio para no reutilizar
  // directamente la clave de sesión ni la de cifrado.
  return createHmac("sha256", raw)
    .update("onevid:profile-token:v1")
    .digest();
}

function sign(payload: string): string | null {
  const key = secret();
  if (!key) {
    return null;
  }
  return createHmac("sha256", key).update(payload).digest("base64url");
}

interface TokenPayload {
  e: number;
  h: string;
  p: string;
  u: string;
}

function pinFingerprint(pinHash: string): string {
  return createHash("sha256").update(pinHash, "utf8").digest("base64url");
}

function encode(payload: TokenPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function mintProfileToken(
  userId: string,
  profileId: string,
  pinHash: string,
  ttlMs = DEFAULT_TTL_MS
): string | null {
  const payload = encode({
    e: Date.now() + ttlMs,
    h: pinFingerprint(pinHash),
    p: profileId,
    u: userId,
  });
  const signature = sign(payload);
  return signature ? `${PREFIX}.${payload}.${signature}` : null;
}

export function verifyProfileToken(
  token: string | null | undefined,
  userId: string,
  profileId: string,
  pinHash: string
): boolean {
  if (!token) {
    return false;
  }
  const [prefix, payload, signature] = token.split(".");
  if (prefix !== PREFIX || !payload || !signature) {
    return false;
  }
  const expected = sign(payload);
  if (!expected) {
    return false;
  }
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (
    actualBuf.byteLength !== expectedBuf.byteLength ||
    !timingSafeEqual(actualBuf, expectedBuf)
  ) {
    return false;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as Partial<TokenPayload>;
    return (
      parsed.u === userId &&
      parsed.p === profileId &&
      parsed.h === pinFingerprint(pinHash) &&
      typeof parsed.e === "number" &&
      parsed.e > Date.now()
    );
  } catch {
    return false;
  }
}

/** Lee el token del header (apps nativas) o de la cookie HttpOnly (web). */
export function readProfileToken(request: Request): string | null {
  const header = request.headers.get("x-profile-token")?.trim();
  if (header) {
    return header;
  }
  const cookie = request.headers.get("cookie");
  if (!cookie) {
    return null;
  }
  const match = cookie.match(
    new RegExp(`(?:^|;\\s*)${PROFILE_TOKEN_COOKIE}=([^;]+)`)
  );
  if (!match?.[1]) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/** Cookie de sesión para el navegador; HttpOnly, SameSite=Lax, 30 días. */
export function profileTokenCookie(token: string): string {
  const secure =
    process.env.NODE_ENV === "production" ||
    (process.env.BASE_URL ?? "").startsWith("https://")
      ? "; Secure"
      : "";
  return `${PROFILE_TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.floor(
    DEFAULT_TTL_MS / 1000
  )}; HttpOnly; SameSite=Lax${secure}`;
}
