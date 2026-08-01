/**
 * useAudioPlayer — drives an <audio> element with hls.js.
 *
 * The master playlist request needs the normal session Authorization
 * header (requireAuth in streaming.js); variant playlists carry their own
 * short-lived ?st= token instead, so xhrSetup only attaches the header to
 * the master URL. hls.js runs even in Safari (MSE), which sidesteps the
 * fact that Safari's *native* HLS engine can't send custom headers at all
 * — without hls.js, the master request there would always 401.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import { streamUrl, streamAuthHeader } from "../api/client";
import { usePlayTracking } from "./usePlayTracking";
import { usePlayerContext } from "../context/PlayerContext";

export function useAudioPlayer() {
  const { currentTrack: track, source, hasNext, next } = usePlayerContext();
  const audioRef = useRef(null);
  const hlsRef = useRef(null);
  const [paused, setPaused] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [premiumWall, setPremiumWall] = useState(false);
  const [error, setError] = useState(null);

  const trackId = track?.id;
  const { onPlaying, onPaused, onEnded } = usePlayTracking(trackId, source ?? undefined);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !trackId) return;

    setPremiumWall(false);
    setError(null);
    setBuffering(true);
    setPosition(0);
    setDuration(0);

    hlsRef.current?.destroy();

    if (Hls.isSupported()) {
      const hls = new Hls({
        xhrSetup: (xhr, url) => {
          if (url.includes(`/v1/tracks/${trackId}/stream/master.m3u8`)) {
            const { Authorization } = streamAuthHeader();
            xhr.setRequestHeader("Authorization", Authorization);
          }
        },
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.response?.code === 403) {
          setPremiumWall(true);
          setBuffering(false);
          return;
        }
        if (data.fatal) {
          setError(data.details ?? "playback_error");
          setBuffering(false);
        }
      });

      hls.loadSource(streamUrl(trackId));
      hls.attachMedia(audio);
      audio.play().catch(() => {}); // autoplay may be blocked; user presses play
    } else {
      // No MSE (rare) — falls back to the browser's native HLS handling,
      // which cannot send the Authorization header the master route needs.
      audio.src = streamUrl(trackId);
      audio.play().catch(() => {});
    }

    return () => hlsRef.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoadedMeta = () => { setDuration(audio.duration || 0); setBuffering(false); };
    const onTimeUpdate = () => setPosition(audio.currentTime);
    const onWaiting = () => setBuffering(true);
    const onPlayingEv = () => { setBuffering(false); setPaused(false); onPlaying(); };
    const onPauseEv = () => { setPaused(true); onPaused(); };
    const onEndedEv = () => {
      setPaused(true);
      setPosition(0);
      onEnded();
      if (hasNext) next();
    };

    audio.addEventListener("loadedmetadata", onLoadedMeta);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("playing", onPlayingEv);
    audio.addEventListener("pause", onPauseEv);
    audio.addEventListener("ended", onEndedEv);
    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMeta);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("playing", onPlayingEv);
      audio.removeEventListener("pause", onPauseEv);
      audio.removeEventListener("ended", onEndedEv);
    };
  }, [onPlaying, onPaused, onEnded, hasNext, next]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, []);

  const seekTo = useCallback((seconds) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setPosition(seconds);
  }, []);

  return {
    audioRef, paused, buffering, position, duration, premiumWall, error,
    togglePlay, seekTo,
  };
}
