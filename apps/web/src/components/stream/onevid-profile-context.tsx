"use client";

import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { OneVidProfileGate } from "./onevid-profile-gate";

export interface OneVidProfile {
  avatar: string;
  createdAt?: string;
  hasPin: boolean;
  id: string;
  isKids: boolean;
  name: string;
}

export interface ProfileInput {
  avatar: string;
  isKids: boolean;
  // string → set/change this profile's lock PIN; null → remove the lock;
  // undefined → leave the lock untouched.
  lockPin?: string | null;
  name: string;
}

export interface MutationResult {
  error?: string;
  ok: boolean;
}

interface OneVidProfileContextValue {
  activeProfile: OneVidProfile | null;
  activeProfileId: string | null;
  // Confirms the emailed OTP, clearing the primary profile's PIN on success.
  confirmPinReset: (code: string) => Promise<MutationResult>;
  createProfile: (
    input: ProfileInput,
    authPin?: string
  ) => Promise<MutationResult>;
  deleteProfile: (id: string, authPin?: string) => Promise<MutationResult>;
  // Forces the "¿Quién está viendo?" gate back open to pick a different
  // profile, regardless of whether the current one is locked. No-op (visibly)
  // on pages with `disableGate` — check `gateEnabled` before relying on it.
  exitProfile: () => void;
  // Whether this page's provider can ever show the gate (false on pages
  // mounted with `disableGate`, e.g. /home/account). Callers of `exitProfile`
  // that need the gate to actually appear should navigate to a gated page
  // (e.g. /home) when this is false.
  gateEnabled: boolean;
  // True when the active profile is locked and hasn't been verified in this
  // browser session yet — the provider renders the profile gate instead of
  // `children` while this is true.
  isGateOpen: boolean;
  // Whether managing profiles requires a PIN (i.e. the primary/first profile is
  // locked). The required PIN is that primary profile's PIN.
  managePinRequired: boolean;
  max: number;
  profiles: OneVidProfile[];
  refresh: () => Promise<void>;
  // Emails an OTP to the account owner to reset the primary profile's PIN.
  requestPinReset: () => Promise<MutationResult>;
  setActiveProfileId: (id: string) => void;
  updateProfile: (
    id: string,
    input: Partial<ProfileInput>,
    authPin?: string
  ) => Promise<MutationResult>;
  // Verifies a locked profile's PIN at selection time.
  verifyProfilePin: (id: string, pin: string) => Promise<boolean>;
}

const OneVidProfileContext = createContext<OneVidProfileContextValue | null>(
  null
);

// Persistent cookies (not localStorage/sessionStorage): they're read
// server-side (see the `cookies()` reads in home/page.tsx, the detail page,
// etc.) so the very first SSR render already knows the right active profile
// and whether its PIN was verified — otherwise the server would always
// default to the primary profile and flash the gate before an effect could
// read client-only storage and correct it after hydration.
//
// A `Max-Age` keeps the choice across a full browser close: session cookies got
// dropped on restart/tab-restore, so the detail page fell back to the primary
// (locked) profile and reopened the "¿Quién está viendo?" gate even though the
// user had already picked. 30 days mirrors how consumer streaming apps remember
// who's watching on a personal device.
export const ACTIVE_PROFILE_COOKIE = "onevid-active-profile";
export const VERIFIED_PROFILE_COOKIE = "onevid-verified-profile";
const PROFILE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 días, en segundos

function writeProfileCookie(name: string, id: string) {
  if (typeof document !== "undefined") {
    document.cookie = `${name}=${encodeURIComponent(id)}; path=/; max-age=${PROFILE_COOKIE_MAX_AGE}; samesite=lax`;
  }
}

function clearProfileCookie(name: string) {
  if (typeof document !== "undefined") {
    document.cookie = `${name}=; path=/; max-age=0`;
  }
}

/** Lee una cookie de perfil del navegador (cliente). `null` si no existe. */
function readProfileCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  if (!match) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]) || null;
  } catch {
    return match[1] || null;
  }
}

const MAX_PROFILES = 5;

async function readError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? "error";
}

