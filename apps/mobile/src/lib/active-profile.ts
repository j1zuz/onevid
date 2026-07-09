// Tiny in-memory holder for the active profile id, read synchronously by
// apiFetch to inject the `X-Profile-Id` header. Kept separate from profiles.ts
// to avoid a circular import with api.ts.
let activeProfileId: string | null = null;

export function getActiveProfileId(): string | null {
  return activeProfileId;
}

export function setActiveProfileId(id: string | null): void {
  activeProfileId = id;
}
