/**
 * usePlayTracking — reports listening time to the backend.
 * Ported from mobile/src/hooks/usePlayTracking.js; same rules:
 *   - a play session opens when playback actually starts (not on mount)
 *   - msPlayed accumulates only while audio is playing (seeking doesn't inflate it)
 *   - heartbeat PATCH every 10s while playing, plus a final flush on
 *     pause / track end / unmount, so the >= 30s "counted" flip is never lost
 */

import { useCallback, useEffect, useRef } from "react";
import { startPlay, heartbeatPlay } from "../api/client";

const HEARTBEAT_MS = 10_000;

export function usePlayTracking(trackId, source = "web-player") {
  const playIdRef = useRef(null);
  const msPlayedRef = useRef(0);
  const lastTickRef = useRef(null);
  const timerRef = useRef(null);

  const flush = useCallback(async () => {
    if (!playIdRef.current) return;
    try {
      await heartbeatPlay(playIdRef.current, Math.round(msPlayedRef.current));
    } catch {
      // Non-fatal: a missed heartbeat just means a slightly undercounted play.
    }
  }, []);

  const tick = useCallback(() => {
    const now = Date.now();
    if (lastTickRef.current != null) {
      msPlayedRef.current += now - lastTickRef.current;
    }
    lastTickRef.current = now;
  }, []);

  const onPlaying = useCallback(async () => {
    lastTickRef.current = Date.now();

    if (!playIdRef.current) {
      try {
        const { playId } = await startPlay(trackId, source, "web");
        playIdRef.current = playId;
      } catch {
        /* retry on next onPlaying */
      }
    }

    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      tick();
      flush();
    }, HEARTBEAT_MS);
  }, [trackId, source, tick, flush]);

  const onPaused = useCallback(() => {
    tick();
    lastTickRef.current = null;
    clearInterval(timerRef.current);
    flush();
  }, [tick, flush]);

  const onEnded = useCallback(() => {
    onPaused();
    playIdRef.current = null; // next play of same track = new session
    msPlayedRef.current = 0;
  }, [onPaused]);

  useEffect(() => {
    return () => {
      tick();
      clearInterval(timerRef.current);
      flush();
    };
  }, [tick, flush]);

  return { onPlaying, onPaused, onEnded };
}
