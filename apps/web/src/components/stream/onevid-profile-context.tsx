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

const STORAGE_KEY = "onevid-active-profile";
const MAX_PROFILES = 5;

async function readError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? "error";
}

export function OneVidProfileProvider({
  children,
  initialProfiles,
}: {
  children: ReactNode;
  initialProfiles: OneVidProfile[];
}) {
  const [profiles, setProfiles] = useState<OneVidProfile[]>(initialProfiles);
  const [activeProfileId, setActiveProfileIdState] = useState<string | null>(
    initialProfiles[0]?.id ?? null
  );

  // Restore the persisted active profile (if it still exists).
  useEffect(() => {
    const stored =
      typeof window === "undefined"
        ? null
        : window.localStorage.getItem(STORAGE_KEY);
    if (stored && profiles.some((p) => p.id === stored)) {
      setActiveProfileIdState(stored);
    } else if (!profiles.some((p) => p.id === activeProfileId)) {
      setActiveProfileIdState(profiles[0]?.id ?? null);
    }
  }, [profiles, activeProfileId]);

  const setActiveProfileId = useCallback((id: string) => {
    setActiveProfileIdState(id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, id);
    }
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
    setActiveProfileId,
    refresh,
    createProfile,
    updateProfile,
    deleteProfile,
    verifyProfilePin,
    requestPinReset,
    confirmPinReset,
  ]);

  return (
    <OneVidProfileContext.Provider value={value}>
      {children}
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
