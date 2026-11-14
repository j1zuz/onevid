// Tiny in-memory holder for the active profile id, read synchronously by
// apiFetch to inject the `X-Profile-Id` header. Kept separate from profiles.ts
// to avoid a circular import with api.ts.
let activeProfileId: string | null = null;
// Signed proof that the active PIN-locked profile was verified in this
// install. Read synchronously by apiFetch; the server requires it for any
// profile with a PIN.
let activeProfileToken: string | null = null;

export function getActiveProfileId(): string | null {
  return activeProfileId;
}

export function setActiveProfileId(id: string | null): void {
  activeProfileId = id;
}

export function getActiveProfileToken(): string | null {
  return activeProfileToken;
}

export function setActiveProfileToken(token: string | null): void {
  activeProfileToken = token;
}
