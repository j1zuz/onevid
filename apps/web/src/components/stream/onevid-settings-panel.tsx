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
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  GaugeIcon,
  GlobeIcon,
  LockIcon,
  SettingsIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import {
  type OneVidAddonSummary,
  SetupStepper,
} from "@/components/stepper-onevid";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/languages";
import type { OneVidFeedRow } from "@/lib/onevid-feed";
import { useTranslation } from "@/lib/onevid-i18n-context";
import { OneVidProfileAvatar } from "./onevid-profile-avatar";
import { OneVidQualityOrder } from "./onevid-quality-order";
import {
  type OneVidProfile,
  useOneVidProfiles,
} from "./onevid-profile-context";
import { OneVidProfileManager } from "./onevid-profile-manager";

const NEXT_LOCALE_COOKIE = "NEXT_LOCALE";

function persistLocaleCookie(locale: SupportedLanguage) {
  const maxAge = 60 * 60 * 24 * 365;
  // biome-ignore lint/suspicious/noDocumentCookie: setting the locale cookie is intentional
  document.cookie = `${NEXT_LOCALE_COOKIE}=${locale}; path=/; max-age=${maxAge}; samesite=lax`;
}

export type SettingsView =
  | "account"
  | "catalog"
  | "home"
  | "language"
  | "profiles"
  | "quality";

interface OneVidSettingsPanelProps {
  discoverRows: OneVidFeedRow[];
  feedConfigured: boolean;
  feedRows: OneVidFeedRow[];
  hasTorboxKey: boolean;
  initialAddons: OneVidAddonSummary[];
  /** Abre directo en una sub-vista (ej. el link "Administrar perfiles" del
   * dropdown del avatar entra derecho a "profiles" en vez de la lista). */
  initialView?: SettingsView;
  linked: boolean;
  setupCompleted: boolean;
  userEmail: string;
  userName: string;
}

function SettingsRow({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-left transition-colors hover:bg-muted"
      data-dpad-focusable
      onClick={onClick}
      type="button"
    >
      {icon}
      <span className="flex-1 text-sm">{label}</span>
      <ChevronRightIcon className="size-4 text-muted-foreground" />
    </button>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function StatusBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-primary text-xs">
      <CircleCheckIcon className="size-3.5" />
      Conectado
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
      <CircleXIcon className="size-3.5" />
      Sin conectar
    </span>
  );
}

/**
 * Vista "Cuenta": solo muestra información (nombre, email, estado de TMDB /
 * TorBox / complementos). Para CONFIGURAR esas mismas cosas está la vista
 * "Catálogo" (el stepper) — separadas porque una es de lectura y la otra de
 * acción.
 */
function AccountInfoView({
  addonsCount,
  hasTorboxKey,
  linked,
  userEmail,
  userName,
}: {
  addonsCount: number;
  hasTorboxKey: boolean;
  linked: boolean;
  userEmail: string;
  userName: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <InfoRow label="Nombre" value={userName} />
      <InfoRow label="Correo" value={userEmail} />
      <InfoRow label="TMDB" value={<StatusBadge ok={linked} />} />
      <InfoRow label="TorBox" value={<StatusBadge ok={hasTorboxKey} />} />
      <InfoRow label="Complementos" value={addonsCount} />
    </div>
  );
}

/**
 * Vista "Perfiles": la lista de cambio rápido (con flujo de PIN) que antes
 * vivía en el dropdown del avatar, más el acceso a administrar perfiles.
 */
