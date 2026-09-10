"use client";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@workspace/ui/components/drawer";
import { Badge } from "@workspace/ui/components/badge";
import { cn } from "@workspace/ui/lib/utils";
import { CheckIcon, LayersIcon, Loader } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { QUALITY_LABELS } from "@/lib/stream-quality";
import type { StreamType, StreamWithAddon } from "@/types/stream";

interface StreamSourcePickerProps {
  /** Medio en reproducción: se marca con un check y se omite al cambiar. */
  activeSource: StreamWithAddon | null;
  /**
   * Identidad del contenido para `/api/stream/sources`: en series debe ser el
   * ID compuesto del episodio (`tt…:temporada:episodio`), no el TMDB base.
   */
  contentId: string;
  contentType: StreamType;
  onSelect: (source: StreamWithAddon) => void;
}

function getStreamLines(source: StreamWithAddon): string[] {
  const behaviors = Array.isArray(source.behaviors) ? source.behaviors : [];
  return [
    source.title,
    source.description,
    source.name,
    ...behaviors,
  ].filter((line): line is string => Boolean(line?.trim()));
}

function SourceItem({
  isActive,
  onSelect,
  source,
}: {
  isActive: boolean;
  onSelect: (source: StreamWithAddon) => void;
  source: StreamWithAddon;
}) {
  const lines = getStreamLines(source);

  return (
    // biome-ignore lint/a11y/useSemanticElements: clickable list item needs div for layout
    <div
      className={cn(
        "relative cursor-pointer rounded-lg border p-2.5 text-left outline-none transition-[border-color,box-shadow,filter]",
        isActive
          ? "border-primary/60 bg-accent"
          : "border-border/50 bg-background hover:border-primary/40"
      )}
      data-dpad-focusable
      onClick={() => onSelect(source)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(source);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          {/* La calidad la resuelve el servidor y es la que manda en el orden
              de esta lista; se muestra aparte para que se pueda leer de un
              vistazo sin buscarla dentro del texto del addon. */}
          {source.quality && (
            <Badge variant="secondary">{QUALITY_LABELS[source.quality]}</Badge>
          )}
          {lines.map((line, index) => (
            <p
              className={cn(
                "whitespace-pre-line text-xs leading-relaxed",
                index === 0
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              )}
              // biome-ignore lint/suspicious/noArrayIndexKey: stream metadata is static text from addon
              key={index}
            >
              {line}
            </p>
          ))}
        </div>
        {isActive && (
          <CheckIcon className="mt-0.5 size-4 shrink-0 text-foreground" />
        )}
      </div>
    </div>
  );
}

/**
 * Panel para cambiar el medio (fuente de video) sin salir del player. Lista
 * los mismos medios que el detalle, pidiéndolos al mismo endpoint, dentro del
 * Drawer lateral del proyecto. Se monta ya dentro del player, así que la
 * carga arranca apenas se renderiza y no al abrir el panel: para cuando el
 * usuario lo abre, la lista casi siempre ya está (o está a punto).
 */
export function StreamSourcePicker({
  activeSource,
  contentId,
  contentType,
  onSelect,
}: StreamSourcePickerProps) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<StreamWithAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setFailed(false);
    fetch("/api/stream/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: contentId, type: contentType }),
      signal: controller.signal,
    })
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(String(res.status)))
      )
      .then((data: { sources?: StreamWithAddon[] }) => {
        setSources(data.sources ?? []);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setFailed(true);
        setLoading(false);
      });
  }, [contentId, contentType]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  const handleSelect = (source: StreamWithAddon) => {
    setOpen(false);
    if (source.url !== activeSource?.url) {
      onSelect(source);
    }
  };

  return (
    <>
      <button
        aria-label="Cambiar medio"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
        onClick={() => setOpen(true)}
        type="button"
      >
        <LayersIcon className="size-5" />
      </button>

      <Drawer onOpenChange={setOpen} open={open} swipeDirection="right">
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Medios</DrawerTitle>
          </DrawerHeader>
          <div className="no-scrollbar min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 pt-3 pb-4">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
                <Loader className="size-4 animate-spin" />
                <p className="text-xs">Cargando medios…</p>
              </div>
            )}

            {!loading && failed && (
              <div className="flex flex-col items-center gap-2 py-6">
                <p className="text-muted-foreground text-xs">
                  No se pudieron cargar los medios.
                </p>
                <button
                  className="rounded-md bg-muted px-3 py-1.5 text-foreground text-xs transition-colors hover:bg-accent"
                  onClick={load}
                  type="button"
                >
                  Reintentar
                </button>
              </div>
            )}

            {!loading && !failed && sources.length === 0 && (
              <div className="rounded-lg border border-border/50 bg-muted/50 p-3">
                <p className="text-muted-foreground text-xs">
                  No hay otros medios disponibles.
                </p>
              </div>
            )}

            {!loading &&
              !failed &&
              sources.map((source) => (
                <SourceItem
                  isActive={source.url === activeSource?.url}
                  key={`${source.addonId}-${source.sourceIndex}`}
                  onSelect={handleSelect}
                  source={source}
                />
              ))}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
