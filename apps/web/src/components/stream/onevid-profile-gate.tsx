"use client";

import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { LockIcon, PencilIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MysticEye } from "@/components/mystic-eye";
import { OneVidProfileAvatar } from "./onevid-profile-avatar";
import {
  type OneVidProfile,
  useOneVidProfiles,
} from "./onevid-profile-context";

/**
 * Full-screen "¿Quién está viendo?" gate, rendered by OneVidProfileProvider
 * in place of its children whenever the active profile is locked and hasn't
 * been PIN-verified in this browser session yet. Mirrors mobile's
 * /profiles → PinPrompt cold-start flow, including its "Administrar
 * perfiles" toggle: in edit mode, tapping a profile sends you to the real
 * profile management page (/home/account?view=profiles) to configure it,
 * instead of selecting/unlocking it here.
 */
export function OneVidProfileGate() {
  const router = useRouter();
  const { profiles, setActiveProfileId, verifyProfilePin } =
    useOneVidProfiles();
  const [pendingProfile, setPendingProfile] = useState<OneVidProfile | null>(
    null
  );
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [editMode, setEditMode] = useState(false);

  function selectProfile(p: OneVidProfile) {
    if (editMode) {
      router.push(`/home/account?view=profiles&manage=${p.id}`);
      return;
    }
    if (p.hasPin) {
      setPendingProfile(p);
      setPinInput("");
      setPinError(false);
      return;
    }
    setActiveProfileId(p.id);
  }

  async function confirmPin() {
    if (!pendingProfile) {
      return;
    }
    setVerifying(true);
    const ok = await verifyProfilePin(pendingProfile.id, pinInput);
    setVerifying(false);
    if (ok) {
      setActiveProfileId(pendingProfile.id);
      setPendingProfile(null);
      setPinInput("");
    } else {
      setPinError(true);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-10 bg-background px-6">
      <div className="flex flex-col items-center gap-4">
        <MysticEye className="aspect-[3/2] w-52" label="Mirando" />
        <h1 className="font-semibold text-2xl">¿Quién está viendo?</h1>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-8">
        {profiles.map((p) => (
          <button
            className="flex flex-col items-center gap-2"
            data-dpad-focusable
            key={p.id}
            onClick={() => selectProfile(p)}
            type="button"
          >
            <span className="relative inline-flex">
              <OneVidProfileAvatar
                avatar={p.avatar}
                className={`size-24 text-lg ${editMode ? "opacity-60" : ""}`}
                name={p.name}
              />
              {editMode && (
                <span className="-translate-x-1/2 -translate-y-1/2 absolute inset-0 top-1/2 left-1/2 flex size-7 items-center justify-center rounded-full bg-black/60">
                  <PencilIcon className="size-3.5 text-white" />
                </span>
              )}
            </span>
            <span className="flex items-center gap-1 text-sm">
              {p.name}
              {p.hasPin && !editMode && (
                <LockIcon className="size-3 text-muted-foreground" />
              )}
            </span>
          </button>
        ))}
      </div>

      <button
        className="text-muted-foreground text-sm hover:text-foreground"
        data-dpad-focusable
        onClick={() => setEditMode((v) => !v)}
        type="button"
      >
        {editMode ? "Listo" : "Administrar perfiles"}
      </button>

      <Dialog
        onOpenChange={(o) => {
          if (!o) {
            setPendingProfile(null);
            setPinInput("");
            setPinError(false);
          }
        }}
        open={pendingProfile !== null}
      >
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Perfil bloqueado</DialogTitle>
            <DialogDescription>
              Introduce el PIN de "{pendingProfile?.name}" para continuar.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoComplete="off"
            autoFocus
            className="text-center tracking-[0.5em]"
            inputMode="numeric"
            maxLength={4}
            onChange={(e) => {
              setPinInput(e.target.value);
              setPinError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                confirmPin();
              }
            }}
            placeholder="••••"
            type="password"
            value={pinInput}
          />
          {pinError && (
            <p className="text-destructive text-xs">PIN incorrecto</p>
          )}
          <DialogFooter>
            <Button
              className="btn-primary"
              disabled={verifying || pinInput.length !== 4}
              onClick={confirmPin}
            >
              Entrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
