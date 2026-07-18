"use client";

import { Button, buttonVariants } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { CheckIcon, LockIcon, SettingsIcon, UserPlusIcon } from "lucide-react";
import { useState } from "react";
import { OneVidProfileAvatar } from "./onevid-profile-avatar";
import {
  type OneVidProfile,
  useOneVidProfiles,
} from "./onevid-profile-context";
import { OneVidProfileManager } from "./onevid-profile-manager";

export function OneVidProfileSwitcher() {
  const {
    profiles,
    activeProfile,
    activeProfileId,
    setActiveProfileId,
    verifyProfilePin,
  } = useOneVidProfiles();
  const [managerOpen, setManagerOpen] = useState(false);

  // Locked profile pending PIN verification before becoming active.
  const [pendingProfile, setPendingProfile] = useState<OneVidProfile | null>(
    null
  );
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const [verifying, setVerifying] = useState(false);

  function selectProfile(p: OneVidProfile) {
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
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Perfil"
          className={cn(
            buttonVariants({ variant: "outline", size: "icon" }),
            "overflow-hidden p-0"
          )}
          data-dpad-focusable
        >
          {activeProfile ? (
            <OneVidProfileAvatar
              avatar={activeProfile.avatar}
              className="size-full rounded-md text-xs"
              name={activeProfile.name}
            />
          ) : (
            <UserPlusIcon className="size-4" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <div className="px-2 py-1.5 text-muted-foreground text-xs">
            Perfiles
          </div>
          {profiles.map((p) => (
            <DropdownMenuItem
              data-dpad-focusable
              key={p.id}
              onClick={() => selectProfile(p)}
            >
              <OneVidProfileAvatar
                avatar={p.avatar}
                className="size-6 text-[0.65rem]"
                name={p.name}
              />
              <span className="flex-1 truncate">{p.name}</span>
              {p.hasPin && (
                <LockIcon className="size-3 text-muted-foreground" />
              )}
              {p.id === activeProfileId && <CheckIcon className="size-3.5" />}
            </DropdownMenuItem>
          ))}
          {profiles.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem
            data-dpad-focusable
            onClick={() => setManagerOpen(true)}
          >
            <SettingsIcon className="size-3.5" />
            Administrar perfiles
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <OneVidProfileManager onOpenChange={setManagerOpen} open={managerOpen} />

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
    </>
  );
}
