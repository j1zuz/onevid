"use client";

import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Switch } from "@workspace/ui/components/switch";
import { cn } from "@workspace/ui/lib/utils";
import { LockIcon, PencilIcon, PlusIcon, TrashIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "@/lib/onevid-i18n-context";
import { avatarImageSrc, OneVidProfileAvatar } from "./onevid-profile-avatar";
import {
  type MutationResult,
  type OneVidProfile,
  useOneVidProfiles,
} from "./onevid-profile-context";

const AVATARS = ["black", "blue", "green", "orange", "purple", "red"];

function errorMessage(
  error: string | undefined,
  t: (key: string) => string
): string {
  switch (error) {
    case "pin_required":
    case "pin_invalid":
      return t("PIN incorrecto");
    case "max_profiles":
      return t("Máximo 5 perfiles");
    case "code_invalid":
      return t("Código incorrecto o expirado");
    case "no_email":
      return t("Tu cuenta no tiene correo");
    case "email_failed":
      return t("No se pudo enviar el correo");
    default:
      return t("Ocurrió un error");
  }
}

function AvatarPicker({
  value,
  onChange,
}: {
  onChange: (a: string) => void;
  value: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {AVATARS.map((a) => (
        <button
          aria-label={a}
          className={cn(
            "size-10 overflow-hidden rounded-full ring-offset-background transition",
            value === a
              ? "ring-2 ring-primary ring-offset-2"
              : "opacity-70 hover:opacity-100"
          )}
          key={a}
          onClick={() => onChange(a)}
          type="button"
        >
          {/* biome-ignore lint/performance/noImgElement: small local static asset */}
          <img
            alt={a}
            className="size-full object-cover"
            src={avatarImageSrc(a)}
          />
        </button>
      ))}
    </div>
  );
}

// Campo del PIN del perfil principal: se muestra dentro de cada acción (crear,
// editar o eliminar) sólo cuando el perfil principal está bloqueado. Incluye el
// flujo "¿Olvidaste tu PIN?" para restablecerlo por correo.
function AuthPinField({
  value,
  onChange,
  disabled,
  label,
}: {
  disabled?: boolean;
  label: string;
  onChange: (v: string) => void;
  value: string;
}) {
  const { requestPinReset, confirmPinReset } = useOneVidProfiles();
  const { t: rawT } = useTranslation();
  const t = (key: string) => rawT(key as never);
  const pinId = useId();
  const codeId = useId();
  const [resetSent, setResetSent] = useState(false);
  const [resetCode, setResetCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleRequestReset() {
    setBusy(true);
    const result = await requestPinReset();
    setBusy(false);
    if (result.ok) {
      setResetSent(true);
      toast.success(t("Te enviamos un código a tu correo"));
    } else {
      toast.error(errorMessage(result.error, t));
    }
  }

  async function handleConfirmReset() {
    setBusy(true);
    const result = await confirmPinReset(resetCode);
    setBusy(false);
    if (result.ok) {
      toast.success(t("PIN restablecido"));
      setResetSent(false);
      setResetCode("");
      onChange("");
    } else {
      toast.error(errorMessage(result.error, t));
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <Label className="text-xs" htmlFor={pinId}>
        {label}
      </Label>
      <Input
        autoComplete="off"
        className="h-8 w-32 text-xs"
        disabled={disabled}
        id={pinId}
        inputMode="numeric"
        maxLength={4}
        onChange={(e) => onChange(e.target.value)}
        placeholder="••••"
        type="password"
        value={value}
      />
      {resetSent ? (
        <div className="mt-1 flex flex-col gap-2">
          <Label className="text-xs" htmlFor={codeId}>
            {t("Código enviado a tu correo (caduca en 10 min)")}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              autoComplete="off"
              className="h-8 w-28 text-xs tracking-[0.3em]"
              id={codeId}
              inputMode="numeric"
              maxLength={6}
              onChange={(e) => setResetCode(e.target.value)}
              placeholder="••••••"
              value={resetCode}
            />
            <Button
              className="btn-primary"
              disabled={busy || resetCode.length !== 6}
              onClick={handleConfirmReset}
              size="sm"
            >
              {t("Restablecer")}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setResetSent(false);
                setResetCode("");
              }}
              size="sm"
              variant="ghost"
            >
              {t("Cancelar")}
            </Button>
          </div>
        </div>
      ) : (
        <button
          className="self-start text-muted-foreground text-xs underline-offset-2 hover:underline"
          disabled={busy}
          onClick={handleRequestReset}
          type="button"
        >
          {t("¿Olvidaste tu PIN?")}
        </button>
      )}
    </div>
  );
}

interface OneVidProfileManagerProps {
  initialEditId?: string | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function OneVidProfileManager({
  open,
  onOpenChange,
  // Opens straight into editing this profile (e.g. tapped from the "¿Quién
  // está viendo?" gate in edit mode) instead of the plain list view.
  initialEditId,
}: OneVidProfileManagerProps) {
  const { t: rawT } = useTranslation();
  const t = (key: string, options?: Record<string, unknown>) =>
    rawT(key as never, options as never) as unknown as string;
  const {
    profiles,
    max,
    managePinRequired,
    createProfile,
    updateProfile,
    deleteProfile,
  } = useOneVidProfiles();

  // PIN del perfil principal, compartido entre crear/editar/eliminar mientras el
  // modal está abierto (sólo se pide cuando managePinRequired).
  const [authPin, setAuthPin] = useState("");

  // Create form (oculto hasta pulsar "Crear perfil")
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAvatar, setNewAvatar] = useState("blue");
  const [newKids, setNewKids] = useState(false);
  const [newLockPin, setNewLockPin] = useState("");
  const [busy, setBusy] = useState(false);

  // Edit form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editAvatar, setEditAvatar] = useState("blue");
  const [editKids, setEditKids] = useState(false);
  // Lock PIN editor: "" = leave unchanged, a 4-digit value = set/change.
  const [editLockPin, setEditLockPin] = useState("");
  const [editHadPin, setEditHadPin] = useState(false);

  // Confirmación de eliminación inline
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const authArg = () => (managePinRequired ? authPin : undefined);
  // Cuando el principal está bloqueado, exigimos un PIN de 4 dígitos.
  const authMissing = managePinRequired && authPin.length !== 4;

  // El PIN que autoriza es siempre el del perfil principal (el primero). Si la
  // acción es sobre ese mismo perfil, decimos "tu PIN"; si es sobre otro,
  // aclaramos que es el del perfil principal para no confundir al usuario.
  const primaryId = profiles[0]?.id;
  const authPinLabel = (targetId?: string) =>
    targetId && targetId === primaryId
      ? t("Ingresa tu PIN para confirmar")
      : t("PIN del perfil principal (requerido)");

  function handleResult(result: MutationResult, success: string): boolean {
    if (result.ok) {
      toast.success(success);
      return true;
    }
    toast.error(errorMessage(result.error, t));
    return false;
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      // Limpia el estado transitorio al cerrar el modal.
      setAuthPin("");
      setCreating(false);
      setEditingId(null);
      setDeletingId(null);
      setNewName("");
      setNewAvatar("blue");
      setNewKids(false);
      setNewLockPin("");
    }
    onOpenChange(next);
  }

  function openCreate() {
    setCreating(true);
    setEditingId(null);
    setDeletingId(null);
  }

  function cancelCreate() {
    setCreating(false);
    setNewName("");
    setNewAvatar("blue");
    setNewKids(false);
    setNewLockPin("");
  }

  async function handleCreate() {
    if (!newName.trim()) {
      return;
    }
    setBusy(true);
    const result = await createProfile(
      {
        name: newName.trim(),
        avatar: newAvatar,
        isKids: newKids,
        lockPin: newLockPin ? newLockPin : null,
      },
      authArg()
    );
    setBusy(false);
    if (handleResult(result, t("Perfil creado"))) {
      cancelCreate();
    }
  }

  function startEdit(p: OneVidProfile) {
    setEditingId(p.id);
    setEditName(p.name);
    setEditAvatar(p.avatar);
    setEditKids(p.isKids);
    setEditLockPin("");
    setEditHadPin(p.hasPin);
    setCreating(false);
    setDeletingId(null);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: only react when the dialog opens with a target id; profile refreshes must not reset the form.
  useEffect(() => {
    if (!(open && initialEditId)) {
      return;
    }
    const target = profiles.find((p) => p.id === initialEditId);
    if (target) {
      startEdit(target);
    }
  }, [open, initialEditId]);

  async function handleSaveEdit(id: string) {
    setBusy(true);
    const result = await updateProfile(
      id,
      {
        name: editName.trim(),
        avatar: editAvatar,
        isKids: editKids,
        // Only send lockPin when the user typed a new one.
        ...(editLockPin ? { lockPin: editLockPin } : {}),
      },
      authArg()
    );
    setBusy(false);
    if (handleResult(result, t("Perfil actualizado"))) {
      setEditingId(null);
      setEditLockPin("");
    }
  }

  async function handleRemoveLock(id: string) {
    setBusy(true);
    const result = await updateProfile(id, { lockPin: null }, authArg());
    setBusy(false);
    if (handleResult(result, t("Bloqueo eliminado"))) {
      setEditHadPin(false);
    }
  }

  function startDelete(p: OneVidProfile) {
    setDeletingId(p.id);
    setEditingId(null);
    setCreating(false);
  }

  async function handleDelete(id: string) {
    setBusy(true);
    const result = await deleteProfile(id, authArg());
    setBusy(false);
    if (handleResult(result, t("Perfil eliminado"))) {
      setDeletingId(null);
    }
  }

  // Opened to edit one specific profile (e.g. from the gate's "Administrar
  // perfiles" mode): show only that profile, not the whole account's list.
  const focused = Boolean(initialEditId);
  // Also narrow the list while editing any profile inline (pencil icon from
  // the full list): seeing the other rows while filling out this one's form
  // adds nothing and just pushes the save/cancel buttons further down.
  const singleId = initialEditId ?? editingId;
  const visibleProfiles = singleId
    ? profiles.filter((p) => p.id === singleId)
    : profiles;

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {focused ? t("Editar perfil") : t("Administrar perfiles")}
          </DialogTitle>
          {!focused && (
            <DialogDescription>
              {t("Configura hasta {{n}} perfiles.", { n: max })}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Profile list */}
        <ul className="flex flex-col gap-2">
          {visibleProfiles.map((p) => {
            if (editingId === p.id) {
              return (
                <li className="rounded-md border bg-muted/30 p-4" key={p.id}>
                  <div className="flex flex-col gap-4">
                    <Input
                      className="h-8 text-xs"
                      onChange={(e) => setEditName(e.target.value)}
                      value={editName}
                    />
                    <AvatarPicker onChange={setEditAvatar} value={editAvatar} />
                    <label
                      className="flex items-center gap-2 text-xs"
                      htmlFor="edit-kids"
                    >
                      <Switch
                        checked={editKids}
                        id="edit-kids"
                        onCheckedChange={setEditKids}
                      />
                      {t("Perfil infantil")}
                    </label>
                    <div className="flex flex-col gap-2">
                      <Label className="text-xs" htmlFor="edit-lock-pin">
                        {editHadPin
                          ? t("Cambiar PIN del perfil (4 dígitos)")
                          : t("PIN del perfil (4 dígitos, opcional)")}
                      </Label>
                      <div className="flex items-center gap-3">
                        <Input
                          autoComplete="off"
                          className="h-8 w-32 text-xs"
                          id="edit-lock-pin"
                          inputMode="numeric"
                          maxLength={4}
                          onChange={(e) => setEditLockPin(e.target.value)}
                          placeholder="••••"
                          type="password"
                          value={editLockPin}
                        />
                        {editHadPin && (
                          <Button
                            disabled={busy || authMissing}
                            onClick={() => handleRemoveLock(p.id)}
                            size="sm"
                            variant="ghost"
                          >
                            {t("Quitar bloqueo")}
                          </Button>
                        )}
                      </div>
                    </div>
                    {managePinRequired && (
                      <AuthPinField
                        disabled={busy}
                        label={authPinLabel(p.id)}
                        onChange={setAuthPin}
                        value={authPin}
                      />
                    )}
                    <div className="flex gap-3">
                      <Button
                        className="btn-primary"
                        disabled={busy || !editName.trim() || authMissing}
                        onClick={() => handleSaveEdit(p.id)}
                        size="sm"
                      >
                        {t("Guardar")}
                      </Button>
                      <Button
                        onClick={() =>
                          focused ? handleOpenChange(false) : setEditingId(null)
                        }
                        size="sm"
                        variant="ghost"
                      >
                        {t("Cancelar")}
                      </Button>
                    </div>
                  </div>
                </li>
              );
            }

            if (deletingId === p.id) {
              return (
                <li className="rounded-md border bg-muted/30 p-2.5" key={p.id}>
                  <div className="flex flex-col gap-2">
                    <p className="text-sm">
                      {t("¿Eliminar {{name}}? Esta acción no se puede deshacer.", {
                        name: p.name,
                      })}
                    </p>
                    {managePinRequired && (
                      <AuthPinField
                        disabled={busy}
                        label={authPinLabel(p.id)}
                        onChange={setAuthPin}
                        value={authPin}
                      />
                    )}
                    <div className="flex gap-2">
                      <Button
                        disabled={busy || authMissing}
                        onClick={() => handleDelete(p.id)}
                        size="sm"
                        variant="destructive"
                      >
                        {t("Eliminar")}
                      </Button>
                      <Button
                        onClick={() => setDeletingId(null)}
                        size="sm"
                        variant="ghost"
                      >
                        {t("Cancelar")}
                      </Button>
                    </div>
                  </div>
                </li>
              );
            }

            return (
              <li className="rounded-md border bg-muted/30 p-2.5" key={p.id}>
                <div className="flex items-center gap-3">
                  <OneVidProfileAvatar
                    avatar={p.avatar}
                    className="size-9 text-sm"
                    name={p.name}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate font-medium text-sm">
                      {p.name}
                      {p.hasPin && (
                        <LockIcon className="size-3 text-muted-foreground" />
                      )}
                    </p>
                    {p.isKids && (
                      <span className="text-[0.65rem] text-muted-foreground">
                        {t("Infantil")}
                      </span>
                    )}
                  </div>
                  <Button
                    onClick={() => startEdit(p)}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <PencilIcon className="size-3.5" />
                  </Button>
                  <Button
                    onClick={() => startDelete(p)}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <TrashIcon className="size-3.5 text-destructive" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Create: el formulario aparece sólo al pulsar "Crear perfil"; oculto
            en modo enfocado y mientras se edita un perfil (ver visibleProfiles
            arriba, mismo criterio). */}
        {!singleId &&
          profiles.length < max &&
          (creating ? (
            <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
              <Label className="text-xs">{t("Nuevo perfil")}</Label>
              <Input
                className="h-8 text-xs"
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("Nombre")}
                value={newName}
              />
              <AvatarPicker onChange={setNewAvatar} value={newAvatar} />
              <label
                className="flex items-center gap-2 text-xs"
                htmlFor="new-kids"
              >
                <Switch
                  checked={newKids}
                  id="new-kids"
                  onCheckedChange={setNewKids}
                />
                {t("Perfil infantil")}
              </label>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs" htmlFor="new-lock-pin">
                  {t("PIN del perfil (4 dígitos, opcional)")}
                </Label>
                <Input
                  autoComplete="off"
                  className="h-8 w-32 text-xs"
                  id="new-lock-pin"
                  inputMode="numeric"
                  maxLength={4}
                  onChange={(e) => setNewLockPin(e.target.value)}
                  placeholder="••••"
                  type="password"
                  value={newLockPin}
                />
              </div>
              {managePinRequired && (
                <AuthPinField
                  disabled={busy}
                  label={authPinLabel()}
                  onChange={setAuthPin}
                  value={authPin}
                />
              )}
              <div className="flex gap-2">
                <Button
                  className="btn-primary"
                  disabled={busy || !newName.trim() || authMissing}
                  onClick={handleCreate}
                  size="sm"
                >
                  <PlusIcon className="size-3.5" />
                  {t("Crear perfil")}
                </Button>
                <Button onClick={cancelCreate} size="sm" variant="ghost">
                  {t("Cancelar")}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              className="self-start border-dashed"
              onClick={openCreate}
              size="sm"
              variant="outline"
            >
              <PlusIcon className="size-3.5" />
              {t("Crear perfil")}
            </Button>
          ))}
      </DialogContent>
    </Dialog>
  );
}
