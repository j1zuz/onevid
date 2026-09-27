"use client";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  Stepper,
  StepperContent,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperPanel,
  StepperSeparator,
  StepperTrigger,
} from "@workspace/ui/components/stepper";
import {
  CircleCheck,
  EllipsisVerticalIcon,
  LoaderIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SetupFeedStep } from "@/components/stepper-onevid-feed-step";
import type { AddonCatalogRef, OneVidFeedRow } from "@/lib/onevid-feed";

// El indicador numerado repite el mismo set de variantes en los 3 pasos.
const STEP_INDICATOR_CLASS =
  "size-5 rounded-full border-2 text-[0.6rem] data-[state=active]:border-primary data-[state=completed]:border-transparent data-[state=inactive]:border-muted data-[state=active]:bg-primary data-[state=completed]:bg-transparent data-[state=active]:text-primary-foreground data-[state=completed]:text-primary-foreground";

export interface OneVidAddonSummary {
  baseUrl: string;
  catalogs: AddonCatalogRef[];
  id: string;
  manifestId: string;
  manifestName: string;
  manifestVersion: string | null;
  supportsStreams: boolean;
}

interface SetupStepperProps {
  /** Filas de Descubrir, o su preset por defecto. */
  discoverRows: OneVidFeedRow[];
  /** True cuando el usuario ya guardó su feed alguna vez (columna no NULL). */
  feedConfigured: boolean;
  /** Filas guardadas, o el preset por defecto si aún no configuró nada. */
  feedRows: OneVidFeedRow[];
  hasTorboxKey: boolean;
  initialAddons: OneVidAddonSummary[];
  setupCompleted: boolean;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: stepper bundles feed + addons + torbox UI with multiple async flows
export function SetupStepper({
  discoverRows,
  feedConfigured,
  feedRows,
  hasTorboxKey,
  setupCompleted,
  initialAddons,
}: SetupStepperProps) {
  const router = useRouter();
  const [feedSaved, setFeedSaved] = useState(feedConfigured);
  const [feedSaving, setFeedSaving] = useState(false);
  const [addons, setAddons] = useState<OneVidAddonSummary[]>(initialAddons);
  const [addonUrl, setAddonUrl] = useState("");
  const [addingAddon, setAddingAddon] = useState(false);
  const [addonError, setAddonError] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [addonsEditMode, setAddonsEditMode] = useState(!setupCompleted);
  const [torboxKeyValue, setTorboxKeyValue] = useState("");
  const [torboxSaving, setTorboxSaving] = useState(false);
  const [torboxError, setTorboxError] = useState("");
  const [torboxSaved, setTorboxSaved] = useState(hasTorboxKey);
  const [removingTorbox, setRemovingTorbox] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState("");

  // Controlled active step so we can auto-advance when a step completes.
  const [activeStep, setActiveStep] = useState<number>(() => {
    if (!feedConfigured) {
      return 1;
    }
    if (initialAddons.length === 0) {
      return 2;
    }
    return 3;
  });

  // Auto-advance to the next step once the current one is completed, so the
  // user isn't left on a "configured" card. The card is still reachable by
  // clicking the step in the nav to go back.
  const prevFeedSaved = useRef(feedSaved);
  useEffect(() => {
    if (!prevFeedSaved.current && feedSaved && activeStep === 1) {
      setActiveStep(2);
    }
    prevFeedSaved.current = feedSaved;
  }, [feedSaved, activeStep]);

  const prevHasAddons = useRef(addons.length > 0);
  useEffect(() => {
    const hasAddons = addons.length > 0;
    if (!prevHasAddons.current && hasAddons && activeStep === 2) {
      setActiveStep(3);
    }
    prevHasAddons.current = hasAddons;
  }, [addons.length, activeStep]);

  async function handleSaveTorboxKey() {
    const trimmed = torboxKeyValue.trim();
    if (!trimmed) {
      return;
    }
    setTorboxSaving(true);
    setTorboxError("");
    try {
      const res = await fetch("/api/torbox-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setTorboxError(data.error || "Error al guardar la API key");
        return;
      }
      setTorboxSaved(true);
      setTorboxKeyValue("");
      router.refresh();
    } catch {
      setTorboxError("Error de conexión");
    } finally {
      setTorboxSaving(false);
    }
  }

  async function handleRemoveTorboxKey() {
    setRemovingTorbox(true);
    setTorboxError("");
    try {
      const res = await fetch("/api/torbox-key", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setTorboxError(data.error || "Error al eliminar la API key");
        return;
      }
      setTorboxSaved(false);
      setTorboxKeyValue("");
      router.refresh();
    } catch {
      setTorboxError("Error de conexión");
    } finally {
      setRemovingTorbox(false);
    }
  }

  async function handleAddAddon() {
    const trimmed = addonUrl.trim();
    if (!trimmed) {
      return;
    }
    setAddingAddon(true);
    setAddonError("");
    try {
      const res = await fetch("/api/onevid-addons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        item?: OneVidAddonSummary;
        error?: string;
      };
      if (!(res.ok && data.item)) {
        setAddonError(data.error || "Error al añadir el complemento");
        return;
      }
      setAddons((prev) => [data.item as OneVidAddonSummary, ...prev]);
      setAddonUrl("");
      router.refresh();
    } catch {
      setAddonError("Error de conexión");
    } finally {
      setAddingAddon(false);
    }
  }

  async function handleRemoveAddon(id: string) {
    setRemovingId(id);
    setAddonError("");
    try {
      const res = await fetch(`/api/onevid-addons/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAddonError(data.error || "Error al eliminar");
        return;
      }
      setAddons((prev) => prev.filter((a) => a.id !== id));
      router.refresh();
    } catch {
      setAddonError("Error de conexión");
    } finally {
      setRemovingId(null);
    }
  }

  async function handleRemoveAllAddons() {
    for (const addon of [...addons]) {
      await handleRemoveAddon(addon.id);
    }
  }

  async function handleFinish() {
    setFinishing(true);
    setFinishError("");
    try {
      const res = await fetch("/api/onevid-setup-complete", {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFinishError(data.error || "Error al finalizar la configuración");
        return;
      }
      router.refresh();
    } catch {
      setFinishError("Error de conexión");
    } finally {
      setFinishing(false);
    }
  }

  return (
    <Stepper
      className="mx-auto w-full max-w-md"
      indicators={{
        completed: (
          <CircleCheck className="size-5 fill-primary text-primary-foreground" />
        ),
        loading: <LoaderIcon className="size-3 animate-spin" />,
      }}
      onValueChange={setActiveStep}
      value={activeStep}
    >
      <StepperNav className="mb-5">
        <StepperItem completed={feedSaved} loading={feedSaving} step={1}>
          <StepperTrigger>
            <StepperIndicator className={STEP_INDICATOR_CLASS}>
              1
            </StepperIndicator>
          </StepperTrigger>
          <StepperSeparator className="group-data-[state=completed]/step:bg-primary" />
        </StepperItem>

        <StepperItem
          completed={addons.length > 0}
          loading={addingAddon}
          step={2}
        >
          <StepperTrigger>
            <StepperIndicator className={STEP_INDICATOR_CLASS}>
              2
            </StepperIndicator>
          </StepperTrigger>
          <StepperSeparator className="group-data-[state=completed]/step:bg-primary" />
        </StepperItem>

        <StepperItem completed={torboxSaved} loading={torboxSaving} step={3}>
          <StepperTrigger>
            <StepperIndicator className={STEP_INDICATOR_CLASS}>
              3
            </StepperIndicator>
          </StepperTrigger>
        </StepperItem>
      </StepperNav>

      <StepperPanel className="text-sm">
        <StepperContent value={1}>
          <SetupFeedStep
            addons={addons}
            initialDiscoverRows={discoverRows}
            initialRows={feedRows}
            onSavedChange={setFeedSaved}
            onSavingChange={setFeedSaving}
          />
        </StepperContent>

        <StepperContent value={2}>
          {addons.length > 0 && !addonsEditMode ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2">
              <div className="flex items-center gap-2">
                <CircleCheck className="size-3.5 fill-primary text-primary-foreground" />
                <span className="font-medium text-xs">
                  {addons.length === 1
                    ? "1 complemento configurado"
                    : `${addons.length} complementos configurados`}
                </span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button size="icon-xs" variant="ghost" />}
                >
                  <EllipsisVerticalIcon className="size-3 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-32">
                  <DropdownMenuItem onClick={() => setAddonsEditMode(true)}>
                    <PencilIcon className="size-3" />
                    Editar
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={removingId !== null}
                    onClick={handleRemoveAllAddons}
                    variant="destructive"
                  >
                    <TrashIcon className="size-3" />
                    Eliminar
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs" htmlFor="onevid-addon-url">
                    URL del servidor
                  </Label>
                  <Badge variant="outline">Opcional</Badge>
                  <span className="text-[0.65rem] text-muted-foreground">
                    protocolo (/manifest)
                  </span>
                </div>
                <div className="flex gap-2">
                  <Input
                    className="h-8 text-xs"
                    id="onevid-addon-url"
                    onChange={(e) => setAddonUrl(e.target.value)}
                    placeholder="https://mi-servidor.com"
                    value={addonUrl}
                  />
                  <Button
                    className="btn-primary shrink-0"
                    disabled={!addonUrl.trim() || addingAddon}
                    onClick={handleAddAddon}
                    size="sm"
                  >
                    {addingAddon ? (
                      <LoaderIcon className="size-3 animate-spin" />
                    ) : (
                      <PlusIcon className="size-3" />
                    )}
                    {addingAddon ? "Validando..." : "Añadir"}
                  </Button>
                </div>
                {addonError && (
                  <p className="text-destructive text-xs">{addonError}</p>
                )}
              </div>

              {addons.length === 0 ? (
                <p className="text-[0.7rem] text-muted-foreground">
                  Aún no has añadido ningún complemento. Necesitas al menos uno.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {addons.map((addon) => (
                    <li
                      className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2"
                      key={addon.id}
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium text-xs">
                          {addon.manifestName}
                          {addon.manifestVersion && (
                            <span className="ml-1 text-muted-foreground">
                              v{addon.manifestVersion}
                            </span>
                          )}
                        </span>
                        <span className="truncate text-[0.65rem] text-muted-foreground">
                          {addon.baseUrl}
                        </span>
                      </div>
                      <Button
                        disabled={removingId === addon.id}
                        onClick={() => handleRemoveAddon(addon.id)}
                        size="icon-xs"
                        variant="ghost"
                      >
                        {removingId === addon.id ? (
                          <LoaderIcon className="size-3 animate-spin" />
                        ) : (
                          <TrashIcon className="size-3 text-muted-foreground" />
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </StepperContent>

        <StepperContent value={3}>
          <div className="space-y-3">
            {torboxSaved ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2">
                <div className="flex items-center gap-2">
                  <CircleCheck className="size-3.5 fill-primary text-primary-foreground" />
                  <span className="font-medium text-xs">
                    TorBox API configurada
                  </span>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button size="icon-xs" variant="ghost" />}
                  >
                    <EllipsisVerticalIcon className="size-3 text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-32">
                    <DropdownMenuItem onClick={() => setTorboxSaved(false)}>
                      <PencilIcon className="size-3" />
                      Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={removingTorbox}
                      onClick={handleRemoveTorboxKey}
                      variant="destructive"
                    >
                      <TrashIcon className="size-3" />
                      Eliminar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs" htmlFor="torbox-key">
                    TorBox API Key
                  </Label>
                  <Badge variant="outline">Opcional</Badge>
                  <a
                    className="text-[0.65rem] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    href="https://torbox.app/settings"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    obtener
                  </a>
                </div>
                <div className="flex gap-2">
                  <Input
                    className="h-8 text-xs"
                    id="torbox-key"
                    onChange={(e) => setTorboxKeyValue(e.target.value)}
                    placeholder="tb_xxx..."
                    value={torboxKeyValue}
                  />
                  <Button
                    className="btn-primary shrink-0"
                    disabled={!torboxKeyValue.trim() || torboxSaving}
                    onClick={handleSaveTorboxKey}
                    size="sm"
                  >
                    {torboxSaving && (
                      <LoaderIcon className="size-3 animate-spin" />
                    )}
                    {torboxSaving ? "Guardando..." : "Guardar"}
                  </Button>
                </div>
                {torboxError && (
                  <p className="text-destructive text-xs">{torboxError}</p>
                )}
              </div>
            )}
          </div>
        </StepperContent>
      </StepperPanel>

      {/* Todos los pasos (feed, complementos, TorBox) son opcionales: se puede
          finalizar sin configurar nada. Sin guardar el feed, /home usa
          DEFAULT_FEED_ROWS. */}
      {!setupCompleted && (
        <div className="mt-4 flex flex-col gap-2">
          <Button
            className="btn-primary w-full"
            disabled={finishing}
            onClick={handleFinish}
            size="sm"
          >
            {finishing && <LoaderIcon className="size-3 animate-spin" />}
            {finishing ? "Finalizando..." : "Finalizar configuración"}
          </Button>
          {finishError && (
            <p className="text-destructive text-xs">{finishError}</p>
          )}
        </div>
      )}
    </Stepper>
  );
}
