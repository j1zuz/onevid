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
import {
  BoltIcon,
  LockIcon,
  LogOutIcon,
  SettingsIcon,
  UploadIcon,
  UserPlusIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useTranslation } from "@/lib/onevid-i18n-context";
import { OneVidProfileAvatar } from "./onevid-profile-avatar";
import {
  type OneVidProfile,
  useOneVidProfiles,
} from "./onevid-profile-context";

/**
 * Único dropdown del header: cambio rápido de perfil (con flujo de PIN) +
 * Configuración/Modo local/Cerrar sesión. Ya no hay un ícono de engranaje
 * aparte. "Administrar perfiles" vive en /home/account (vista "Perfiles"),
 * no acá.
 */
export function OneVidProfileSwitcher() {
  const router = useRouter();
  const { t: rawT } = useTranslation();
  const t = (key: string) => rawT(key as never);
  const {
    profiles,
    activeProfile,
    activeProfileId,
    setActiveProfileId,
    verifyProfilePin,
  } = useOneVidProfiles();
  const [signingOut, setSigningOut] = useState(false);

  // Locked profile pending PIN verification before becoming active.
  const [pendingProfile, setPendingProfile] = useState<OneVidProfile | null>(
    null
  );
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/");
          router.refresh();
        },
        onError: () => {
          setSigningOut(false);
        },
      },
    });
  }, [router]);

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
            Cambiar de perfil
          </div>
          {/* Solo los OTROS perfiles: el activo ya es el que se está usando,
              no hace falta listarlo (ni su checkmark) acá. */}
          {profiles
            .filter((p) => p.id !== activeProfileId)
            .map((p) => (
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
              </DropdownMenuItem>
            ))}

          <DropdownMenuItem
            data-dpad-focusable
            render={<Link href="/home/account?view=profiles" />}
          >
            <SettingsIcon className="size-3.5" />
            Administrar perfiles
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* Idioma/cuenta viven en su propia página, no en un Drawer
              anidado acá: /home/account (onevid-settings-panel.tsx). */}
          <DropdownMenuItem
            data-dpad-focusable
            render={<Link href="/home/account" />}
          >
            <BoltIcon className="size-3.5" />
            Cuenta
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Navega a /: la MISMA pantalla de modo local que ve alguien sin
              sesión (sin duplicar una versión propia acá). El proxy
              (src/proxy.ts) detecta que venimos de /home vía Referer y no
              redirige de vuelta. */}
          <DropdownMenuItem data-dpad-focusable render={<Link href="/" />}>
            <UploadIcon className="size-3.5" />
            {t("Modo local")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-dpad-focusable
            disabled={signingOut}
            onClick={handleSignOut}
            variant="destructive"
          >
            <LogOutIcon className="size-3.5" />
            {t("Cerrar sesión")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
