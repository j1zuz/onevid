"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Key under which OneVidProfileProvider persists the active profile id.
const PROFILE_STORAGE_KEY = "onevid-active-profile";
const SAVE_INTERVAL_MS = 10_000; // throttle server writes to every 10 s
const MIN_SEC = 30; // don't track accidental starts (mirrors server)

type MediaType = "movie" | "series";

interface WatchProgressParams {
  background?: string;
  episode?: number;
  mediaId: string;
  mediaType: MediaType;
  name?: string;
  poster?: string;
  season?: number;
  year?: string;
}

interface Resume {
  durationSec: number;
  positionSec: number;
}

function readProfileId(): string | null {
  try {
    return localStorage.getItem(PROFILE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Server-synced "Continue watching" progress, keyed by TMDB mediaId (+ season/
 * episode) so a title resumes across web, mobile and TV. Saves every 10 s while
 * playing (and on tab-hide / unmount), and reports completion on `onEnded` so
 * the server drops the title from the row.
 *
 * Missing/invalid profile (409) is treated as a silent no-op — playback is never
 * interrupted.
 */
export function useWatchProgress(params: WatchProgressParams) {
  const { mediaId, mediaType, season = 0, episode = 0 } = params;
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const [initialResume, setInitialResume] = useState<Resume | null>(null);
  const lastSavedAt = useRef(0);
  const latest = useRef({ position: 0, duration: 0 });

  // Fetch the saved position once per title/episode identity.
  useEffect(() => {
    if (!mediaId) {
      return;
    }
    const profileId = readProfileId();
    if (!profileId) {
      return;
    }
    const controller = new AbortController();
    const qs = new URLSearchParams({
      id: mediaId,
      type: mediaType,
      season: String(season),
      episode: String(episode),
    });
    fetch(`/api/onevid-progress?${qs.toString()}`, {
      headers: { "X-Profile-Id": profileId },
      signal: controller.signal,
    })
      .then((r) => (r.ok ? (r.json() as Promise<Resume>) : null))
      .then((data) => {
        if (data && typeof data.positionSec === "number") {
          setInitialResume(data);
        }
      })
      .catch(() => {
        /* no profile / offline — resume unavailable, ignore */
      });
    return () => controller.abort();
  }, [mediaId, mediaType, season, episode]);

  const post = useCallback((positionSec: number, durationSec: number) => {
    const profileId = readProfileId();
    if (!profileId) {
      return;
    }
    const p = paramsRef.current;
    try {
      fetch("/api/onevid-progress", {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          "X-Profile-Id": profileId,
        },
        body: JSON.stringify({
          mediaId: p.mediaId,
          mediaType: p.mediaType,
          season: p.season ?? 0,
          episode: p.episode ?? 0,
          positionSec: Math.floor(positionSec),
          durationSec: Math.floor(durationSec),
          name: p.name,
          poster: p.poster,
          background: p.background,
          year: p.year,
        }),
      }).catch(() => {
        /* fire-and-forget */
      });
    } catch {
      /* ignore */
    }
  }, []);

  const flush = useCallback(() => {
    const { position, duration } = latest.current;
    if (position < MIN_SEC) {
      return;
    }
    post(position, duration);
  }, [post]);

  const onTimeUpdate = useCallback(
    (currentSec: number, durationSec: number) => {
      latest.current = { position: currentSec, duration: durationSec };
      const now = Date.now();
      if (now - lastSavedAt.current < SAVE_INTERVAL_MS) {
        return;
      }
      lastSavedAt.current = now;
      if (currentSec >= MIN_SEC) {
        post(currentSec, durationSec);
      }
    },
    [post]
  );

  const onEnded = useCallback(() => {
    const { duration } = latest.current;
    if (duration > 0) {
      // position === duration → server sees it as finished and drops the row.
      post(duration, duration);
    }
  }, [post]);

  // Flush on tab-hide and unmount so we don't lose the last <10 s.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        flush();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  return { onTimeUpdate, onEnded, flush, initialResume };
}
