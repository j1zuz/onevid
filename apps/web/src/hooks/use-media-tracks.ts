"use client";

import { useCallback, useEffect, useState } from "react";

export interface MediaTrackOption {
  id: string;
  label: string;
}

export interface MediaTracks {
  activeAudioId: string | null;
  /** `null` means subtitles are turned off. */
  activeSubtitleId: string | null;
  audioTracks: MediaTrackOption[];
  selectAudio: (id: string) => void;
  selectSubtitle: (id: string | null) => void;
  subtitleTracks: MediaTrackOption[];
}

// hls.js event names. They're plain strings in `Hls.Events`, so we can listen
// without importing hls.js itself (the app never depends on it directly —
// @videojs/react pulls it in and only hands us the live instance).
const HLS_AUDIO_TRACKS_UPDATED = "hlsAudioTracksUpdated";
const HLS_AUDIO_TRACK_SWITCHED = "hlsAudioTrackSwitched";

interface HlsAudioTrack {
  lang?: string;
  name?: string;
}

interface HlsEngine {
  audioTrack: number;
  audioTracks: HlsAudioTrack[];
  off: (event: string, listener: () => void) => void;
  on: (event: string, listener: () => void) => void;
}

/** `HTMLMediaElement.audioTracks` is missing from lib.dom, so model it here. */
interface NativeAudioTrack {
  enabled: boolean;
  label: string;
  language: string;
}

interface NativeAudioTrackList extends EventTarget {
  readonly length: number;
  [index: number]: NativeAudioTrack;
}

function getNativeAudioTracks(
  video: HTMLVideoElement | null
): NativeAudioTrackList | null {
  const list = (video as unknown as { audioTracks?: NativeAudioTrackList })
    ?.audioTracks;
  return list && typeof list.length === "number" ? list : null;
}

/**
 * The hls.js instance driving MSE playback, when there is one. `@videojs/react`
 * exposes it on the media API object as `engine`; it only exists once a source
 * has started loading, which is why callers re-read it on `loadstart`.
 */
function getHlsEngine(media: unknown): HlsEngine | null {
  const engine = (media as { engine?: unknown } | null)?.engine;
  return engine && typeof (engine as HlsEngine).on === "function"
    ? (engine as HlsEngine)
    : null;
}

// `Intl.DisplayNames` construction is expensive and `languageName` runs once
// per track on every track-list sync, so build it once, lazily.
let displayNames: Intl.DisplayNames | null | undefined;

function getDisplayNames(): Intl.DisplayNames | null {
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(["es"], { type: "language" });
    } catch {
      displayNames = null;
    }
  }
  return displayNames;
}

function languageName(code: string | undefined): string | null {
  // "und" es el código de "sin determinar" de los contenedores MP4/MKV, y
  // `Intl.DisplayNames` lo traduce a "root", que no le dice nada a nadie.
  if (!code || code === "und") {
    return null;
  }
  try {
    const name = getDisplayNames()?.of(code);
    if (!name || name.toLowerCase() === code.toLowerCase()) {
      return code.toUpperCase();
    }
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return code.toUpperCase();
  }
}

/**
 * Etiqueta legible de una pista. Se exporta para las pistas que no vienen del
 * navegador — las de mediabunny en la ruta MSE — y así se nombran igual que las
 * nativas y las de HLS.
 */
export function trackLabel(
  label: string | undefined,
  language: string | undefined,
  index: number,
  fallback: string
): string {
  const named = languageName(language);
  if (label && named && !label.toLowerCase().includes(named.toLowerCase())) {
    return `${named} · ${label}`;
  }
  return label || named || `${fallback} ${index + 1}`;
}

/**
 * Exposes the audio (language) and subtitle tracks the media itself carries, so
 * the player can offer a picker for each.
 *
 * Subtitles always come from `video.textTracks` — hls.js also surfaces its
 * `#EXT-X-MEDIA` subtitle renditions there. Audio has no single source: hls.js
 * owns the rendition list when playing HLS through MSE, while native playback
 * (Safari HLS, some progressive containers) exposes `video.audioTracks`.
 * Progressive MP4/WebM in Chromium has no audio-track API at all, so the list
 * comes back empty and the caller hides the control.
 */
