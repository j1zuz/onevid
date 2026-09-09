"use client";

import { Loader, SkipForwardIcon } from "lucide-react";
import { useState } from "react";
import type { StreamWithAddon } from "@/types/stream";

export interface NextEpisodeRef {
  /** `<tmdbId>:<temporada>:<episodio>`, el id que espera la ruta del player. */
  playId: string;
  episode: number;
  name: string;
  season: number;
}

interface StreamNextEpisodeProps {
  next: NextEpisodeRef;
  onPlay: (next: NextEpisodeRef, source: StreamWithAddon) => void;
}

/**
 * Botón para saltar al episodio siguiente, que aparece cuando el actual está a
 * punto de acabar. Solo en series, y solo si de verdad hay un episodio después
 * (ver `useNextEpisode` en stream-onevid).
 *
 * Resuelve el medio aquí y no en la página de destino porque el player espera
 * la fuente ya elegida en `sessionStorage`: navegar sin ella mostraría
 * "No se pudo cargar la fuente de reproduccion".
 */
export function StreamNextEpisode({ next, onPlay }: StreamNextEpisodeProps) {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleClick = async () => {
    if (loading) {
      return;
    }
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch("/api/stream/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: next.playId, type: "series" }),
      });
      if (!res.ok) {
        throw new Error(String(res.status));
      }
      const data = (await res.json()) as { sources?: StreamWithAddon[] };
      const source = data.sources?.[0];
      if (!source) {
        throw new Error("sin medios");
      }
      onPlay(next, source);
    } catch {
      // El siguiente episodio puede existir en TMDB y no tener medios todavía;
      // se avisa en el propio botón en vez de dejarlo girando.
      setFailed(true);
      setLoading(false);
    }
  };

  return (
    <div className="absolute right-4 bottom-20 z-40 flex flex-col items-end gap-1.5">
      {failed && (
        <p className="rounded-md bg-black/70 px-2 py-1 text-white text-xs backdrop-blur-sm">
          No hay medios para el siguiente episodio
        </p>
      )}
      <button
        className="flex items-center gap-2 rounded-lg bg-white/90 px-4 py-2.5 font-medium text-black text-sm shadow-lg transition-colors hover:bg-white disabled:opacity-70"
        data-dpad-focusable
        disabled={loading}
        onClick={handleClick}
        type="button"
      >
        {loading ? (
          <Loader className="size-4 animate-spin" />
        ) : (
          <SkipForwardIcon className="size-4 fill-current" />
        )}
        <span className="max-w-56 truncate">
          {failed ? "Reintentar" : `Siguiente: T${next.season} E${next.episode}`}
        </span>
      </button>
    </div>
  );
}
