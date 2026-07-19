import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';

const SAVE_INTERVAL_MS = 10_000; // throttle server writes to every 10 s
const MIN_SEC = 30; // don't track accidental starts (mirrors server)

interface WatchProgressParams {
  background?: string;
  enabled?: boolean;
  episode?: number;
  logo?: string;
  mediaId?: string;
  mediaType: 'movie' | 'series';
  name?: string;
  poster?: string;
  season?: number;
  year?: string;
}

/**
 * Server-synced "Continue watching" progress for the mobile/TV player, keyed by
 * TMDB mediaId (+ season/episode). Fetches the saved position on mount
 * (`resumeMs`), saves throttled to every 10 s via `onTime`, and exposes `flush`
 * for pause/unmount. All writes are fire-and-forget so playback is never blocked;
 * a missing profile (409) is a silent no-op. Local files (no mediaId) are skipped.
 */
export function useWatchProgress(params: WatchProgressParams) {
  const { mediaId, mediaType, season = 0, episode = 0, enabled = true } = params;
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  });

  const [resumeMs, setResumeMs] = useState<number | null>(null);
  const lastSavedAt = useRef(0);
  const latest = useRef({ position: 0, duration: 0 });
  const active = enabled && Boolean(mediaId);

  useEffect(() => {
    if (!(active && mediaId)) {
      return;
    }
    let cancelled = false;
    const qs = `?id=${encodeURIComponent(mediaId)}&type=${mediaType}&season=${season}&episode=${episode}`;
    apiFetch<{ durationSec: number; positionSec: number }>(
      `/api/onevid-progress${qs}`,
    )
      .then((data) => {
        if (!cancelled && data && typeof data.positionSec === 'number') {
          setResumeMs(data.positionSec * 1000);
        }
      })
      .catch(() => {
        /* no profile / offline — resume unavailable, ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [active, mediaId, mediaType, season, episode]);

  const post = useCallback((positionSec: number, durationSec: number) => {
    const p = paramsRef.current;
    if (!p.mediaId) {
      return;
    }
    apiFetch('/api/onevid-progress', {
      method: 'POST',
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
        logo: p.logo,
        year: p.year,
      }),
    }).catch(() => {
      /* fire-and-forget */
    });
  }, []);

  const onTime = useCallback(
    (ms: number, durationMs: number) => {
      const positionSec = ms / 1000;
      const durationSec = durationMs / 1000;
      latest.current = { position: positionSec, duration: durationSec };
      const now = Date.now();
      if (now - lastSavedAt.current < SAVE_INTERVAL_MS) {
        return;
      }
      lastSavedAt.current = now;
      if (positionSec >= MIN_SEC) {
        post(positionSec, durationSec);
      }
    },
    [post],
  );

  const flush = useCallback(() => {
    const { position, duration } = latest.current;
    if (position < MIN_SEC) {
      return;
    }
    post(position, duration);
  }, [post]);

  // Flush on unmount so we don't lose the last <10 s of progress.
  useEffect(() => flush, [flush]);

  return { onTime, flush, resumeMs };
}
