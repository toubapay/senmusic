import React from "react";
import { usePlayerContext } from "../context/PlayerContext";

export default function TrackRow({ track }) {
  const { track: current, playTrack } = usePlayerContext();
  const artistNames = track.artists?.map((a) => a.name).join(", ") ?? track.artistNames ?? "";
  const isPlaying = current?.id === track.id;

  return (
    <li
      className={`track-row${isPlaying ? " playing" : ""}`}
      onClick={() => playTrack({ id: track.id, title: track.title, artistNames })}
    >
      <div className="track-cover">{(track.title || "?")[0].toUpperCase()}</div>
      <div className="track-meta">
        <div className="track-title">
          {track.title}
          {track.access === "premium" && <span className="badge-premium">PREMIUM</span>}
        </div>
        <div className="track-artist">{artistNames || "Artiste inconnu"}</div>
      </div>
    </li>
  );
}
