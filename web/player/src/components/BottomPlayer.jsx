import React from "react";
import { usePlayerContext } from "../context/PlayerContext";
import { useAudioPlayer } from "../hooks/useAudioPlayer";

const fmt = (sec) => {
  if (!Number.isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const ss = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${ss}`;
};

export default function BottomPlayer() {
  const { track } = usePlayerContext();
  const {
    audioRef, paused, buffering, position, duration, premiumWall, error,
    togglePlay, seekTo,
  } = useAudioPlayer(track);

  if (!track) return null;

  return (
    <div className="bottom-player">
      <audio ref={audioRef} />

      <div className="bp-meta">
        <div className="bp-title">{track.title}</div>
        <div className="bp-artist">{track.artistNames || "—"}</div>
      </div>

      {premiumWall ? (
        <div className="paywall-banner">
          Titre réservé aux abonnés — abonnez-vous pour l'écouter.
        </div>
      ) : error ? (
        <div className="paywall-banner">Lecture impossible ({error}).</div>
      ) : (
        <div className="bp-progress">
          <span className="bp-time">{fmt(position)}</span>
          <input
            className="bp-slider"
            type="range"
            min={0}
            max={duration || 1}
            step={1}
            value={position}
            onChange={(e) => seekTo(Number(e.target.value))}
          />
          <span className="bp-time">{fmt(duration)}</span>
        </div>
      )}

      <div className="bp-controls">
        <button className="bp-play-btn" onClick={togglePlay} disabled={buffering || premiumWall}>
          {buffering ? "…" : paused ? "▶" : "❚❚"}
        </button>
      </div>
    </div>
  );
}
