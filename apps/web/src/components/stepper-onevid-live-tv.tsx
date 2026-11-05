"use client";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";
import {
  CalendarDaysIcon,
  PlusIcon,
  TrashIcon,
  TvIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { LIVE_TV_MAX_SOURCES, type LiveTvSourceSummary } from "@/lib/live-tv";

interface SetupLiveTvSourcesProps {
  editing: boolean;
  onConfiguredChange: (configured: boolean) => void;
}

export function SetupLiveTvSources({
  editing,
  onConfiguredChange,
}: SetupLiveTvSourcesProps) {
  const router = useRouter();
  const [sources, setSources] = useState<LiveTvSourceSummary[]>([]);
  const [type, setType] = useState<"m3u" | "xtream">("m3u");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [guideSource, setGuideSource] = useState<string | null>(null);
  const [error, setError] = useState("");

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is a retry trigger, not read inside the effect.
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    let active = true;
    setLoading(true);
    setError("");
    async function load() {
      try {
        const response = await fetch("/api/onevid-live-tv", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error();
        const data: { sources: LiveTvSourceSummary[] } = await response.json();
        if (!Array.isArray(data.sources)) throw new Error();
        if (!active) return;
        setSources(data.sources);
        setLoaded(true);
        onConfiguredChange(data.sources.length > 0);
      } catch {
        if (active)
          setError(
            "No se pudieron cargar las fuentes de Live TV. Inténtalo de nuevo.",
          );
      } finally {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [attempt, onConfiguredChange]);

  async function addSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const text = (name: string) => String(fields.get(name) ?? "").trim();
    if (busy) return;
    const name = text("name");
    const epgUrl = text("epgUrl");
    const payload = {
      type,
      ...(name ? { name } : {}),
      ...(epgUrl ? { epgUrl } : {}),
      ...(type === "m3u"
        ? { url: text("url") }
        : {
            serverUrl: text("serverUrl"),
            username: String(fields.get("username") ?? ""),
            password: String(fields.get("password") ?? ""),
          }),
    };
    setBusy("add");
    setError("");
    try {
      const response = await fetch("/api/onevid-live-tv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45_000),
      });
      const data: { source?: LiveTvSourceSummary; error?: string } =
        await response.json();
      if (!response.ok || !data.source) {
        setError(data.error || "No se pudo añadir la fuente de Live TV.");
        return;
      }
      const source = data.source;
      setSources((current) => [...current, source]);
      onConfiguredChange(true);
      form.reset();
      router.refresh();
    } catch {
      setError(
        "No se pudo contactar con el servidor. Revisa tu conexión y vuelve a intentarlo.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function removeSource(id: string) {
    if (busy) return;
    setBusy(id);
    setError("");
    try {
      const response = await fetch("/api/onevid-live-tv", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error();
      const remaining = sources.filter((source) => source.id !== id);
      setSources(remaining);
      onConfiguredChange(remaining.length > 0);
      if (guideSource === id) setGuideSource(null);
      router.refresh();
    } catch {
      setError("No se pudo eliminar la fuente de Live TV. Inténtalo de nuevo.");
    } finally {
      setBusy(null);
    }
  }

  async function saveGuide(id: string, epgUrl: string | null) {
    if (busy) return;
    setBusy(`epg:${id}`);
    setError("");
    try {
      const response = await fetch("/api/onevid-live-tv", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, epgUrl }),
        signal: AbortSignal.timeout(20_000),
      });
      const data: { source?: LiveTvSourceSummary; error?: string } =
        await response.json();
      if (!response.ok || !data.source) {
        setError(data.error || "No se pudo guardar la guía de Live TV.");
        return;
      }
      const updated = data.source;
      setSources((current) =>
        current.map((source) => (source.id === id ? updated : source)),
      );
      setGuideSource(null);
      router.refresh();
    } catch {
      setError("No se pudo guardar la guía de Live TV. Inténtalo de nuevo.");
    } finally {
      setBusy(null);
    }
  }

  if (!editing) return null;

  return (
    <section
      aria-label="Configuración de Live TV"
      className="mt-4 space-y-3 border-t pt-4"
    >
      <div className="flex items-center gap-1.5">
        <TvIcon aria-hidden="true" className="size-3.5" />
        <h3 className="font-medium text-xs">Live TV</h3>
        <Badge variant="outline">Opcional</Badge>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: segmented control; a fieldset would add unwanted form semantics. */}
      <div
        aria-label="Tipo de fuente de Live TV"
        className="flex gap-1 rounded-lg bg-muted/50 p-1"
        role="group"
      >
        {(
          [
            ["m3u", "Lista M3U"],
            ["xtream", "Xtream Codes"],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-pressed={type === value}
            className={cn(
              "flex-1 rounded-md border border-transparent px-3 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-primary",
              type === value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            data-dpad-focusable
            disabled={busy !== null}
            key={value}
            onClick={() => setType(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <form className="space-y-3" key={type} onSubmit={addSource}>
        <fieldset
          className="space-y-3 disabled:opacity-60"
          disabled={busy !== null}
        >
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="onevid-live-name">
              Nombre (opcional)
            </Label>
            <Input
              autoComplete="off"
              className="h-8 text-xs"
              data-dpad-focusable
              defaultValue=""
              id="onevid-live-name"
              maxLength={120}
              name="name"
              placeholder="Mi televisión"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="onevid-live-url">
              {type === "m3u" ? "URL de la lista" : "URL del servidor"}
            </Label>
            <Input
              autoCapitalize="none"
              autoComplete="off"
              className="h-8 text-xs"
              data-dpad-focusable
              defaultValue=""
              id="onevid-live-url"
              maxLength={2048}
              name={type === "m3u" ? "url" : "serverUrl"}
              pattern="https://.*"
              placeholder={
                type === "m3u"
                  ? "https://mi-proveedor.com/canales.m3u"
                  : "https://mi-proveedor.com"
              }
              required
              spellCheck={false}
              title="Solo se aceptan URLs HTTPS"
              type="url"
            />
          </div>
          {type === "xtream" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="onevid-live-user">
                  Usuario
                </Label>
                <Input
                  autoCapitalize="none"
                  autoComplete="off"
                  className="h-8 text-xs"
                  data-dpad-focusable
                  defaultValue=""
                  id="onevid-live-user"
                  maxLength={256}
                  name="username"
                  required
                  spellCheck={false}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="onevid-live-password">
                  Contraseña
                </Label>
                <Input
                  autoComplete="new-password"
                  className="h-8 text-xs"
                  data-dpad-focusable
                  defaultValue=""
                  id="onevid-live-password"
                  maxLength={256}
                  name="password"
                  required
                  type="password"
                />
              </div>
            </div>
          ) : null}
          <details className="rounded-lg border border-border/60 px-3 py-2">
            <summary
              className="cursor-pointer text-xs text-muted-foreground"
              data-dpad-focusable
            >
              Guía de programación · EPG (opcional)
            </summary>
            <div className="mt-3 space-y-1.5">
              <Label className="text-xs" htmlFor="onevid-live-epg">
                URL XMLTV
              </Label>
              <Input
                autoCapitalize="none"
                autoComplete="off"
                className="h-8 text-xs"
                data-dpad-focusable
                defaultValue=""
                id="onevid-live-epg"
                maxLength={2048}
                name="epgUrl"
                pattern="https://.*"
                placeholder="https://mi-proveedor.com/guia.xml"
                spellCheck={false}
                title="Solo se aceptan URLs HTTPS"
                type="url"
              />
              <p className="text-[0.65rem] text-muted-foreground">
                {type === "xtream"
                  ? "Xtream Codes incluye su guía automáticamente. Usa esta URL solo para reemplazarla."
                  : "Vincula los horarios de tus canales mediante su identificador tvg-id."}
              </p>
            </div>
          </details>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[0.65rem] text-muted-foreground">
              Solo HTTPS. Reproducción HLS compatible con CORS.
            </p>
            <Button
              className="btn-primary shrink-0"
              data-dpad-focusable
              disabled={
                loading || !loaded || sources.length >= LIVE_TV_MAX_SOURCES
              }
              size="sm"
              type="submit"
            >
              {busy === "add" ? (
                <Spinner aria-label="Validando fuente" className="size-3" />
              ) : (
                <PlusIcon className="size-3" />
              )}
              {busy === "add" ? "Validando..." : "Añadir"}
            </Button>
          </div>
        </fieldset>
      </form>
      {loading ? (
        <div className="space-y-2" role="status">
          <span className="sr-only">Cargando fuentes de Live TV...</span>
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      ) : null}
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !loaded ? (
        <Button
          data-dpad-focusable
          onClick={() => setAttempt((current) => current + 1)}
          size="sm"
          variant="outline"
        >
          Reintentar
        </Button>
      ) : null}
      {sources.length ? (
        <ul className="space-y-2">
          {sources.map((source) => (
            <li
              className="rounded-lg border bg-muted/20 px-3 py-2"
              key={source.id}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-xs">{source.name}</p>
                  <p className="text-[0.65rem] text-muted-foreground">
                    {source.channelCount} canales ·{" "}
                    {source.type === "xtream" ? "Xtream Codes" : "M3U"}
                    {source.hasEpg ? " · EPG" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    aria-expanded={guideSource === source.id}
                    aria-label={`Configurar EPG de ${source.name}`}
                    data-dpad-focusable
                    disabled={busy !== null}
                    onClick={() =>
                      setGuideSource((current) =>
                        current === source.id ? null : source.id,
                      )
                    }
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <CalendarDaysIcon className="size-3.5" />
                  </Button>
                  <Button
                    aria-label={`Eliminar ${source.name}`}
                    data-dpad-focusable
                    disabled={busy !== null}
                    onClick={() => removeSource(source.id)}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    {busy === source.id ? (
                      <Spinner aria-label="Procesando fuente" className="size-3" />
                    ) : (
                      <TrashIcon className="size-3 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>
              {guideSource === source.id ? (
                <form
                  className="mt-3 space-y-2 border-t pt-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const url = String(
                      new FormData(event.currentTarget).get("epgUrl") ?? "",
                    ).trim();
                    if (url) void saveGuide(source.id, url);
                  }}
                >
                  <Label
                    className="text-xs"
                    htmlFor={`live-guide-${source.id}`}
                  >
                    URL HTTPS de la guía XMLTV
                  </Label>
                  <Input
                    autoComplete="off"
                    className="h-8 text-xs"
                    data-dpad-focusable
                    defaultValue=""
                    disabled={busy !== null}
                    id={`live-guide-${source.id}`}
                    maxLength={2048}
                    name="epgUrl"
                    pattern="https://.*"
                    placeholder="https://mi-proveedor.com/guia.xml"
                    required
                    spellCheck={false}
                    title="Solo se aceptan URLs HTTPS"
                    type="url"
                  />
                  <p className="text-[0.65rem] text-muted-foreground">
                    La URL guardada es privada. Escribe una nueva para
                    reemplazarla.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      data-dpad-focusable
                      disabled={busy !== null}
                      size="sm"
                      type="submit"
                    >
                      {busy === `epg:${source.id}` ? (
                        <Spinner aria-label="Guardando guía" className="size-3" />
                      ) : null}
                      Guardar guía
                    </Button>
                    {source.hasEpg ? (
                      <Button
                        data-dpad-focusable
                        disabled={busy !== null}
                        onClick={() => saveGuide(source.id, null)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        {source.type === "xtream"
                          ? "Usar guía automática"
                          : "Quitar guía"}
                      </Button>
                    ) : null}
                  </div>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
