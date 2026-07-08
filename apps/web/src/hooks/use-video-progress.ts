"use client";

import { useCallback, useEffect, useRef } from "react";

const PREFIX = "onevid:progress:";
const SAVE_INTERVAL_MS = 5000; // save every 5 seconds

function storageKey(url: string) {
  // Use up to 200 chars of the URL as a stable key.
  return `${PREFIX}${url.slice(0, 200)}`;
}

/** Returns saved position (seconds) for a URL, or 0 if none. */
export function getSavedTime(url: string): number {
  try {
    return Number(localStorage.getItem(storageKey(url))) || 0;
  } catch {
    return 0;
  }
}

/**
 * Saves playback position to localStorage every 5 s while playing,
 * and removes the entry when the video ends.
 *
 * Returns a stable `onTimeUpdate` callback to pass to the player.
 */
export function useVideoProgress(originalUrl: string | null) {
  const lastSavedAt = useRef(0);
  const currentTimeRef = useRef(0);

  // Clear old entry if URL changes.
  useEffect(() => {
    if (!originalUrl) {
      return;
    }
    // Restore position so callers can read it synchronously via getSavedTime.
  }, [originalUrl]);

  const onTimeUpdate = useCallback(
    (currentTime: number) => {
      if (!originalUrl) {
        return;
      }
      currentTimeRef.current = currentTime;
      const now = Date.now();
      if (now - lastSavedAt.current < SAVE_INTERVAL_MS) {
        return;
      }
      lastSavedAt.current = now;
      try {
        if (currentTime > 10) {
          localStorage.setItem(
            storageKey(originalUrl),
            String(Math.floor(currentTime))
          );
        }
      } catch {
        /* storage full — ignore */
      }
    },
    [originalUrl]
  );

  const onEnded = useCallback(() => {
    if (!originalUrl) {
      return;
    }
    try {
      localStorage.removeItem(storageKey(originalUrl));
    } catch {
      /* ignore */
    }
  }, [originalUrl]);

  return { onTimeUpdate, onEnded };
}
