"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
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
  CopyIcon,
  MessageCircleIcon,
  MicIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  RefreshCwIcon,
  ReplyIcon,
  SendIcon,
  SmilePlusIcon,
  StopCircleIcon,
  TerminalIcon,
  UserMinusIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { OneVidProfileAvatar } from "@/components/stream/onevid-profile-avatar";
import { useTranslation } from "@/lib/onevid-i18n-context";
import { MESSAGE_REACTIONS } from "@/lib/watch-party-reactions";
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

/** Etiqueta del separador de día: Hoy / Ayer / "lun, 28 sep". */
function formatDayLabel(iso: string, todayLabel: string, yesterdayLabel: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round(
    (startOfDay(new Date()) - startOfDay(date)) / (24 * 60 * 60 * 1000)
  );
  if (days === 0) {
    return todayLabel;
  }
  if (days === 1) {
    return yesterdayLabel;
  }
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
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
  contentLogo,
  contentPoster,
  contentTitle,
  error,
  hostId,
  isHost,
  join,
  members,
  messages,
  onEnd,
  onKick,
  onLeave,
  onReaction,
  onRequestSync,
  onPreviewGif,
  onSend,
  onSendFile,
  onSendGif,
  onSendVoice,
  onTogglePin,
  onToggleReaction,
  ready,
  sending,
  syncStatus,
}: {
  busy: "leave" | "end" | null;
  contentLogo?: string;
  contentPoster?: string;
  contentTitle?: string;
  error: string | null;
  hostId: string;
  isHost: boolean;
  join: WatchJoinData;
  members: WatchMember[];
  messages: WatchChatMessage[];
  onEnd: () => void;
  /** Solo lo usa el host: saca a un participante de la sala. */
  onKick: (userId: string) => Promise<boolean>;
  onLeave: () => void;
  onReaction: (emoji: string) => void;
  onRequestSync: () => void;
  onPreviewGif: (query: string) => Promise<unknown[] | null>;
  onSend: (text: string, quotedMessageId?: string) => Promise<boolean>;
  onSendFile: (file: File) => Promise<boolean>;
  onSendGif: (attachments: unknown[]) => Promise<boolean>;
  onSendVoice: (blob: Blob, durationSec: number) => Promise<boolean>;
  /** Fija o desfija un mensaje en la sala. */
  onTogglePin: (messageId: string, pinned: boolean) => Promise<boolean>;
  /** Alterna una reacción del usuario en un mensaje concreto. */
  onToggleReaction: (
    messageId: string,
    emoji: string,
    alreadyReacted: boolean
  ) => Promise<boolean>;
  ready: boolean;
  sending: boolean;
  syncStatus: "synced" | "drifting";
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"end" | "leave" | null>(
    null
  );
  const [gifPreview, setGifPreview] = useState<{
    attachments: unknown[];
    query: string;
  } | null>(null);
  const [filePreview, setFilePreview] = useState<{
    file: File;
    url: string | null;
  } | null>(null);
  // Mensaje al que se está respondiendo (cita); se limpia al enviar.
  const [replyTo, setReplyTo] = useState<WatchChatMessage | null>(null);
  const [kickTarget, setKickTarget] = useState<WatchMember | null>(null);
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
    const node = listRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [gifPreview, messages]);

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
    const ok = await onSend(text, replyTo?.id);
    if (ok) {
      setReplyTo(null);
    } else {
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
  const syncLabel = synced
    ? t("Sincronizado con el host")
    : t("Desincronizado");

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <header className="flex items-center gap-2 px-2 py-2.5 sm:gap-3 sm:px-3 sm:py-3">
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
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    aria-label={t("Ver participantes")}
                    className="h-7 gap-1.5 rounded-full px-2 text-xs"
                    data-dpad-focusable
                    size="sm"
                    variant="ghost"
                  >
                    {t("Personas")}
                    <Badge
                      className="h-5 bg-background/40 px-1.5 text-[10px]"
                      variant="secondary"
                    >
                      {members.length}
                    </Badge>
                  </Button>
                }
              />
              <PopoverContent align="start" className="w-64 p-1" side="bottom">
                {members.length === 0 ? (
            <p className="px-2 py-6 text-center text-muted-foreground text-sm">
              {t("Conectando con los participantes…")}
            </p>
          ) : (
            <ul className="max-h-64 space-y-0.5 overflow-y-auto overscroll-contain">
              {members.map((member) => (
                <li
                  className="group/row flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-muted/50"
                  key={member.userId}
                >
                  <MemberAvatar
                    avatar={member.avatar}
                    image={member.image}
                    name={member.name}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate font-medium text-sm max-[1100px]:text-xs">
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
                  {/* Conectado: siempre visible. El menú de acciones ocupa su
                      hueco fijo y solo se pinta al pasar por la fila (o al
                      enfocar con el teclado), así no desplaza nada. */}
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      // `null` = la app de Stream no expone presencia: no
                      // pintamos un estado que no sabemos.
                      member.online === false
                        ? "bg-muted-foreground/40"
                        : member.online
                          ? "bg-emerald-400"
                          : "bg-muted-foreground/25"
                    )}
                    title={
                      member.online === false
                        ? t("Desconectado")
                        : t("Conectado")
                    }
                  />
                  {isHost && member.userId !== hostId ? (
                    <div className="flex w-7 shrink-0 justify-center opacity-0 transition-opacity [@media(hover:none)]:opacity-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <button
                              aria-label={t("Acciones del participante")}
                              className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                              type="button"
                            />
                          }
                        >
                          <MoreHorizontalIcon className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => setKickTarget(member)}
                            variant="destructive"
                          >
                            <UserMinusIcon className="size-4" />
                            {t("Sacar de la sala")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
              </PopoverContent>
            </Popover>
            {isHost ? null : (
              <Badge className="gap-1.5 font-normal" variant="outline">
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full",
                    synced ? "bg-emerald-400" : "bg-amber-400"
                  )}
                />
                {syncLabel}
              </Badge>
            )}
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

      <div className="flex min-h-0 flex-1 flex-col">
          <div
            aria-live="polite"
            aria-relevant="additions"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2 sm:px-3 sm:pb-3"
            ref={listRef}
            role="log"
          >
            {/* Los mensajes empiezan arriba (con aire, no pegados al borde) y
                bajan en orden; el estado vacío ocupa el alto y se centra. */}
            <div className="flex min-h-full flex-col gap-3 pt-3">
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
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
                <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                  <MessageCircleIcon className="size-5 text-muted-foreground" />
                </div>
                <p className="font-medium text-sm max-[1100px]:text-xs">
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
            {messages.map((message, index) => {
              const day = new Date(message.createdAt).toDateString();
              const previous = messages[index - 1];
              const showDay =
                !previous ||
                new Date(previous.createdAt).toDateString() !== day;
              const own = message.userId === join.userId;
              const authorAvatar =
                message.avatar ??
                members.find((member) => member.userId === message.userId)
                  ?.avatar ??
                null;
              const hasReacted = (emoji: string) =>
                message.reactions.some(
                  (reaction) => reaction.emoji === emoji && reaction.mine
                );
              // Los chips van dentro de la burbuja (montados en su borde de
              // arriba) para que queden en su esquina y no se salgan hacia los
              // botones de acciones, que van al otro lado.
              const reactionChips =
                message.reactions.length > 0 ? (
                      <div
                        className={cn(
                          // Pegadas al borde de arriba de la burbuja, del lado
                          // del mensaje: derecha en los tuyos, izquierda en los
                          // ajenos.
                          "absolute -top-3.5 z-10 flex max-w-[85%] flex-wrap gap-1",
                          own ? "right-2 justify-end" : "left-2"
                        )}
                      >
                        {message.reactions.map((reaction) => {
                          const mine = reaction.mine;
                          return (
                            <button
                              aria-pressed={mine}
                              className={cn(
                                // Fondo sólido: el chip se monta sobre el
                                // borde de la burbuja y con transparencia se
                                // mezclaba con el azul de los mensajes propios.
                                "flex items-center gap-1 rounded-full border bg-card px-1.5 py-0.5 text-[11px] shadow-sm transition-colors",
                                mine
                                  ? "border-primary/70 text-foreground"
                                  : "border-border/70 text-muted-foreground hover:bg-muted"
                              )}
                              key={reaction.emoji}
                              onClick={() =>
                                void onToggleReaction(
                                  message.id,
                                  reaction.emoji,
                                  mine
                                )
                              }
                              type="button"
                            >
                              <span>{reaction.emoji}</span>
                              <span className="tabular-nums">
                                {reaction.count}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null;
              return (
                <Fragment key={message.id}>
                {showDay ? (
                  <div className="flex justify-center py-1">
                    <span className="rounded-full bg-muted/70 px-2.5 py-1 font-medium text-[11px] text-muted-foreground">
                      {formatDayLabel(
                        message.createdAt,
                        t("Hoy"),
                        t("Ayer")
                      )}
                    </span>
                  </div>
                ) : null}
                <div
                  className={cn(
                    "group/msg flex gap-2",
                    own ? "flex-row-reverse" : "flex-row"
                  )}
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
                    <div
                      className={cn(
                        "flex flex-col gap-1.5",
                        own ? "items-end" : "items-start"
                      )}
                    >
                    {/* Acciones al lado de la burbuja: solo reaccionar y
                        responder. En táctil se ven siempre; con ratón,
                        aparecen al pasar por encima del mensaje. */}
                    {/* Cada mensaje en su lado, con las acciones hacia el
                        centro: los tuyos a la derecha (iconos a la izquierda) y
                        los ajenos a la izquierda (iconos a la derecha). */}
                    <div
                      className={cn(
                        "flex items-end gap-1",
                        own ? "flex-row" : "flex-row-reverse"
                      )}
                    >
                      <div className="flex items-center gap-0.5 pb-1 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus-within:opacity-100 [@media(hover:hover)]:group-hover/msg:opacity-100">
                        <Popover>
                          <PopoverTrigger
                            render={
                              <button
                                aria-label={t("Reaccionar al mensaje")}
                                className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                data-dpad-focusable
                                disabled={!ready || sending}
                                type="button"
                              />
                            }
                          >
                            <SmilePlusIcon className="size-3.5" />
                          </PopoverTrigger>
                          <PopoverContent
                            align="center"
                            className="w-auto p-1"
                            side="top"
                          >
                            <div className="flex items-center gap-0.5">
                              {MESSAGE_REACTIONS.map(({ emoji, label }) => (
                                <button
                                  aria-label={t("Reaccionar {{emoji}}", {
                                    emoji,
                                  })}
                                  aria-pressed={hasReacted(emoji)}
                                  className={cn(
                                    "rounded-full px-1.5 py-1 text-base transition-transform hover:scale-110 hover:bg-muted",
                                    hasReacted(emoji) && "bg-muted"
                                  )}
                                  key={emoji}
                                  title={label}
                                  onClick={() =>
                                    void onToggleReaction(
                                      message.id,
                                      emoji,
                                      hasReacted(emoji)
                                    )
                                  }
                                  type="button"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <button
                                aria-label={t("Acciones del mensaje")}
                                className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                data-dpad-focusable
                                type="button"
                              />
                            }
                          >
                            <MoreHorizontalIcon className="size-3.5" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align={own ? "end" : "start"}
                            side="top"
                          >
                            <DropdownMenuItem
                              onClick={() => {
                                setReplyTo(message);
                                requestAnimationFrame(() =>
                                  inputRef.current?.focus()
                                );
                              }}
                            >
                              <ReplyIcon className="size-4" />
                              {t("Responder")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                void onTogglePin(
                                  message.id,
                                  message.pinned
                                ).then((ok) => {
                                  if (!ok) {
                                    toast.error(
                                      t("No se pudo fijar el mensaje.")
                                    );
                                  }
                                });
                              }}
                            >
                              {message.pinned ? (
                                <PinOffIcon className="size-4" />
                              ) : (
                                <PinIcon className="size-4" />
                              )}
                              {message.pinned
                                ? t("Desfijar mensaje")
                                : t("Fijar mensaje")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                void navigator.clipboard
                                  .writeText(message.text)
                                  .then(() =>
                                    toast.success(t("Mensaje copiado."))
                                  )
                                  .catch(() =>
                                    toast.error(t("No se pudo copiar."))
                                  );
                              }}
                            >
                              <CopyIcon className="size-4" />
                              {t("Copiar mensaje")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {message.text || message.quoted ? (
                        <div
                          className={cn(
                            "relative rounded-2xl px-3 py-2 text-sm max-[1100px]:text-[13px]",
                            own
                              ? "rounded-br-md bg-primary text-primary-foreground"
                              : "rounded-bl-md bg-muted text-foreground"
                          )}
                        >
                          {reactionChips}
                          {message.quoted ? (
                            <div
                              className={cn(
                                "mb-1 rounded-lg border-l-2 px-2 py-1",
                                own
                                  ? "border-primary-foreground/50 bg-black/15"
                                  : "border-primary/50 bg-background/50"
                              )}
                            >
                              <p className="truncate font-medium text-[11px]">
                                {message.quoted.userName}
                              </p>
                              <p className="line-clamp-2 text-[11px] opacity-80">
                                {message.quoted.text || t("Adjunto")}
                              </p>
                            </div>
                          ) : null}
                          {message.text ? (
                            <p className="whitespace-pre-wrap break-words">
                              {message.text}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {message.text || message.quoted ? null : reactionChips}
                    {message.attachments.map((attachment, index) => (
                      <MessageAttachment
                        attachment={attachment}
                        key={`${message.id}-${index}`}
                      />
                    ))}
                    </div>
                    <p className="flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
                      {message.pinned ? (
                        <>
                          <PinIcon className="size-3" />
                          {t("Fijado")}
                        </>
                      ) : null}
                      <span>{formatTime(message.createdAt)}</span>
                    </p>
                  </div>
                </div>
                </Fragment>
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
          </div>

          <Separator />

          <div className="flex flex-nowrap items-center justify-between gap-0.5 px-1 py-2 sm:gap-1 sm:px-2">
            {REACTIONS.map((emoji) => (
              <button
                aria-label={t("Reaccionar {{emoji}}", { emoji })}
                className="rounded-full px-1 py-1 text-base transition-transform hover:scale-110 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:text-lg"
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
                      className="size-9 shrink-0 rounded-full bg-white/10 text-white hover:bg-white/20 [@media(min-width:768px)_and_(min-height:600px)]:size-11"
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

              <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-3xl bg-white/10 p-1 [@media(min-width:768px)_and_(min-height:600px)]:p-1.5">
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
                {replyTo ? (
                  <div className="mt-1 ml-1 flex items-center gap-2 rounded-xl bg-black/25 px-2 py-1.5">
                    <ReplyIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-[11px]">
                        {replyTo.userName}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {replyTo.text ||
                          (replyTo.attachments.length > 0
                            ? t("Adjunto")
                            : t("Mensaje"))}
                      </p>
                    </div>
                    <button
                      aria-label={t("Cancelar respuesta")}
                      className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                      onClick={() => setReplyTo(null)}
                      type="button"
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  </div>
                ) : null}
                <div className="flex h-7 items-center gap-0.5 px-0.5 [@media(min-width:768px)_and_(min-height:600px)]:h-8">
                <Input
                  aria-label={t("Mensaje")}
                  className="h-7 min-w-0 flex-1 border-0 bg-transparent px-2 text-sm shadow-none focus-visible:border-0 focus-visible:ring-0 max-[1100px]:text-[13px] [@media(min-width:768px)_and_(min-height:600px)]:h-8 dark:bg-transparent"
                  data-dpad-focusable
                  maxLength={500}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={t("Mensaje…")}
                  ref={inputRef}
                  value={draft}
                />

                <Popover onOpenChange={setEmojiOpen} open={emojiOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        aria-label={t("Emojis")}
                        className="size-7 shrink-0 [@media(min-width:768px)_and_(min-height:600px)]:size-8"
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
                        className="size-7 shrink-0 [@media(min-width:768px)_and_(min-height:600px)]:size-8"
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
                    className="size-7 shrink-0 rounded-full [@media(min-width:768px)_and_(min-height:600px)]:size-8"
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
      </div>

      <Separator />

      <footer className="space-y-2 p-2 sm:p-3">
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
              className="flex-1 gap-1.5 max-[1100px]:text-xs"
              data-dpad-focusable
              disabled={busy !== null}
              onClick={() => setConfirmAction("end")}
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
            className="flex-1 gap-1.5 max-[1100px]:text-xs"
            data-dpad-focusable
            disabled={busy !== null}
            onClick={() => setConfirmAction("leave")}
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

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setConfirmAction(null);
          }
        }}
        open={confirmAction !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader className="place-items-center text-center sm:group-data-[size=default]/alert-dialog-content:place-items-center sm:group-data-[size=default]/alert-dialog-content:text-center">
            {contentLogo ? (
              // biome-ignore lint/performance/noImgElement: logo externo de TMDB
              <img
                alt={contentTitle ?? ""}
                className="mx-auto mb-1 max-h-14 max-w-56 object-contain"
                src={contentLogo}
              />
            ) : contentPoster ? (
              // biome-ignore lint/performance/noImgElement: póster externo de TMDB
              <img
                alt={contentTitle ?? ""}
                className="mx-auto mb-1 h-20 w-14 rounded-xl object-cover shadow-lg"
                src={contentPoster}
              />
            ) : null}
            <AlertDialogTitle>
              {confirmAction === "end"
                ? t("¿Terminar la watch party?")
                : t("¿Salir de la watch party?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "end"
                ? t("Se cerrará para todos y se borrará el chat.")
                : t("Dejarás de ver y chatear con el grupo.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={() => {
                const action = confirmAction;
                setConfirmAction(null);
                if (action === "end") {
                  onEnd();
                } else if (action === "leave") {
                  onLeave();
                }
              }}
              variant={confirmAction === "end" ? "destructive" : "default"}
            >
              {confirmAction === "end"
                ? t("Sí, terminar")
                : t("Sí, salir")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setKickTarget(null);
          }
        }}
        open={kickTarget !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader className="place-items-center text-center sm:group-data-[size=default]/alert-dialog-content:place-items-center sm:group-data-[size=default]/alert-dialog-content:text-center">
            <AlertDialogTitle>
              {t("¿Sacar a {{name}}?", { name: kickTarget?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Saldrá de la sala y no podrá volver a esta watch party."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = kickTarget;
                setKickTarget(null);
                if (!target) {
                  return;
                }
                void onKick(target.userId).then((ok) => {
                  if (!ok) {
                    toast.error(t("No se pudo sacar al usuario."));
                  }
                });
              }}
              variant="destructive"
            >
              {t("Sí, sacar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
