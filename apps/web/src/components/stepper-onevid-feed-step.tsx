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

interface SetupFeedStepProps {
  initialDiscoverRows: OneVidFeedRow[];
  initialRows: OneVidFeedRow[];
  /** Alimenta `completed` del StepperItem 2 (se apaga al haber cambios sin guardar). */
  onSavedChange: (saved: boolean) => void;
  /** Alimenta `loading` del StepperItem 2. */
  onSavingChange: (saving: boolean) => void;
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
  emptyHint,
  label,
  onRowsChange,
  rows,
}: {
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

  const [draftType, setDraftType] = useState<FeedMediaType>("movie");
  const [draftNetwork, setDraftNetwork] = useState("all");
  const [error, setError] = useState("");

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
    const networkId =
      draftNetwork !== "all" ? Number(draftNetwork) : undefined;
    const row: OneVidFeedRow = networkId
      ? { type: draftType, catalog: "trending", networkId }
      : { type: draftType, catalog: "trending" };
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
            onValueChange={(val) => setDraftType(val as FeedMediaType)}
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
            items={[
              { value: "all", label: t("Todas las cadenas") },
              ...networks.map((n) => ({ value: String(n.id), label: n.name })),
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
                row.networkId ? networkNameById.get(row.networkId) : undefined
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
            emptyHint="Sin filas: tu inicio usará la selección por defecto."
            label="Filas de tu inicio"
            onRowsChange={applyRows}
            rows={rows}
          />
        </TabsContent>

        <TabsContent value="discover">
          <FeedSurfaceEditor
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