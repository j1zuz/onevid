"use client";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  GripVerticalIcon,
  LoaderIcon,
  PlusIcon,
  TrashIcon,
} from "lucide-react";
import { Reorder, useDragControls } from "motion/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  type AddonCatalogRef,
  buildFeedRowId,
  FEED_MAX_ROWS,
  type FeedMediaType,
  type FeedRowWithId,
  getFeedRowTitle,
  getNetworkOptions,
  type OneVidFeedRow,
  withFeedRowIds,
} from "@/lib/onevid-feed";
import { useTranslation } from "@/lib/onevid-i18n-context";

/** Lo mínimo que necesita este paso de un addon para ofrecer su catálogo. */
interface FeedAddonOption {
  catalogs: AddonCatalogRef[];
  id: string;
  manifestName: string;
}

interface SetupFeedStepProps {
  /** Addons del usuario, para poder añadir filas con su catálogo propio. */
  addons: FeedAddonOption[];
  initialDiscoverRows: OneVidFeedRow[];
  initialRows: OneVidFeedRow[];
  /** Alimenta `completed` del StepperItem 2 (se apaga al haber cambios sin guardar). */
  onSavedChange: (saved: boolean) => void;
  /** Alimenta `loading` del StepperItem 2. */
  onSavingChange: (saving: boolean) => void;
}

/**
 * Una opción del selector "fuente" al añadir una fila: TMDB Tendencias, o el
 * catálogo propio de un addon (formato Stremio). `value` es lo que persiste
 * el `<Select>`; los demás campos alimentan la fila que se agrega.
 */
type CatalogSourceOption =
  | {
      addonCatalogId: string;
      addonId: string;
      addonName: string;
      catalogName: string;
      kind: "addon";
      value: string;
    }
  | { kind: "trending"; value: "trending" };

function buildCatalogSourceOptions(
  addons: FeedAddonOption[],
  type: FeedMediaType
): CatalogSourceOption[] {
  const fromAddons: CatalogSourceOption[] = addons.flatMap((addon) =>
    addon.catalogs
      .filter((c) => c.type === type)
      .map((c) => ({
        addonCatalogId: c.id,
        addonId: addon.id,
        addonName: addon.manifestName,
        catalogName: c.name,
        kind: "addon" as const,
        value: `${addon.id}::${c.id}`,
      }))
  );
  return [{ kind: "trending", value: "trending" }, ...fromAddons];
}

function FeedRowItem({
  canMoveDown,
  canMoveUp,
  label,
  onMoveDown,
  onMoveUp,
  onRemove,
  row,
}: {
  canMoveDown: boolean;
  canMoveUp: boolean;
  label: string;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onRemove: () => void;
  row: FeedRowWithId;
}) {
  const controls = useDragControls();

  return (
    <Reorder.Item
      as="li"
      // `relative` es obligatorio: el z-index que motion pone al item arrastrado
      // no aplica sobre elementos `position: static`, y la fila pasaría por
      // debajo de sus hermanas.
      className="relative flex items-center gap-1 rounded-md border bg-muted/30 py-1.5 pr-1 pl-2"
      dragControls={controls}
      dragListener={false}
      value={row.id}
    >
      <button
        aria-label="Arrastrar para reordenar"
        // touch-none: sin esto el navegador se queda el gesto en móvil.
        className="cursor-grab touch-none text-muted-foreground"
        // El handle queda fuera de la navegación por mando: en TV se reordena
        // con los botones de subir/bajar.
        data-dpad-disabled="true"
        onPointerDown={(event) => {
          // El Drawer de configuración es swipeable; sin esto el gesto se lo
          // come el drawer en vez de arrastrar la fila.
          event.stopPropagation();
          controls.start(event);
        }}
        type="button"
      >
        <GripVerticalIcon className="size-3.5" />
      </button>

      <span className="min-w-0 flex-1 truncate text-xs">{label}</span>

      <Button
        aria-label="Subir"
        data-dpad-focusable
        disabled={!canMoveUp}
        onClick={onMoveUp}
        size="icon-xs"
        variant="ghost"
      >
        <ChevronUpIcon className="size-3" />
      </Button>
      <Button
        aria-label="Bajar"
        data-dpad-focusable
        disabled={!canMoveDown}
        onClick={onMoveDown}
        size="icon-xs"
        variant="ghost"
      >
        <ChevronDownIcon className="size-3" />
      </Button>
      <Button
        aria-label="Quitar"
        data-dpad-focusable
        onClick={onRemove}
        size="icon-xs"
        variant="ghost"
      >
        <TrashIcon className="size-3 text-muted-foreground" />
      </Button>
    </Reorder.Item>
  );
}

/**
 * Editor de UNA superficie (inicio o Descubrir): añadir filas, reordenarlas y
 * quitarlas. El guardado NO vive aquí: las dos superficies se persisten juntas
 * desde `SetupFeedStep`, con un único botón.
 */
