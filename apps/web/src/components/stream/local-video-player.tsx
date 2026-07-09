"use client";

import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { FilmIcon, GlobeIcon, RotateCcwIcon } from "lucide-react";
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
  const isLive = activeMime === "application/x-mpegURL";
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
          ) : null}
          {isLive && activeSrc && (
            <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 backdrop-blur">
              <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
              <span className="font-semibold text-[10px] text-white tracking-wide">
                EN VIVO
              </span>
            </div>
          )}
          {!activeSrc && (
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
          "flex aspect-video flex-col items-center justify-center rounded-xl border border-dashed bg-repeat px-6 py-8 text-center transition-colors [background-size:48px_48px]",
          dragging ? "border-primary bg-primary/5" : "border-border"
        )}
        style={{ backgroundImage: "url(/pattern-tile.svg)" }}
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
      <div className="relative flex w-full max-w-md flex-col items-center gap-4 rounded-xl bg-popover/70 p-6 ring-1 ring-foreground/10 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150">
        <button
          className="flex w-full cursor-pointer flex-col items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted/40"
          onClick={() => inputRef.current?.click()}
          type="button"
        >
          <span className="flex size-12 items-center justify-center rounded-xl bg-muted text-foreground">
            <svg
              className="size-6"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <title>Subir video</title>
              <g className="nc-icon-wrapper" fill="none">
                <path
                  clipRule="evenodd"
                  d="M3.0665 9.35256C3.62627 5.24736 7.20427 2 11.5 2C15.7459 2 19.1859 5.0787 19.8907 9.07982C22.2211 9.50238 24 11.5515 24 14C24 16.7523 21.7523 19 19 19H5C2.24772 19 0 16.7523 0 14C0 11.9104 1.26852 10.0904 3.0665 9.35256Z"
                  data-glass="origin"
                  fill="url(#cloud-upload-gradient-0)"
                  fillRule="evenodd"
                  mask="url(#cloud-upload-mask)"
                />
                <path
                  clipPath="url(#cloud-upload-clip)"
                  clipRule="evenodd"
                  d="M3.0665 9.35256C3.62627 5.24736 7.20427 2 11.5 2C15.7459 2 19.1859 5.0787 19.8907 9.07982C22.2211 9.50238 24 11.5515 24 14C24 16.7523 21.7523 19 19 19H5C2.24772 19 0 16.7523 0 14C0 11.9104 1.26852 10.0904 3.0665 9.35256Z"
                  data-glass="clone"
                  fill="url(#cloud-upload-gradient-0)"
                  fillRule="evenodd"
                  filter="url(#cloud-upload-blur)"
                />
                <path
                  d="M16.8791 16L14 16.0001V20.5C14 21.3285 13.3284 22 12.5 22H11.5C10.6716 22 10 21.3285 10 20.5V16.0001L7.1209 16C5.86315 16 5.1639 14.5451 5.94961 13.563L10.8287 7.46413C11.4292 6.71352 12.5708 6.71352 13.1713 7.46413L18.0504 13.563C18.8361 14.5451 18.1368 16 16.8791 16Z"
                  data-glass="blur"
                  fill="url(#cloud-upload-gradient-1)"
                />
                <path
                  d="M9.99989 20.25V16H7.12098V15.25H10.7499V20.25C10.7499 20.8023 11.1976 21.25 11.7499 21.25V22C10.7834 22 9.99989 21.2165 9.99989 20.25ZM12.2499 21.25V22H11.7499V21.25H12.2499ZM13.2499 20.25V15.25H16.8788V16H13.9999V20.25C13.9999 21.2165 13.2164 22 12.2499 22V21.25C12.8022 21.25 13.2499 20.8023 13.2499 20.25ZM10.829 7.46384C11.4295 6.71371 12.5703 6.71371 13.1708 7.46384L18.0507 13.5635C18.8358 14.5456 18.1363 16 16.8788 16V15.25C17.5077 15.25 17.8576 14.5223 17.4647 14.0312L12.5858 7.93259C12.2856 7.55729 11.7142 7.55729 11.414 7.93259L6.53504 14.0312C6.14219 14.5223 6.4921 15.25 7.12098 15.25V16L7.00477 15.9961C5.82086 15.91 5.1879 14.514 5.94911 13.5625L10.829 7.46384Z"
                  fill="url(#cloud-upload-gradient-2)"
                />
                <defs>
                  <linearGradient
                    gradientUnits="userSpaceOnUse"
                    id="cloud-upload-gradient-0"
                    x1="12"
                    x2="12"
                    y1="2"
                    y2="19"
                  >
                    <stop stopColor="rgba(87, 87, 87, 1)" />
                    <stop offset="1" stopColor="rgba(21, 21, 21, 1)" />
                  </linearGradient>
                  <linearGradient
                    gradientUnits="userSpaceOnUse"
                    id="cloud-upload-gradient-1"
                    x1="12"
                    x2="12"
                    y1="6"
                    y2="22"
                  >
                    <stop stopColor="rgba(227, 227, 229, 0.6)" />
                    <stop offset="1" stopColor="rgba(187, 187, 192, 0.6)" />
                  </linearGradient>
                  <linearGradient
                    gradientUnits="userSpaceOnUse"
                    id="cloud-upload-gradient-2"
                    x1="12"
                    x2="12"
                    y1="6.901"
                    y2="15.645"
                  >
                    <stop stopColor="rgba(255, 255, 255, 1)" />
                    <stop
                      offset="1"
                      stopColor="rgba(255, 255, 255, 1)"
                      stopOpacity="0"
                    />
                  </linearGradient>
                  <filter
                    filterUnits="objectBoundingBox"
                    height="400%"
                    id="cloud-upload-blur"
                    primitiveUnits="userSpaceOnUse"
                    width="400%"
                    x="-100%"
                    y="-100%"
                  >
                    <feGaussianBlur
                      edgeMode="none"
                      height="100%"
                      in="SourceGraphic"
                      result="blur"
                      stdDeviation="2"
                      width="100%"
                      x="0%"
                      y="0%"
                    />
                  </filter>
                  <clipPath id="cloud-upload-clip">
                    <path
                      d="M16.8791 16L14 16.0001V20.5C14 21.3285 13.3284 22 12.5 22H11.5C10.6716 22 10 21.3285 10 20.5V16.0001L7.1209 16C5.86315 16 5.1639 14.5451 5.94961 13.563L10.8287 7.46413C11.4292 6.71352 12.5708 6.71352 13.1713 7.46413L18.0504 13.563C18.8361 14.5451 18.1368 16 16.8791 16Z"
                      fill="url(#cloud-upload-gradient-1)"
                    />
                  </clipPath>
                  <mask id="cloud-upload-mask">
                    <rect fill="#FFF" height="100%" width="100%" />
                    <path
                      d="M16.8791 16L14 16.0001V20.5C14 21.3285 13.3284 22 12.5 22H11.5C10.6716 22 10 21.3285 10 20.5V16.0001L7.1209 16C5.86315 16 5.1639 14.5451 5.94961 13.563L10.8287 7.46413C11.4292 6.71352 12.5708 6.71352 13.1713 7.46413L18.0504 13.563C18.8361 14.5451 18.1368 16 16.8791 16Z"
                      fill="#000"
                    />
                  </mask>
                </defs>
              </g>
            </svg>
          </span>
          <span className="flex flex-col gap-1">
            <span className="font-medium text-sm">
              Sube un video para reproducir
            </span>
            <span className="text-muted-foreground text-xs">
              Arrastra un archivo aquí o haz clic para seleccionarlo.
            </span>
          </span>
        </button>

        <div className="flex w-full items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-muted-foreground text-xs">o</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <form
          className="flex w-full items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            loadUrl(urlInput);
          }}
        >
          <div className="relative flex-1">
            <GlobeIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-8"
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="URL de video o stream en vivo…"
              type="url"
              value={urlInput}
            />
          </div>
          <Button
            className="btn-primary h-8 shrink-0"
            disabled={!urlInput.trim()}
            size="sm"
            type="submit"
          >
            Reproducir
          </Button>
        </form>
      </div>
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
