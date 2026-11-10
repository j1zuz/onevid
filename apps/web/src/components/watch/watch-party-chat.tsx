"use client";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Separator } from "@workspace/ui/components/separator";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import emojiData from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import {
  ArrowUpIcon,
  EyeIcon,
  FileIcon,
  Link2Icon,
  LoaderIcon,
  LogOutIcon,
  MessageCircleIcon,
  MicIcon,
  PaperclipIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  SmilePlusIcon,
  StopCircleIcon,
  TerminalIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { OneVidProfileAvatar } from "@/components/stream/onevid-profile-avatar";
import { useTranslation } from "@/lib/onevid-i18n-context";
import type {
  WatchChatAttachment,
  WatchChatMessage,
  WatchJoinData,
  WatchMember,
} from "@/lib/watch-party-types";

const REACTIONS = ["❤️", "😂", "😮", "🔥", "😍", "😢", "😡", "👏"];

function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/** Avatar del perfil de onevid cuando existe; si no, la imagen de Stream. */
function MemberAvatar({
  avatar,
  image,
  name,
  className,
}: {
  avatar?: string | null;
  className?: string;
  image?: string | null;
  name: string;
}) {
  if (avatar) {
    return (
      <OneVidProfileAvatar
        avatar={avatar}
        className={cn("size-6 shrink-0", className)}
        name={name}
      />
    );
  }
  return (
    <Avatar className={className} size="sm">
      {image ? <AvatarImage alt="" src={image} /> : null}
      <AvatarFallback className="text-[10px]">
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Solo URLs http(s): los adjuntos vienen de otros usuarios/Stream y un
 * `javascript:` en un enlace sería XSS almacenado al hacer clic.
 */
function safeHttpUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function attachmentImageUrl(
  attachment: WatchChatAttachment
): string | null {
  return safeHttpUrl(
    attachment.giphy?.fixed_height?.url ??
      attachment.giphy?.downsized_medium?.url ??
      attachment.thumb_url ??
      attachment.image_url
  );
}

function MessageAttachment({
  attachment,
}: {
  attachment: WatchChatAttachment;
}) {
  const { t } = useTranslation();
  const assetUrl = safeHttpUrl(attachment.asset_url);
  const isAudio =
    attachment.type === "voice" ||
    attachment.type === "audio" ||
    Boolean(assetUrl && attachment.type.startsWith("audio"));

  if (isAudio && assetUrl) {
    return (
      <audio
        className="h-9 w-56 max-w-full"
        controls
        preload="metadata"
        src={assetUrl}
      />
    );
  }

  const image = attachmentImageUrl(attachment);
  if (image) {
    return (
      // biome-ignore lint/performance/noImgElement: GIF remoto de Giphy
      <img
        alt={attachment.title ?? "GIF"}
        className="max-h-56 w-full rounded-xl bg-black/20 object-contain"
        loading="lazy"
        src={image}
      />
    );
  }

  if (assetUrl) {
    return (
      <a
        className="text-xs underline"
        href={assetUrl}
        rel="noopener noreferrer"
        target="_blank"
      >
        {attachment.title ?? t("Abrir archivo")}
      </a>
    );
  }

  return null;
}

/**
 * Panel de chat de la watch party. Es puramente presentacional: la conexión y
 * el estado viven en `useWatchParty` (montado por `WatchPartyRoom`), y este
 * componente solo pinta el chat, las personas y las acciones de la sala.
 */
export function WatchPartyChat({
  busy,
  error,
  hostId,
  isHost,
  join,
  members,
  messages,
  onEnd,
  onLeave,
  onReaction,
  onRequestSync,
  onPreviewGif,
  onSend,
  onSendFile,
  onSendGif,
  onSendVoice,
  ready,
  sending,
  syncStatus,
}: {
  busy: "leave" | "end" | null;
  error: string | null;
  hostId: string;
  isHost: boolean;
  join: WatchJoinData;
  members: WatchMember[];
  messages: WatchChatMessage[];
  onEnd: () => void;
  onLeave: () => void;
  onReaction: (emoji: string) => void;
  onRequestSync: () => void;
  onPreviewGif: (query: string) => Promise<unknown[] | null>;
  onSend: (text: string) => Promise<boolean>;
  onSendFile: (file: File) => Promise<boolean>;
  onSendGif: (attachments: unknown[]) => Promise<boolean>;
  onSendVoice: (blob: Blob, durationSec: number) => Promise<boolean>;
  ready: boolean;
  sending: boolean;
  syncStatus: "synced" | "drifting";
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"chat" | "people">("chat");
  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [gifPreview, setGifPreview] = useState<{
    attachments: unknown[];
    query: string;
  } | null>(null);
  const [filePreview, setFilePreview] = useState<{
    file: File;
    url: string | null;
  } | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderTimerRef = useRef<number | null>(null);
  const recordStartedAtRef = useRef(0);
  const cancelRecordingRef = useRef(false);

  useEffect(() => {
    if (tab !== "chat") {
      return;
    }
    const node = listRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [gifPreview, messages, tab]);

  useEffect(
    () => () => {
      if (filePreview?.url) {
        URL.revokeObjectURL(filePreview.url);
      }
    },
    [filePreview]
  );

  useEffect(
    () => () => {
      cancelRecordingRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      if (recorderTimerRef.current !== null) {
        window.clearInterval(recorderTimerRef.current);
      }
      recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    },
    []
  );

  const clearRecorderTimer = () => {
    if (recorderTimerRef.current !== null) {
      window.clearInterval(recorderTimerRef.current);
      recorderTimerRef.current = null;
    }
  };

  const stopRecorderStream = () => {
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    recorderStreamRef.current = null;
  };

  const startRecording = async () => {
    if (recording || sending) {
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      recorderStreamRef.current = stream;
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
      ].find(
        (candidate) =>
          typeof MediaRecorder !== "undefined" &&
          MediaRecorder.isTypeSupported(candidate)
      );
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );
      recorderChunksRef.current = [];
      cancelRecordingRef.current = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recorderChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const cancelled = cancelRecordingRef.current;
        const duration = (Date.now() - recordStartedAtRef.current) / 1000;
        const blob = new Blob(recorderChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        clearRecorderTimer();
        stopRecorderStream();
        recorderRef.current = null;
        setRecording(false);
        setRecordSeconds(0);
        if (cancelled || blob.size === 0) {
          return;
        }
        void onSendVoice(blob, duration).then((ok) => {
          if (!ok) {
            toast.error(t("No se pudo enviar el audio."));
          }
        });
      };
      recorder.start();
      recorderRef.current = recorder;
      recordStartedAtRef.current = Date.now();
      setRecording(true);
      setRecordSeconds(0);
      recorderTimerRef.current = window.setInterval(() => {
        setRecordSeconds(
          Math.floor((Date.now() - recordStartedAtRef.current) / 1000)
        );
      }, 250);
    } catch {
      stopRecorderStream();
      toast.error(t("No se pudo acceder al micrófono."));
    }
  };

  const stopRecording = (cancel: boolean) => {
    cancelRecordingRef.current = cancel;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  const insertGiphyCommand = () => {
    setDraft((current) =>
      current.toLowerCase().startsWith("/giphy")
        ? current
        : `/giphy ${current}`
    );
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setFilePreview((current) => {
      if (current?.url) {
        URL.revokeObjectURL(current.url);
      }
      return {
        file,
        url: file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : null,
      };
    });
  };

  const handleShuffleGif = async () => {
    if (!gifPreview || sending) {
      return;
    }
    const attachments = await onPreviewGif(gifPreview.query);
    if (!attachments?.length) {
      toast.error(t("No se pudo cargar otro GIF."));
      return;
    }
    setGifPreview({ attachments, query: gifPreview.query });
  };

  const handleSendGifPreview = async () => {
    if (!gifPreview) {
      return;
    }
    const { attachments } = gifPreview;
    setGifPreview(null);
    const ok = await onSendGif(attachments);
    if (!ok) {
      toast.error(t("No se pudo enviar el GIF."));
    }
  };

  const handleEmojiSelect = (emoji: { native?: string }) => {
    if (emoji.native) {
      setDraft((current) => current + emoji.native);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending) {
      return;
    }
    if (filePreview) {
      const file = filePreview.file;
      setFilePreview(null);
      const ok = await onSendFile(file);
      if (!ok) {
        toast.error(t("No se pudo adjuntar el archivo."));
      }
      return;
    }
    const text = draft.trim();
    if (!text) {
      return;
    }
    const gif = text.match(/^\/giphy(?:\s+(.*))?$/i);
    if (gif) {
      const query = gif[1]?.trim();
      setDraft(query ? "" : "/giphy ");
      if (!query) {
        return;
      }
      const attachments = await onPreviewGif(query);
      if (!attachments?.length) {
        setDraft(text);
        toast.error(t("No se pudo cargar el GIF."));
        return;
      }
      setGifPreview({ attachments, query });
      return;
    }

    setDraft("");
    const ok = await onSend(text);
    if (!ok) {
      setDraft(text);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success(t("Link de la sala copiado."));
    } catch {
      toast.error(t("No se pudo copiar el link."));
    }
  };

  const gifPreviewImage = gifPreview
    ? attachmentImageUrl(gifPreview.attachments[0] as WatchChatAttachment)
    : null;

  const synced = syncStatus === "synced";
  const syncLabel = isHost
    ? t("Tú controlas la reproducción")
    : synced
      ? t("Sincronizado con el host")
      : t("Desincronizado");

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <header className="flex items-center gap-3 px-3 py-3">
        {members.length > 0 ? (
          <div className="flex shrink-0 -space-x-1.5">
            {members.slice(0, 3).map((member) => (
              <MemberAvatar
                avatar={member.avatar}
                className="ring-2 ring-background"
                image={member.image}
                key={member.userId}
                name={member.name}
              />
            ))}
            {members.length > 3 ? (
              <span className="flex size-6 items-center justify-center rounded-full bg-muted font-medium text-[10px] text-muted-foreground ring-2 ring-background">
                +{members.length - 3}
              </span>
            ) : null}
          </div>
        ) : (
          <Skeleton className="size-6 shrink-0 rounded-full" />
        )}

        {ready || error ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate font-medium text-sm">
              {t("{{count}} de {{max}}", {
                count: members.length,
                max: join.room.maxParticipants,
              })}
            </p>
            <Badge className="gap-1.5 font-normal" variant="outline">
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full",
                  isHost
                    ? "bg-primary"
                    : synced
                      ? "bg-emerald-400"
                      : "bg-amber-400"
                )}
              />
              {syncLabel}
            </Badge>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-5 w-32 rounded-full" />
          </div>
        )}

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={t("Copiar link de la sala")}
                data-dpad-focusable
                onClick={copyLink}
                size="icon-sm"
                variant="ghost"
              >
                <Link2Icon className="size-4" />
              </Button>
            }
          />
          <TooltipContent>{t("Copiar link")}</TooltipContent>
        </Tooltip>
      </header>

      <Separator />

      <Tabs
        className="flex min-h-0 flex-1 flex-col gap-0"
        onValueChange={(value) => setTab(value as "chat" | "people")}
        value={tab}
      >
        <div className="px-3 pt-3">
          <TabsList className="w-full">
            <TabsTrigger data-dpad-focusable value="chat">
              <MessageCircleIcon className="size-4" />
              {t("Chat")}
            </TabsTrigger>
            <TabsTrigger data-dpad-focusable value="people">
              <UsersIcon className="size-4" />
              {t("Personas")}
              <Badge
                className="h-5 bg-background/40 px-1.5 text-[10px]"
                variant="secondary"
              >
                {members.length}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent className="mt-3 flex min-h-0 flex-1 flex-col" value="chat">
          <div
            aria-live="polite"
            aria-relevant="additions"
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 pb-3"
            ref={listRef}
            role="log"
          >
            {!ready && !error ? (
              <div className="space-y-3 py-2">
                {[0, 1, 2].map((index) => (
                  <div
                    className={cn(
                      "flex gap-2",
                      index % 2 === 0 ? "flex-row" : "flex-row-reverse"
                    )}
                    key={index}
                  >
                    <Skeleton className="size-6 shrink-0 rounded-full" />
                    <div
                      className={cn(
                        "flex flex-col gap-1.5",
                        index % 2 === 0 ? "items-start" : "items-end"
                      )}
                    >
                      <Skeleton className="h-3 w-20" />
                      <Skeleton
                        className={cn(
                          "h-9",
                          index === 0
                            ? "w-48"
                            : index === 1
                              ? "w-56"
                              : "w-36"
                        )}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {error ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm">
                {error}
              </div>
            ) : null}
            {ready && messages.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                  <MessageCircleIcon className="size-5 text-muted-foreground" />
                </div>
                <p className="font-medium text-sm">
                  {t("Sé el primero en escribir")}
                </p>
                <p className="max-w-56 text-muted-foreground text-xs">
                  {t("El chat es solo para esta sala.")}
                </p>
                <p className="max-w-60 text-muted-foreground/80 text-xs">
                  {t("Escribe /giphy gatos para enviar un GIF.")}
                </p>
              </div>
            ) : null}
            {messages.map((message) => {
              const own = message.userId === join.userId;
              const authorAvatar =
                message.avatar ??
                members.find((member) => member.userId === message.userId)
                  ?.avatar ??
                null;
              return (
                <div
                  className={cn(
                    "flex gap-2",
                    own ? "flex-row-reverse" : "flex-row"
                  )}
                  key={message.id}
                >
                  {own ? null : (
                    <MemberAvatar
                      avatar={authorAvatar}
                      className="mt-0.5"
                      image={message.userImage}
                      name={message.userName}
                    />
                  )}
                  <div
                    className={cn(
                      "flex max-w-[82%] flex-col gap-1.5",
                      own ? "items-end" : "items-start"
                    )}
                  >
                    {own ? null : (
                      <p className="px-1 text-[11px] text-muted-foreground">
                        {message.userName}
                      </p>
                    )}
                    {message.text ? (
                      <div
                        className={cn(
                          "rounded-2xl px-3 py-2 text-sm",
                          own
                            ? "rounded-br-md bg-primary text-primary-foreground"
                            : "rounded-bl-md bg-muted text-foreground"
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">
                          {message.text}
                        </p>
                      </div>
                    ) : null}
                    {message.attachments.map((attachment, index) => (
                      <MessageAttachment
                        attachment={attachment}
                        key={`${message.id}-${index}`}
                      />
                    ))}
                    <p className="px-1 text-[10px] text-muted-foreground">
                      {formatTime(message.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })}

            {gifPreview ? (
              <div className="ml-auto flex w-full max-w-[82%] flex-col items-end gap-1">
                <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                  <p className="flex items-center gap-1.5 px-3 pt-2 text-[11px] text-muted-foreground">
                    <EyeIcon className="size-3" />
                    {t("Solo visible para ti")}
                  </p>
                  {gifPreviewImage ? (
                    // biome-ignore lint/performance/noImgElement: GIF remoto de Giphy
                    <img
                      alt={t("Vista previa del GIF")}
                      className="mt-1 max-h-56 w-full object-contain"
                      src={gifPreviewImage}
                    />
                  ) : null}
                  <div className="flex items-center justify-end gap-1 px-2 py-1.5">
                    <Button
                      className="btn-primary"
                      disabled={sending}
                      onClick={handleSendGifPreview}
                      size="sm"
                      type="button"
                    >
                      {t("Enviar")}
                    </Button>
                    <Button
                      disabled={sending}
                      onClick={handleShuffleGif}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {t("Barajar")}
                    </Button>
                    <Button
                      onClick={() => setGifPreview(null)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {t("Cancelar")}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <Separator />

          <div className="flex flex-nowrap items-center justify-between gap-1 px-2 py-2">
            {REACTIONS.map((emoji) => (
              <button
                aria-label={t("Reaccionar {{emoji}}", { emoji })}
                className="rounded-full px-2 py-1 text-lg transition-transform hover:scale-110 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-dpad-focusable
                key={emoji}
                onClick={() => onReaction(emoji)}
                type="button"
              >
                {emoji}
              </button>
            ))}
          </div>

          {recording ? (
            <div className="flex items-center gap-2 px-2 pb-3">
              <div className="flex h-10 flex-1 items-center gap-2 rounded-full bg-white/10 px-3">
                <span className="size-2 shrink-0 animate-pulse rounded-full bg-destructive" />
                <span className="tabular-nums text-sm">
                  {formatDuration(recordSeconds)}
                </span>
                <span className="flex-1 truncate text-muted-foreground text-xs">
                  {t("Grabando audio…")}
                </span>
                <Button
                  aria-label={t("Cancelar audio")}
                  data-dpad-focusable
                  onClick={() => stopRecording(true)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <XIcon className="size-4" />
                </Button>
                <Button
                  aria-label={t("Enviar audio")}
                  data-dpad-focusable
                  onClick={() => stopRecording(false)}
                  size="icon-sm"
                  type="button"
                >
                  <SendIcon className="size-4" />
                </Button>
              </div>
            </div>
          ) : (
            <form
              className="flex items-end gap-2 px-2 pb-3"
              onSubmit={handleSubmit}
            >
              <input
                className="hidden"
                onChange={handleFileChange}
                ref={fileInputRef}
                type="file"
              />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      aria-label={t("Adjuntar")}
                      className="size-11 shrink-0 rounded-full bg-white/10 text-white hover:bg-white/20"
                      data-dpad-focusable
                      disabled={!ready || sending}
                      size="icon"
                      type="button"
                      variant="secondary"
                    >
                      <PlusIcon className="size-4" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="start" className="w-56" side="top">
                  <DropdownMenuItem
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <PaperclipIcon className="size-4" />
                    {t("Archivo")}
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <TerminalIcon className="size-4" />
                      {t("Comandos")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem onClick={insertGiphyCommand}>
                        <span className="font-mono text-xs">/giphy</span>
                        <span className="text-muted-foreground text-xs">
                          {t("GIF aleatorio")}
                        </span>
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-3xl bg-white/10 p-1.5">
                {filePreview ? (
                  <div className="relative mt-1 ml-1 w-fit">
                    {filePreview.url ? (
                      // biome-ignore lint/performance/noImgElement: preview local del archivo
                      <img
                        alt={t("Vista previa del archivo")}
                        className="h-16 w-24 rounded-xl object-cover"
                        src={filePreview.url}
                      />
                    ) : (
                      <div className="flex h-12 max-w-44 items-center gap-2 rounded-xl bg-black/20 px-2">
                        <FileIcon className="size-4 shrink-0" />
                        <span className="truncate text-xs">
                          {filePreview.file.name}
                        </span>
                      </div>
                    )}
                    <button
                      aria-label={t("Quitar archivo")}
                      className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-background text-foreground shadow ring-1 ring-white/20"
                      onClick={() => setFilePreview(null)}
                      type="button"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </div>
                ) : null}
                <div className="flex h-8 items-center gap-0.5 px-0.5">
                <Input
                  aria-label={t("Mensaje")}
                  className="h-8 min-w-0 flex-1 border-0 bg-transparent px-2 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
                  data-dpad-focusable
                  maxLength={500}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={t("Escribe un mensaje…")}
                  ref={inputRef}
                  value={draft}
                />

                <Popover onOpenChange={setEmojiOpen} open={emojiOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        aria-label={t("Emojis")}
                        className="shrink-0"
                        data-dpad-focusable
                        disabled={!ready || sending}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <SmilePlusIcon className="size-4" />
                      </Button>
                    }
                  />
                  <PopoverContent
                    align="end"
                    className="w-[320px] max-w-[calc(100vw-2rem)] border-0 bg-transparent p-0 shadow-none [&_em-emoji-picker]:h-[340px] [&_em-emoji-picker]:w-[320px]"
                    side="top"
                  >
                    <Picker
                      data={emojiData}
                      onEmojiSelect={handleEmojiSelect}
                      perLine={8}
                      previewPosition="none"
                      skinTonePosition="none"
                      theme="dark"
                    />
                  </PopoverContent>
                </Popover>

                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label={t("Grabar audio")}
                        className="shrink-0"
                        data-dpad-focusable
                        disabled={!ready || sending}
                        onClick={startRecording}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <MicIcon className="size-4" />
                      </Button>
                    }
                  />
                  <TooltipContent>{t("Grabar audio")}</TooltipContent>
                </Tooltip>

                {draft.trim() || filePreview ? (
                  <Button
                    aria-label={t("Enviar")}
                    className="shrink-0 rounded-full"
                    data-dpad-focusable
                    disabled={sending}
                    size="icon-sm"
                    type="submit"
                  >
                    {sending ? (
                      <LoaderIcon className="size-4 animate-spin" />
                    ) : (
                      <ArrowUpIcon className="size-4" />
                    )}
                  </Button>
                ) : null}
                </div>
              </div>
            </form>
          )}
        </TabsContent>

        <TabsContent
          className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3"
          value="people"
        >
          {members.length === 0 ? (
            <p className="px-2 py-8 text-center text-muted-foreground text-sm">
              Conectando con los participantes…
            </p>
          ) : (
            <ul className="space-y-0.5">
              {members.map((member) => (
                <li
                  className="flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-muted/50"
                  key={member.userId}
                >
                  <MemberAvatar
                    avatar={member.avatar}
                    image={member.image}
                    name={member.name}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate font-medium text-sm">
                        {member.name}
                      </p>
                      {member.userId === hostId ? (
                        <Badge
                          className="h-5 border-blue-400/20 bg-blue-500/15 px-1.5 text-[10px] text-blue-300"
                          variant="secondary"
                        >
                          {t("Anfitrión")}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full bg-emerald-400"
                  />
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <Separator />

      <footer className="space-y-2 p-3">
        {isHost ? null : (
          <div className="flex justify-end">
            <Button
              className="h-7 gap-1 px-2 text-xs"
              data-dpad-focusable
              onClick={onRequestSync}
              size="sm"
              variant="ghost"
            >
              <RefreshCwIcon className="size-3" />
              {t("Resincronizar")}
            </Button>
          </div>
        )}
        <div className="flex gap-2">
          {isHost ? (
            <Button
              className="flex-1 gap-1.5"
              data-dpad-focusable
              disabled={busy !== null}
              onClick={onEnd}
              size="sm"
              variant="destructive"
            >
              {busy === "end" ? (
                <LoaderIcon className="size-4 animate-spin" />
              ) : (
                <StopCircleIcon className="size-4" />
              )}
              {t("Terminar")}
            </Button>
          ) : null}
          <Button
            className="flex-1 gap-1.5"
            data-dpad-focusable
            disabled={busy !== null}
            onClick={onLeave}
            size="sm"
            variant="secondary"
          >
            {busy === "leave" ? (
              <LoaderIcon className="size-4 animate-spin" />
            ) : (
              <LogOutIcon className="size-4" />
            )}
            {t("Salir")}
          </Button>
        </div>
      </footer>
    </div>
  );
}
