"use client";

import { Popover, useContainer, useMedia } from "@videojs/react";
import { CaptionsIcon, CheckIcon, LanguagesIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { type MediaTrackOption, useMediaTracks } from "@/hooks/use-media-tracks";

type MenuId = "audio" | "subtitles";

interface TrackMenuProps {
  activeId: string | null;
  icon: React.ReactNode;
  label: string;
  /** When set, the menu offers a "turn it off" entry that selects `null`. */
  offLabel?: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string | null) => void;
  open: boolean;
  tracks: MediaTrackOption[];
}

function TrackMenu({
  activeId,
  icon,
  label,
  offLabel,
  onOpenChange,
  onSelect,
  open,
  tracks,
}: TrackMenuProps) {
  const titleId = useId();
  const options: Array<MediaTrackOption & { value: string | null }> =
    tracks.map((track) => ({ ...track, value: track.id }));
  if (offLabel) {
    options.unshift({ id: "__off", label: offLabel, value: null });
  }

  return (
    <Popover.Root onOpenChange={onOpenChange} open={open} side="top">
      <Popover.Trigger
        aria-label={label}
        className="media-button media-button--subtle media-button--icon"
      >
        {icon}
      </Popover.Trigger>
      <Popover.Popup className="media-surface media-popover stream-track-menu">
        <p className="stream-track-menu__title" id={titleId}>
          {label}
        </p>
        <div
          aria-labelledby={titleId}
          className="stream-track-menu__list"
          role="radiogroup"
        >
          {options.map((option) => (
            <button
              aria-checked={option.value === activeId}
              className="stream-track-menu__item"
              data-selected={option.value === activeId ? "" : undefined}
              key={option.id}
              onClick={() => {
                onSelect(option.value);
                onOpenChange(false);
              }}
              role="radio"
              type="button"
            >
              <CheckIcon className="stream-track-menu__check" />
              <span className="stream-track-menu__label">{option.label}</span>
            </button>
          ))}
        </div>
      </Popover.Popup>
    </Popover.Root>
  );
}

interface MediaTrackControlsProps {
  video: HTMLVideoElement | null;
}

// The skin's own control bar has no slot for extra buttons — `VideoSkin` is a
// sealed preset component, its JSX lives in @videojs/react, not here — so
// this is the only way to land audio/subtitle pickers inside the *same* row
// as the rest of the controls (sharing their exact spacing, hover styles, and
// idle show/hide behavior) instead of floating a second row above it.
const CONTROLS_BAR_GROUP_SELECTOR = ".media-controls .media-button-group:last-child";

/**
 * Audio-language and subtitle pickers for the tracks embedded in the media.
 *
 * Portals its buttons into the default skin's own last button group (the one
 * holding playback-rate/volume/captions/pip/fullscreen), found via
 * `useContainer()` + `querySelector`. Renders nothing — and portals nothing —
 * when the media has no tracks to choose between, which is the common case
 * for progressive MP4 in Chromium: only HLS (via hls.js) and natively
 * multi-track sources expose an audio list.
 */
export function MediaTrackControls({ video }: MediaTrackControlsProps) {
  const container = useContainer();
  const media = useMedia();
  const {
    activeAudioId,
    activeSubtitleId,
    audioTracks,
    selectAudio,
    selectSubtitle,
    subtitleTracks,
  } = useMediaTracks(video, media);
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [barGroup, setBarGroup] = useState<Element | null>(null);

  // The bar mounts in the same commit as `container`, so this usually finds
  // it immediately; the observer is only a safety net for whatever render
  // order variance the packaged skin might introduce across versions.
  useEffect(() => {
    if (!container) {
      setBarGroup(null);
      return;
    }
    const find = () =>
      container.querySelector(CONTROLS_BAR_GROUP_SELECTOR) ?? null;
    const found = find();
    if (found) {
      setBarGroup(found);
      return;
    }
    const observer = new MutationObserver(() => {
      const nowFound = find();
      if (nowFound) {
        setBarGroup(nowFound);
        observer.disconnect();
      }
    });
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [container]);

  // A popover full of subtitle languages can take a moment to read. The
  // skin's own idle timer only resets on real pointer activity over the
  // *container*, and a `position: fixed` popup sitting still while open
  // wouldn't generate any — so simulate that activity for as long as a menu
  // stays open, keeping the whole bar (ours now lives inside it) visible.
  useEffect(() => {
    if (!(openMenu && container)) {
      return;
    }
    const nudge = () => container.dispatchEvent(new PointerEvent("pointermove"));
    nudge();
    const interval = setInterval(nudge, 1000);
    return () => clearInterval(interval);
  }, [openMenu, container]);

  const showAudio = audioTracks.length > 1;
  const showSubtitles = subtitleTracks.length > 0;
  if (!(barGroup && (showAudio || showSubtitles))) {
    return null;
  }

  // Functional update so an "open B" that lands before "close A" isn't undone.
  const toggleMenu = (id: MenuId) => (isOpen: boolean) =>
    setOpenMenu((prev) => {
      if (isOpen) {
        return id;
      }
      return prev === id ? null : prev;
    });

  return createPortal(
    <>
      {showAudio && (
        <TrackMenu
          activeId={activeAudioId}
          icon={<LanguagesIcon className="media-icon" />}
          label="Idioma del audio"
          onOpenChange={toggleMenu("audio")}
          onSelect={(id) => id && selectAudio(id)}
          open={openMenu === "audio"}
          tracks={audioTracks}
        />
      )}
      {showSubtitles && (
        <TrackMenu
          activeId={activeSubtitleId}
          icon={<CaptionsIcon className="media-icon" />}
          label="Subtítulos"
          offLabel="Desactivados"
          onOpenChange={toggleMenu("subtitles")}
          onSelect={selectSubtitle}
          open={openMenu === "subtitles"}
          tracks={subtitleTracks}
        />
      )}
    </>,
    barGroup
  );
}

export default MediaTrackControls;
