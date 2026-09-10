"use client";

import { Button } from "@workspace/ui/components/button";
import { Switch } from "@workspace/ui/components/switch";
import { cn } from "@workspace/ui/lib/utils";
import { ChevronDownIcon, ChevronUpIcon, Loader } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DEFAULT_QUALITY_ORDER,
  type QualityPref,
  QUALITY_LABELS,
} from "@/lib/stream-quality";

/** Mueve un elemento una posición arriba o abajo, sin salirse de la lista. */
function move(order: QualityPref[], index: number, delta: number): QualityPref[] {
  const target = index + delta;
  if (target < 0 || target >= order.length) {
    return order;
  }
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * Orden y filtro de calidad de las fuentes. Lo que se deja aquí lo aplica el
 * servidor en `/api/stream/sources`, así que vale igual para la web, la app y
 * la TV — y como la fuente que abre el reproductor es la primera de la lista,
 * este orden decide también con qué calidad arranca cada título.
 */
export function OneVidQualityOrder() {
  const [order, setOrder] = useState<QualityPref[]>(DEFAULT_QUALITY_ORDER);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/onevid-quality", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then((data: { order?: QualityPref[] }) => {
        if (Array.isArray(data.order)) {
          setOrder(data.order);
        }
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        // Sin preferencia guardada la vista sigue siendo usable: se edita sobre
        // el orden por defecto y al guardar se crea la fila.
        setLoading(false);
      });
    return () => controller.abort();
  }, []);

  function update(next: QualityPref[]) {
    setOrder(next);
    setSaved(false);
    setFailed(false);
  }

  async function save() {
    setSaving(true);
    setFailed(false);
    try {
      const res = await fetch("/api/onevid-quality", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      });
      if (!res.ok) {
        throw new Error(String(res.status));
      }
      setSaved(true);
    } catch {
      setFailed(true);
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
        <Loader className="size-4 animate-spin" />
        <p className="text-xs">Cargando calidades…</p>
      </div>
    );
  }

  const noneEnabled = order.every((entry) => !entry.enabled);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs leading-relaxed">
        La primera calidad encendida es la que abre el reproductor. Apaga una
        para que sus medios no aparezcan en la lista.
      </p>

      <div className="flex flex-col gap-1">
        {order.map((entry, index) => (
          <div
            className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-2.5",
              entry.enabled ? "border-border" : "border-border/50 opacity-60"
            )}
            key={entry.tier}
          >
            <span className="w-6 text-muted-foreground text-xs tabular-nums">
              {index + 1}
            </span>
            <span className="flex-1 text-sm">{QUALITY_LABELS[entry.tier]}</span>

            <Button
              aria-label={`Subir ${QUALITY_LABELS[entry.tier]}`}
              data-dpad-focusable
              disabled={index === 0}
              onClick={() => update(move(order, index, -1))}
              size="icon"
              variant="ghost"
            >
              <ChevronUpIcon className="size-4" />
            </Button>
            <Button
              aria-label={`Bajar ${QUALITY_LABELS[entry.tier]}`}
              data-dpad-focusable
              disabled={index === order.length - 1}
              onClick={() => update(move(order, index, 1))}
              size="icon"
              variant="ghost"
            >
              <ChevronDownIcon className="size-4" />
            </Button>

            <Switch
              checked={entry.enabled}
              data-dpad-focusable
              onCheckedChange={(checked) =>
                update(
                  order.map((item) =>
                    item.tier === entry.tier
                      ? { ...item, enabled: checked }
                      : item
                  )
                )
              }
            />
          </div>
        ))}
      </div>

      {noneEnabled && (
        // No se bloquea el guardado: el servidor ya ignora el filtro cuando
        // dejaría la lista vacía, porque quedarse sin fuentes rompería la
        // reproducción. Pero conviene avisar de que no va a hacer nada.
        <p className="text-muted-foreground text-xs">
          Con todas apagadas el filtro se ignora y se muestran todos los medios.
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button
          data-dpad-focusable
          disabled={saving}
          onClick={save}
          size="sm"
        >
          {saving ? <Loader className="size-4 animate-spin" /> : null}
          Guardar
        </Button>
        {saved && <span className="text-primary text-xs">Guardado</span>}
        {failed && (
          <span className="text-destructive text-xs">
            No se pudo guardar. Inténtalo otra vez.
          </span>
        )}
      </div>
    </div>
  );
}
