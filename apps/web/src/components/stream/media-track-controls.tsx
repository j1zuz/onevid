"use client";

import { Controls, Popover, useMedia } from "@videojs/react";
import { CaptionsIcon, CheckIcon, LanguagesIcon } from "lucide-react";
import { useId, useState } from "react";
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
          role="menu"
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
              role="menuitemradio"
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

/**
 * Audio-language and subtitle pickers for the tracks embedded in the media.
 *
 * Rendered as its own `Controls.Root` — the default skin gives no slot inside
 * its control bar — so the cluster shares the skin's idle show/hide state and
 * sits just above that bar. It renders nothing when the media has no tracks to
 * choose between, which is the common case for progressive MP4 in Chromium:
 * only HLS (via hls.js) and natively multi-track sources expose an audio list.
 */
export function MediaTrackControls({ video }: MediaTrackControlsProps) {
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

  const showAudio = audioTracks.length > 1;
  const showSubtitles = subtitleTracks.length > 0;
  if (!(showAudio || showSubtitles)) {
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

  return (
    <Controls.Root
      className="media-surface stream-track-controls"
      // Keeps the cluster (and the cursor) alive while a menu is open, which
      // the skin's 2s idle timer would otherwise hide out from under the user.
      data-menu-open={openMenu ? "" : undefined}
    >
      <Controls.Group className="media-button-group">
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
      </Controls.Group>
    </Controls.Root>
  );
}

export default MediaTrackControls;