function FeedSurfaceEditor({
  addons,
  emptyHint,
  label,
  onRowsChange,
  rows,
}: {
  addons: FeedAddonOption[];
  emptyHint: string;
  label: string;
  onRowsChange: (next: FeedRowWithId[]) => void;
  rows: FeedRowWithId[];
}) {
  const { t: rawT } = useTranslation();
  const t = (key: string) => rawT(key as never);

  const networks = useMemo(() => getNetworkOptions(), []);
  const networkNameById = useMemo(
    () => new Map(networks.map((n) => [n.id, n.name])),
    [networks]
  );
  // "addonId::catalogId" -> nombre del catálogo, para el label de cada fila
  // ya agregada (ver getFeedRowTitle más abajo).
  const addonCatalogNameById = useMemo(
    () =>
      new Map(
        addons.flatMap((addon) =>
          addon.catalogs.map((c) => [`${addon.id}::${c.id}`, c.name])
        )
      ),
    [addons]
  );

  const [draftType, setDraftType] = useState<FeedMediaType>("movie");
  const [draftNetwork, setDraftNetwork] = useState("all");
  const [draftSource, setDraftSource] = useState("trending");
  const [error, setError] = useState("");

  const catalogSources = useMemo(
    () => buildCatalogSourceOptions(addons, draftType),
    [addons, draftType]
  );

  function move(from: number, to: number) {
    if (to < 0 || to >= rows.length) {
      return;
    }
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    if (!moved) {
      return;
    }
    next.splice(to, 0, moved);
    onRowsChange(next);
  }

  function handleAdd() {
    if (rows.length >= FEED_MAX_ROWS) {
      setError(`Máximo ${FEED_MAX_ROWS} filas`);
      return;
    }
    const selectedSource = catalogSources.find((s) => s.value === draftSource);

    let row: OneVidFeedRow;
    if (selectedSource?.kind === "addon") {
      row = {
        type: draftType,
        catalog: "addon",
        addonId: selectedSource.addonId,
        addonCatalogId: selectedSource.addonCatalogId,
      };
    } else {
      const networkId =
        draftNetwork !== "all" ? Number(draftNetwork) : undefined;
      row = networkId
        ? { type: draftType, catalog: "trending", networkId }
        : { type: draftType, catalog: "trending" };
    }

    const id = buildFeedRowId(row);
    if (rows.some((r) => r.id === id)) {
      setError("Esa fila ya está en la lista");
      return;
    }
    setError("");
    onRowsChange([...rows, { ...row, id }]);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <Label className="text-xs">{label}</Label>
          <Badge variant="outline">Opcional</Badge>
          <span className="text-[0.65rem] text-muted-foreground">
            arrastra para ordenar
          </span>
        </div>

        <div className="flex gap-1.5">
          <Select
            items={[
              { value: "movie", label: t("Películas") },
              { value: "series", label: t("Series") },
            ]}
            onValueChange={(val) => {
              setDraftType(val as FeedMediaType);
              // Un catálogo de addon es de un solo tipo: al cambiar de tipo la
              // fuente elegida puede dejar de existir, así que se vuelve a
              // Tendencias en vez de arrastrar una selección inválida.
              setDraftSource("trending");
            }}
            value={draftType}
          >
            <SelectTrigger className="flex-1 text-xs" data-dpad-focusable size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="movie">{t("Películas")}</SelectItem>
              <SelectItem value="series">{t("Series")}</SelectItem>
            </SelectContent>
          </Select>

          <Select
            items={catalogSources.map((source) => ({
              value: source.value,
              label:
                source.kind === "addon"
                  ? `${source.addonName} · ${source.catalogName}`
                  : t("Tendencias (TMDB)"),
            }))}
            onValueChange={(val) => setDraftSource(val ?? "trending")}
            value={draftSource}
          >
            <SelectTrigger className="flex-1 text-xs" data-dpad-focusable size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {catalogSources.map((source) => (
                <SelectItem key={source.value} value={source.value}>
                  {source.kind === "addon"
                    ? `${source.addonName} · ${source.catalogName}`
                    : t("Tendencias (TMDB)")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-1.5">
          {draftSource === "trending" && (
            <Select
              items={[
                { value: "all", label: t("Todas las cadenas") },
                ...networks.map((n) => ({
                  value: String(n.id),
                  label: n.name,
                })),
              ]}
              onValueChange={(val) => setDraftNetwork(val ?? "all")}
              value={draftNetwork}
            >
              <SelectTrigger className="flex-1 text-xs" data-dpad-focusable size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Todas las cadenas")}</SelectItem>
                {networks.map((network) => (
                  <SelectItem key={network.id} value={String(network.id)}>
                    {network.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            className="btn-primary shrink-0"
            data-dpad-focusable
            disabled={rows.length >= FEED_MAX_ROWS}
            onClick={handleAdd}
            size="sm"
          >
            <PlusIcon className="size-3" />
            Añadir
          </Button>
        </div>

        {error && <p className="text-destructive text-xs">{error}</p>}
      </div>

      {rows.length === 0 ? (
        <p className="text-[0.7rem] text-muted-foreground">{emptyHint}</p>
      ) : (
        <Reorder.Group
          as="ul"
          axis="y"
          className="space-y-1.5"
          onReorder={(ids: string[]) => {
            const byId = new Map(rows.map((row) => [row.id, row]));
            const next = ids
              .map((id) => byId.get(id))
              .filter((row): row is FeedRowWithId => Boolean(row));
            onRowsChange(next);
          }}
          values={rows.map((row) => row.id)}
        >
          {rows.map((row, index) => (
            <FeedRowItem
              canMoveDown={index < rows.length - 1}
              canMoveUp={index > 0}
              key={row.id}
              label={getFeedRowTitle(
                row,
                t,
                row.catalog === "addon"
                  ? addonCatalogNameById.get(
                      `${row.addonId}::${row.addonCatalogId}`
                    )
                  : row.networkId
                    ? networkNameById.get(row.networkId)
                    : undefined
              )}
              onMoveDown={() => move(index, index + 1)}
              onMoveUp={() => move(index, index - 1)}
              onRemove={() => onRowsChange(rows.filter((r) => r.id !== row.id))}
              row={row}
            />
          ))}
        </Reorder.Group>
      )}
    </div>
  );
}

/**
 * Paso 2 del setup: elige qué filas verá el usuario, en qué orden, y en cuál de
 * las dos superficies — su inicio o la pestaña Descubrir. Cada una guarda su
 * propia lista y las dos las respetan tanto /home como la app.
 */
export function SetupFeedStep({
  addons,
  initialDiscoverRows,
  initialRows,
  onSavedChange,
  onSavingChange,
}: SetupFeedStepProps) {
  const router = useRouter();

  const [rows, setRows] = useState<FeedRowWithId[]>(() =>
    withFeedRowIds(initialRows)
  );
  const [discoverRows, setDiscoverRows] = useState<FeedRowWithId[]>(() =>
    withFeedRowIds(initialDiscoverRows)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Cualquier cambio local invalida el "guardado" hasta el próximo PUT, venga
  // de la superficie que venga: el botón guarda las dos a la vez.
  function applyRows(next: FeedRowWithId[]) {
    setRows(next);
    onSavedChange(false);
  }

  function applyDiscoverRows(next: FeedRowWithId[]) {
    setDiscoverRows(next);
    onSavedChange(false);
  }

  async function handleSave() {
    setSaving(true);
    onSavingChange(true);
    setError("");
    try {
      const res = await fetch("/api/onevid-feed", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discoverRows: discoverRows.map(({ id: _id, ...row }) => row),
          rows: rows.map(({ id: _id, ...row }) => row),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        discoverRows?: OneVidFeedRow[];
        error?: string;
        rows?: OneVidFeedRow[];
      };
      if (!(res.ok && data.rows)) {
        setError(data.error || "Error al guardar tu inicio");
        return;
      }
      setRows(withFeedRowIds(data.rows));
      if (data.discoverRows) {
        setDiscoverRows(withFeedRowIds(data.discoverRows));
      }
      onSavedChange(true);
      router.refresh();
    } catch {
      setError("Error de conexión");
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
  }

  return (
    <div className="space-y-3">
      <Tabs defaultValue="home">
        <TabsList className="w-full">
          <TabsTrigger data-dpad-focusable value="home">
            Inicio
          </TabsTrigger>
          <TabsTrigger data-dpad-focusable value="discover">
            Descubrir
          </TabsTrigger>
        </TabsList>

        <TabsContent value="home">
          <FeedSurfaceEditor
            addons={addons}
            emptyHint="Sin filas: tu inicio usará la selección por defecto."
            label="Filas de tu inicio"
            onRowsChange={applyRows}
            rows={rows}
          />
        </TabsContent>

        <TabsContent value="discover">
          <FeedSurfaceEditor
            addons={addons}
            emptyHint="Sin filas: Descubrir usará la selección por defecto."
            label="Filas de Descubrir"
            onRowsChange={applyDiscoverRows}
            rows={discoverRows}
          />
        </TabsContent>
      </Tabs>

      {error && <p className="text-destructive text-xs">{error}</p>}

      <Button
        className="btn-primary w-full"
        data-dpad-focusable
        disabled={saving || rows.length === 0 || discoverRows.length === 0}
        onClick={handleSave}
        size="sm"
      >
        {saving && <LoaderIcon className="size-3 animate-spin" />}
        Guardar mis filas
      </Button>
    </div>
  );
}