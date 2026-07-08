"use client";

import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { FilmIcon, GlobeIcon, RotateCcwIcon, UploadIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { VideoJsStreamPlayer } from "@/components/stream/video-js-stream-player";
import { type MediaBunnyState, useMediaBunny } from "@/hooks/use-mediabunny";
import type { MimeType } from "@/types/stream";
import { getMimeType, needsMediaBunny } from "@/utils/stream-codec";

const HTTP_URL = /^https?:\/\//i;

/**
 * Radial progress indicator shown while MediaBunny transcodes the audio.
 */
function ProgressRing({ progress, size }: { progress: number; size: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  const offset = c - progress * c;
  const center = size / 2;
  return (
    <svg className="drop-shadow-lg" height={size} width={size}>
      <title>Progreso de transcodificación</title>
      <circle
        cx={center}
        cy={center}
        fill="rgba(0,0,0,0.5)"
        r={r}
        stroke="rgba(255,255,255,0.2)"
        strokeWidth="3"
      />
      <circle
        className="transition-all duration-300"
        cx={center}
        cy={center}
        fill="none"
        r={r}
        stroke="white"
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        strokeWidth="3"
        transform={`rotate(-90 ${center} ${center})`}
      />
      <text
        fill="white"
        fontFamily="sans-serif"
        fontSize="9"
        fontWeight="600"
        textAnchor="middle"
        x={center}
        y={center + 4}
      >
        {Math.round(progress * 100)}%
      </text>
    </svg>
  );
}

/**
 * Playback view shown once a source is chosen: the player (or the transcoding
 * progress / error state) plus the filename and "choose another" control.
 */
function LocalPlayerStage({
  fileName,
  mediaBunny,
  mimeType,
  onReset,
  src,
}: {
  fileName: string;
  mediaBunny: MediaBunnyState;
  mimeType: MimeType;
  onReset: () => void;
  src: string;
}) {
  const isTranscoding = needsMediaBunny(fileName);
  const isProcessing = isTranscoding && mediaBunny.status === "processing";
  const hasError = isTranscoding && mediaBunny.status === "error";
  let activeSrc: string = src;
  if (isTranscoding) {
    activeSrc = mediaBunny.status === "done" ? mediaBunny.src : "";
  }
  const activeMime = isTranscoding ? "video/mp4" : mimeType;
  const progress = isProcessing ? mediaBunny.progress : 0;
  const errorMessage = mediaBunny.status === "error" ? mediaBunny.message : "";

  return (
    <div className="flex flex-col gap-3">
      {hasError ? (
        <div className="flex aspect-video items-center justify-center rounded-lg bg-black">
          <p className="px-4 text-center text-destructive text-sm">
            {errorMessage}
          </p>
        </div>
      ) : (
        <div className="relative">
          {activeSrc ? (
            <VideoJsStreamPlayer
              autoPlay={true}
              className="aspect-video bg-black"
              controls={false}
              mimeType={activeMime}
              playsInline={true}
              preload="auto"
              src={activeSrc}
            />
          ) : (
            <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg bg-black">
              <ProgressRing progress={progress} size={48} />
              <p className="text-white/50 text-xs">Procesando audio…</p>
            </div>
          )}
          {/* Small progress indicator in corner once video is ready but still transcoding */}
          {isProcessing && activeSrc && (
            <div className="absolute top-3 right-3 flex items-center justify-center">
              <ProgressRing progress={progress} size={44} />
            </div>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
          <FilmIcon className="size-3.5 shrink-0" />
          <span className="truncate">{fileName}</span>
        </span>
        <Button onClick={onReset} size="lg" variant="outline">
          <RotateCcwIcon className="size-3" />
          Elegir otro
        </Button>
      </div>
    </div>
  );
}

/**
 * Plays a video chosen from the user's device with the onevid player skin. The
 * file never leaves the browser — it is read through an object URL, so this
 * works with zero setup and gives the app baseline functionality before any
 * streaming config.
 */
export function LocalVideoPlayer() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  // Archivo local original (si lo hay): se pasa a MediaBunny como `BlobSource`
  // (acceso aleatorio) en vez de re-descargar el blob URL como stream.
  const [file, setFile] = useState<File | null>(null);
  const [mimeType, setMimeType] = useState<MimeType>("video/mp4");
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [error, setError] = useState("");

  // MediaBunny: transcode unsupported formats (MKV, AC-3, DDP…) in-browser.
  // Con un `File` local usamos el archivo directo; con una URL remota, la URL.
  const mbSource = file ?? src;
  const mediaBunny = useMediaBunny(
    mbSource && needsMediaBunny(fileName) ? mbSource : null,
    fileName
  );

  // Free the object URL when it is replaced or the component unmounts. Las URLs
  // web (http) no se revocan; solo los object URLs (blob:) de archivos locales.
  useEffect(() => {
    if (!src?.startsWith("blob:")) {
      return;
    }
    return () => URL.revokeObjectURL(src);
  }, [src]);

  function loadFile(file: File | null | undefined) {
    if (!file) {
      return;
    }
    if (!file.type.startsWith("video/")) {
      setError("El archivo seleccionado no es un video válido.");
      return;
    }
    setError("");
    setFile(file);
    setSrc(URL.createObjectURL(file));
    setMimeType(getMimeType(file.name));
    setFileName(file.name);
  }

  function loadUrl(rawUrl: string) {
    const url = rawUrl.trim();
    if (!url) {
      return;
    }
    if (!HTTP_URL.test(url)) {
      setError("Introduce una URL http(s) válida.");
      return;
    }
    setError("");
    let name = url;
    try {
      name = new URL(url).pathname.split("/").pop() || url;
    } catch {
      // si no se puede parsear, usamos la URL completa como nombre.
    }
    setFile(null);
    setSrc(url);
    setMimeType(getMimeType(name));
    setFileName(name);
  }

  function handleReset() {
    setSrc(null);
    setFile(null);
    setMimeType("video/mp4");
    setFileName("");
    setUrlInput("");
    setError("");
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  if (src) {
    return (
      <LocalPlayerStage
        fileName={fileName}
        mediaBunny={mediaBunny}
        mimeType={mimeType}
        onReset={handleReset}
        src={src}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: el contenedor solo recibe drag&drop; el click/teclado van en el botón y el input internos. */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: idem — solo drag&drop en el contenedor. */}
      <div
        className={cn(
          "flex flex-col items-center gap-5 rounded-xl border border-dashed px-8 py-12 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border"
        )}
        onDragLeave={() => setDragging(false)}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          loadFile(e.dataTransfer.files?.[0]);
        }}
      >
        <button
          className="flex cursor-pointer flex-col items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted/40"
          onClick={() => inputRef.current?.click()}
          type="button"
        >
          <span className="flex size-14 items-center justify-center rounded-xl bg-muted text-foreground">
            <UploadIcon className="size-6" />
          </span>
          <span className="flex flex-col gap-1.5">
            <span className="font-medium text-base">
              Sube un video para reproducir
            </span>
            <span className="text-muted-foreground text-sm">
              Arrastra un archivo aquí o haz clic para seleccionarlo.
            </span>
          </span>
        </button>

        <div className="flex w-full max-w-lg items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-muted-foreground text-xs">o</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <form
          className="flex w-full max-w-lg items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            loadUrl(urlInput);
          }}
        >
          <div className="relative flex-1">
            <GlobeIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 pl-9"
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Pega o escribe la URL del video…"
              type="url"
              value={urlInput}
            />
          </div>
          <Button
            className="btn-primary h-9 shrink-0"
            disabled={!urlInput.trim()}
            type="submit"
          >
            Reproducir
          </Button>
        </form>
      </div>
      <input
        accept="video/*"
        className="sr-only"
        onChange={(e) => loadFile(e.target.files?.[0])}
        ref={inputRef}
        type="file"
      />
      {error && <p className="text-center text-destructive text-xs">{error}</p>}
    </div>
  );
}
