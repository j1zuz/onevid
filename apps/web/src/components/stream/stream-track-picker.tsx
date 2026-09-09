"use client";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@workspace/ui/components/drawer";
import { cn } from "@workspace/ui/lib/utils";
import { CheckIcon, LanguagesIcon } from "lucide-react";
import { useState } from "react";
import type { MediaTrackOption } from "@/hooks/use-media-tracks";

interface StreamTrackPickerProps {
  activeAudioId: string | null;
  /** `null` = subtítulos desactivados. */
  activeSubtitleId: string | null;
  audioTracks: MediaTrackOption[];
  onSelectAudio: (id: string) => void;
  onSelectSubtitle: (id: string | null) => void;
  subtitleTracks: MediaTrackOption[];
}

function TrackRow({
  isActive,
  label,
  onSelect,
}: {
  isActive: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      aria-checked={isActive}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-lg border p-2.5 text-left outline-none transition-[border-color,box-shadow]",
        isActive
          ? "border-primary/60 bg-accent"
          : "border-border/50 bg-background hover:border-primary/40"
      )}
      data-dpad-focusable
      onClick={onSelect}
      role="radio"
      type="button"
    >
      <span className="min-w-0 flex-1 truncate text-foreground text-xs">
        {label}
      </span>
      {isActive && <CheckIcon className="size-4 shrink-0 text-foreground" />}
    </button>
  );
}

/**
 * Selector de idioma del audio y de subtítulos, en la barra superior del player
 * junto al de medios. Vive aquí y no dentro del skin porque las pistas de audio
 * de la ruta MSE las sirve `useMediaBunny`, no el navegador: al estar los dos
 * selectores en el mismo sitio, el usuario tiene un único lugar donde tocar lo
 * que suena y lo que se lee.
 *
 * El botón está siempre, igual que el de medios, para que el sitio donde se
 * cambia el idioma no dependa de lo que traiga el archivo. Si no hay
 * alternativas, el panel lo dice en lugar de abrirse vacío.
 */
export function StreamTrackPicker({
  activeAudioId,
  activeSubtitleId,
  audioTracks,
  onSelectAudio,
  onSelectSubtitle,
  subtitleTracks,
}: StreamTrackPickerProps) {
  const [open, setOpen] = useState(false);
  const showAudio = audioTracks.length > 0;
  const showSubtitles = subtitleTracks.length > 0;

  return (
    <>
      <button
        aria-label="Audio y subtítulos"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
        onClick={() => setOpen(true)}
        type="button"
      >
        <LanguagesIcon className="size-5" />
      </button>

      <Drawer onOpenChange={setOpen} open={open} swipeDirection="right">
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Audio y subtítulos</DrawerTitle>
          </DrawerHeader>
          <div className="no-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pt-3 pb-4">
            {showAudio && (
              <section aria-label="Idioma del audio" role="radiogroup">
                <h3 className="px-0.5 pb-2 font-semibold text-[0.6875rem] text-muted-foreground uppercase tracking-wide">
                  Idioma del audio
                </h3>
                <div className="space-y-1.5">
                  {audioTracks.map((track) => (
                    <TrackRow
                      isActive={track.id === activeAudioId}
                      key={track.id}
                      label={track.label}
                      onSelect={() => {
                        setOpen(false);
                        onSelectAudio(track.id);
                      }}
                    />
                  ))}
                </div>
              </section>
            )}

            {!(showAudio || showSubtitles) && (
              <div className="rounded-lg border border-border/50 bg-muted/50 p-3">
                <p className="text-muted-foreground text-xs">
                  Este medio no trae más idiomas ni subtítulos. Prueba con otro
                  desde el selector de medios.
                </p>
              </div>
            )}

            {showSubtitles && (
              <section aria-label="Subtítulos" role="radiogroup">
                <h3 className="px-0.5 pb-2 font-semibold text-[0.6875rem] text-muted-foreground uppercase tracking-wide">
                  Subtítulos
                </h3>
                <div className="space-y-1.5">
                  <TrackRow
                    isActive={activeSubtitleId === null}
                    label="Desactivados"
                    onSelect={() => {
                      setOpen(false);
                      onSelectSubtitle(null);
                    }}
                  />
                  {subtitleTracks.map((track) => (
                    <TrackRow
                      isActive={track.id === activeSubtitleId}
                      key={track.id}
                      label={track.label}
                      onSelect={() => {
                        setOpen(false);
                        onSelectSubtitle(track.id);
                      }}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