export function useMediaTracks(
  video: HTMLVideoElement | null,
  media: unknown
): MediaTracks {
  const [subtitleTracks, setSubtitleTracks] = useState<MediaTrackOption[]>([]);
  const [activeSubtitleId, setActiveSubtitleId] = useState<string | null>(null);
  const [audioTracks, setAudioTracks] = useState<MediaTrackOption[]>([]);
  const [activeAudioId, setActiveAudioId] = useState<string | null>(null);

  useEffect(() => {
    if (!video) {
      setSubtitleTracks([]);
      setActiveSubtitleId(null);
      return;
    }

    const list = video.textTracks;
    const sync = () => {
      const next: MediaTrackOption[] = [];
      let active: string | null = null;
      for (let i = 0; i < list.length; i++) {
        const track = list[i];
        if (track.kind !== "subtitles" && track.kind !== "captions") {
          continue;
        }
        const id = String(i);
        next.push({
          id,
          label: trackLabel(
            track.label,
            track.language,
            next.length,
            "Subtítulos"
          ),
        });
        if (track.mode === "showing") {
          active = id;
        }
      }
      setSubtitleTracks(next);
      setActiveSubtitleId(active);
    };

    sync();
    const controller = new AbortController();
    const { signal } = controller;
    list.addEventListener("addtrack", sync, { signal });
    list.addEventListener("removetrack", sync, { signal });
    list.addEventListener("change", sync, { signal });
    video.addEventListener("loadedmetadata", sync, { signal });
    return () => controller.abort();
  }, [video]);

  useEffect(() => {
    if (!video) {
      setAudioTracks([]);
      setActiveAudioId(null);
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    let engine: HlsEngine | null = null;

    const sync = () => {
      // The engine appears (and is replaced) as sources load, so re-resolve it
      // on every sync and move our listeners along with it.
      const nextEngine = getHlsEngine(media);
      if (nextEngine !== engine) {
        engine?.off(HLS_AUDIO_TRACKS_UPDATED, sync);
        engine?.off(HLS_AUDIO_TRACK_SWITCHED, sync);
        engine = nextEngine;
        engine?.on(HLS_AUDIO_TRACKS_UPDATED, sync);
        engine?.on(HLS_AUDIO_TRACK_SWITCHED, sync);
      }

      if (engine) {
        setAudioTracks(
          engine.audioTracks.map((track, index) => ({
            id: String(index),
            label: trackLabel(track.name, track.lang, index, "Audio"),
          }))
        );
        setActiveAudioId(engine.audioTrack >= 0 ? String(engine.audioTrack) : null);
        return;
      }

      const list = getNativeAudioTracks(video);
      if (!list) {
        setAudioTracks([]);
        setActiveAudioId(null);
        return;
      }
      const next: MediaTrackOption[] = [];
      let active: string | null = null;
      for (let i = 0; i < list.length; i++) {
        const track = list[i];
        const id = String(i);
        next.push({
          id,
          label: trackLabel(track.label, track.language, i, "Audio"),
        });
        if (track.enabled) {
          active = id;
        }
      }
      setAudioTracks(next);
      setActiveAudioId(active);
    };

    sync();
    video.addEventListener("loadstart", sync, { signal });
    video.addEventListener("loadedmetadata", sync, { signal });
    const nativeList = getNativeAudioTracks(video);
    nativeList?.addEventListener("addtrack", sync, { signal });
    nativeList?.addEventListener("removetrack", sync, { signal });
    nativeList?.addEventListener("change", sync, { signal });

    return () => {
      controller.abort();
      engine?.off(HLS_AUDIO_TRACKS_UPDATED, sync);
      engine?.off(HLS_AUDIO_TRACK_SWITCHED, sync);
    };
  }, [video, media]);

  const selectSubtitle = useCallback(
    (id: string | null) => {
      if (!video) {
        return;
      }
      const list = video.textTracks;
      for (let i = 0; i < list.length; i++) {
        const track = list[i];
        if (track.kind !== "subtitles" && track.kind !== "captions") {
          continue;
        }
        track.mode = String(i) === id ? "showing" : "disabled";
      }
      setActiveSubtitleId(id);
    },
    [video]
  );

  const selectAudio = useCallback(
    (id: string) => {
      const engine = getHlsEngine(media);
      if (engine) {
        engine.audioTrack = Number(id);
        setActiveAudioId(id);
        return;
      }
      const list = getNativeAudioTracks(video);
      if (!list) {
        return;
      }
      // Enable the chosen track before disabling the rest: some browsers
      // require at least one `AudioTrack` to stay enabled at all times, so
      // disabling everything first can silently no-op the whole switch.
      const index = Number(id);
      if (list[index]) {
        list[index].enabled = true;
      }
      for (let i = 0; i < list.length; i++) {
        if (String(i) !== id) {
          list[i].enabled = false;
        }
      }
      setActiveAudioId(id);
    },
    [media, video]
  );

  return {
    activeAudioId,
    activeSubtitleId,
    audioTracks,
    selectAudio,
    selectSubtitle,
    subtitleTracks,
  };
}
