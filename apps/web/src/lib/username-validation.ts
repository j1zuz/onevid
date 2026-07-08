export const MIN_USERNAME_LEN = 3;
export const MAX_USERNAME_LEN = 30;

// Política alineada con Better Auth por defecto: letras, números, "_" y ".".
export const USERNAME_PATTERN = /^[a-zA-Z0-9_.]+$/;

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function isUsernameAllowed(value: string) {
  return USERNAME_PATTERN.test(value.trim());
}

type TranslateFn = (key: string, opts?: Record<string, unknown>) => string;
const identity: TranslateFn = (key: string) => key;

export function validateUsernameValue(
  value: string,
  t: TranslateFn = identity
) {
  const v = value.trim();
  if (!v) {
    return t("Elige un nombre de usuario");
  }
  if (v.length < MIN_USERNAME_LEN) {
    return t("Mínimo {{n}} caracteres", { n: MIN_USERNAME_LEN });
  }
  if (v.length > MAX_USERNAME_LEN) {
    return t("Máximo {{n}} caracteres", { n: MAX_USERNAME_LEN });
  }
  if (!isUsernameAllowed(v)) {
    return t("Solo letras, números, guiones bajos y puntos");
  }
  return;
}