function ProfilesView() {
  const {
    profiles,
    activeProfileId,
    setActiveProfileId,
    verifyProfilePin,
  } = useOneVidProfiles();
  const [managerOpen, setManagerOpen] = useState(false);
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
      <div className="flex flex-col gap-1">
        {profiles.map((p) => (
          <button
            className="flex w-full items-center gap-3 rounded-md border border-transparent px-3 py-2 text-left transition-colors hover:bg-muted"
            data-dpad-focusable
            key={p.id}
            onClick={() => selectProfile(p)}
            type="button"
          >
            <OneVidProfileAvatar
              avatar={p.avatar}
              className="size-8 text-xs"
              name={p.name}
            />
            <span className="flex-1 truncate text-sm">{p.name}</span>
            {p.hasPin && <LockIcon className="size-3.5 text-muted-foreground" />}
            {p.id === activeProfileId && <CheckIcon className="size-4" />}
          </button>
        ))}
      </div>

      <SettingsRow
        icon={<SettingsIcon className="size-4" />}
        label="Administrar perfiles"
        onClick={() => setManagerOpen(true)}
      />

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

/**
 * Panel de "Configuración": vive en la página /home/account (no en un Drawer
 * del header). "Account"/"Modo local"/"Cerrar sesión" siguen en el dropdown
 * del avatar; acá van perfiles, idioma y cuenta/catálogo — las demás
 * configuraciones que no caben en ese dropdown.
 */
export function OneVidSettingsPanel({
  discoverRows,
  feedConfigured,
  feedRows,
  hasTorboxKey,
  initialAddons,
  initialView = "home",
  linked,
  setupCompleted,
  userEmail,
  userName,
}: OneVidSettingsPanelProps) {
  const router = useRouter();
  const { language, setLanguage, t: rawT } = useTranslation();
  const t = (key: string) => rawT(key as never);
  const [view, setView] = useState<SettingsView>(initialView);

  if (view === "home") {
    return (
      <div className="flex flex-col gap-1">
        <SettingsRow
          icon={<UserIcon className="size-4" />}
          label="Cuenta"
          onClick={() => setView("account")}
        />
        <SettingsRow
          icon={<SettingsIcon className="size-4" />}
          label="Catálogo"
          onClick={() => setView("catalog")}
        />
        <SettingsRow
          icon={<UsersIcon className="size-4" />}
          label={t("Perfiles")}
          onClick={() => setView("profiles")}
        />
        <SettingsRow
          icon={<GaugeIcon className="size-4" />}
          label="Calidad de video"
          onClick={() => setView("quality")}
        />
        <SettingsRow
          icon={<GlobeIcon className="size-4" />}
          label={t("Idioma")}
          onClick={() => setView("language")}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        className="flex items-center gap-1.5 self-start text-muted-foreground text-xs hover:text-foreground"
        data-dpad-focusable
        onClick={() => setView("home")}
        type="button"
      >
        <ArrowLeftIcon className="size-3.5" />
        {t("Volver")}
      </button>

      {view === "account" && (
        <AccountInfoView
          addonsCount={initialAddons.length}
          hasTorboxKey={hasTorboxKey}
          linked={linked}
          userEmail={userEmail}
          userName={userName}
        />
      )}

      {view === "catalog" && (
        <SetupStepper
          discoverRows={discoverRows}
          feedConfigured={feedConfigured}
          feedRows={feedRows}
          hasTorboxKey={hasTorboxKey}
          initialAddons={initialAddons}
          linked={linked}
          setupCompleted={setupCompleted}
        />
      )}

      {view === "profiles" && <ProfilesView />}

      {view === "quality" && <OneVidQualityOrder />}

      {view === "language" && (
        <div className="flex flex-col gap-1">
          {SUPPORTED_LANGUAGES.map((lang) => (
            <button
              className="flex w-full items-center gap-3 rounded-md border border-transparent px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              data-dpad-focusable
              key={lang.code}
              onClick={() => {
                setLanguage(lang.code);
                persistLocaleCookie(lang.code);
                // El catálogo de TMDB se resuelve en Server Components leyendo
                // la cookie NEXT_LOCALE una sola vez por navegación; sin
                // refresh() el texto de la UI cambia pero los posters siguen
                // en el idioma viejo.
                router.refresh();
              }}
              type="button"
            >
              <span className="flex-1">{lang.label}</span>
              {language === lang.code && (
                <CheckIcon className="size-4 text-primary" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