export function OneVidProfileProvider({
  children,
  initialProfiles,
  // The "¿Quién está viendo?" gate protects content viewing (/home and the
  // detail page), not account management: /home/account must stay reachable
  // without it, both because managing/renaming a profile doesn't need to
  // know who's watching, and because resetting a forgotten PIN (via email
  // OTP, see requestPinReset) lives in there — gating it would lock users
  // out of their own recovery path.
  disableGate = false,
  // Both resolved server-side from the cookies above, so the very first
  // render (SSR, before any client JS runs) already knows the right active
  // profile and whether this session passed the gate — otherwise it would
  // always default to the primary profile and flash the gate before an
  // effect could read client-only storage and correct it after hydration.
  initialActiveProfileId = null,
  initialVerifiedProfileId = null,
}: {
  children: ReactNode;
  disableGate?: boolean;
  initialActiveProfileId?: string | null;
  initialProfiles: OneVidProfile[];
  initialVerifiedProfileId?: string | null;
}) {
  const [profiles, setProfiles] = useState<OneVidProfile[]>(initialProfiles);
  const [activeProfileId, setActiveProfileIdState] = useState<string | null>(
    initialActiveProfileId &&
      initialProfiles.some((p) => p.id === initialActiveProfileId)
      ? initialActiveProfileId
      : (initialProfiles[0]?.id ?? null)
  );
  // Which profile id was explicitly selected (and PIN-verified, if locked) in
  // this browser session.
  const [verifiedProfileId, setVerifiedProfileIdState] = useState<
    string | null
  >(initialVerifiedProfileId);
  // Set by `exitProfile()` to force the gate open even for an unlocked active
  // profile; cleared again the moment a profile is (re)selected.
  const [forcedOpen, setForcedOpen] = useState(false);
  // `false` hasta que el cliente leyó las cookies vivas. Mientras tanto NO se
  // pinta el gate (solo un fondo neutro): el render del servidor a veces no ve la
  // cookie recién escrita y, sin esta guarda, un perfil ya verificado veía el PIN
  // parpadear antes de que la reconciliación lo cerrara.
  const [reconciled, setReconciled] = useState(false);

  // Reconcilia con las cookies VIVAS del navegador al montar. El servidor pasa
  // las cookies que vio al renderizar; si una cookie recién escrita en el
  // cliente no alcanzó ese render (se escribió justo antes de navegar, o el
  // render vino de un prefetch/caché previo), el gate quedaría abierto aunque el
  // navegador ya tenga el perfil verificado correcto — y volvería a pedir el PIN
  // sin motivo. Leer `document.cookie` acá cierra esa brecha sin re-preguntar.
  // Solo adopta ids que existan entre los perfiles; nunca "verifica" de más (si
  // no hay cookie, no hace nada y el gate sigue, que es lo correcto).
  useEffect(() => {
    const cookieVerified = readProfileCookie(VERIFIED_PROFILE_COOKIE);
    if (
      cookieVerified &&
      cookieVerified !== verifiedProfileId &&
      profiles.some((p) => p.id === cookieVerified)
    ) {
      setVerifiedProfileIdState(cookieVerified);
    }
    const cookieActive = readProfileCookie(ACTIVE_PROFILE_COOKIE);
    if (
      cookieActive &&
      cookieActive !== activeProfileId &&
      profiles.some((p) => p.id === cookieActive)
    ) {
      setActiveProfileIdState(cookieActive);
    }
    setReconciled(true);
    // Solo al montar: cada página monta su propio provider, así que esto corre
    // en cada navegación entrante (home → detalle, player → detalle…).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the current active profile disappears (e.g. deleted by another tab's
  // `refresh()`), fall back to the primary one.
  useEffect(() => {
    if (!profiles.some((p) => p.id === activeProfileId)) {
      setActiveProfileIdState(profiles[0]?.id ?? null);
    }
  }, [profiles, activeProfileId]);

  // Only ever called after a profile is known-safe to activate (unlocked, or
  // its PIN was just verified by the gate/switcher) — so it also marks the
  // profile verified for the rest of this browser session.
  const setActiveProfileId = useCallback((id: string) => {
    setActiveProfileIdState(id);
    setVerifiedProfileIdState(id);
    setForcedOpen(false);
    writeProfileCookie(ACTIVE_PROFILE_COOKIE, id);
    writeProfileCookie(VERIFIED_PROFILE_COOKIE, id);
  }, []);

  // "Salir del perfil": clears this session's verification (and, for future
  // loads, the cookies) so the gate opens on the current profile too, not
  // just unverified locked ones.
  const exitProfile = useCallback(() => {
    setVerifiedProfileIdState(null);
    setForcedOpen(true);
    clearProfileCookie(ACTIVE_PROFILE_COOKIE);
    clearProfileCookie(VERIFIED_PROFILE_COOKIE);
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/onevid-profiles");
    if (!res.ok) {
      return;
    }
    const data = (await res.json()) as {
      profiles: OneVidProfile[];
    };
    setProfiles(data.profiles);
  }, []);

  const createProfile = useCallback(
    async (input: ProfileInput, authPin?: string): Promise<MutationResult> => {
      const res = await fetch("/api/onevid-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, authPin }),
      });
      if (!res.ok) {
        return { ok: false, error: await readError(res) };
      }
      const created = (await res.json()) as OneVidProfile;
      await refresh();
      setActiveProfileId(created.id);
      return { ok: true };
    },
    [refresh, setActiveProfileId]
  );

  const updateProfile = useCallback(
    async (
      id: string,
      input: Partial<ProfileInput>,
      authPin?: string
    ): Promise<MutationResult> => {
      const res = await fetch(`/api/onevid-profiles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, authPin }),
      });
      if (!res.ok) {
        return { ok: false, error: await readError(res) };
      }
      await refresh();
      return { ok: true };
    },
    [refresh]
  );

  const deleteProfile = useCallback(
    async (id: string, authPin?: string): Promise<MutationResult> => {
      const res = await fetch(`/api/onevid-profiles/${id}`, {
        method: "DELETE",
        headers: authPin ? { "X-Profile-Pin": authPin } : undefined,
      });
      if (!res.ok) {
        return { ok: false, error: await readError(res) };
      }
      await refresh();
      return { ok: true };
    },
    [refresh]
  );

  const verifyProfilePin = useCallback(
    async (id: string, pin: string): Promise<boolean> => {
      const res = await fetch(`/api/onevid-profiles/${id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) {
        return false;
      }
      const data = (await res.json()) as { ok?: boolean };
      return Boolean(data.ok);
    },
    []
  );

  const requestPinReset = useCallback(async (): Promise<MutationResult> => {
    const res = await fetch("/api/onevid-profiles/pin-reset/request", {
      method: "POST",
    });
    if (!res.ok) {
      return { ok: false, error: await readError(res) };
    }
    return { ok: true };
  }, []);

  const confirmPinReset = useCallback(
    async (code: string): Promise<MutationResult> => {
      const res = await fetch("/api/onevid-profiles/pin-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        return { ok: false, error: await readError(res) };
      }
      await refresh();
      return { ok: true };
    },
    [refresh]
  );

  const value = useMemo<OneVidProfileContextValue>(() => {
    const activeProfile =
      profiles.find((p) => p.id === activeProfileId) ?? null;
    return {
      profiles,
      activeProfile,
      activeProfileId: activeProfile?.id ?? null,
      isGateOpen: Boolean(
        !disableGate &&
          (forcedOpen ||
            (activeProfile?.hasPin && activeProfile.id !== verifiedProfileId))
      ),
      exitProfile,
      gateEnabled: !disableGate,
      // profiles arrive ordered by createdAt asc, so [0] is the primary profile.
      managePinRequired: Boolean(profiles[0]?.hasPin),
      max: MAX_PROFILES,
      setActiveProfileId,
      refresh,
      createProfile,
      updateProfile,
      deleteProfile,
      verifyProfilePin,
      requestPinReset,
      confirmPinReset,
    };
  }, [
    profiles,
    activeProfileId,
    verifiedProfileId,
    forcedOpen,
    disableGate,
    exitProfile,
    setActiveProfileId,
    refresh,
    createProfile,
    updateProfile,
    deleteProfile,
    verifyProfilePin,
    requestPinReset,
    confirmPinReset,
  ]);

  // Mientras no se reconcilió con la cookie viva, un gate "abierto" según el
  // servidor es dudoso (el server a veces no ve la cookie recién escrita): se
  // pinta un fondo neutro en vez del PIN, para que un perfil ya verificado no vea
  // el gate parpadear. Un gate "cerrado" sí se respeta de una (no filtra nada).
  let gateContent: ReactNode;
  if (value.isGateOpen) {
    gateContent = reconciled ? (
      <OneVidProfileGate />
    ) : (
      <div className="fixed inset-0 z-50 bg-background" />
    );
  } else {
    gateContent = children;
  }

  return (
    <OneVidProfileContext.Provider value={value}>
      {gateContent}
    </OneVidProfileContext.Provider>
  );
}

export function useOneVidProfiles(): OneVidProfileContextValue {
  const ctx = use(OneVidProfileContext);
  if (!ctx) {
    throw new Error(
      "useOneVidProfiles must be used within a OneVidProfileProvider"
    );
  }
  return ctx;
}

// Same read, but returns null instead of throwing when no provider is above the
// caller. Use this from components that can mount outside the provider (e.g. the
// player route, which renders the movie dialog with no OneVidProfileProvider)
// and can degrade gracefully without an active profile.
export function useOptionalOneVidProfiles(): OneVidProfileContextValue | null {
  return use(OneVidProfileContext);
}
