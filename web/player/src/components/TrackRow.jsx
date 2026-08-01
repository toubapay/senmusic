import React from "react";
import { usePlayerContext } from "../context/PlayerContext";

/**
 * queueTracks/queueSource are optional — when given, clicking starts a
 * multi-track queue positioned at this row instead of a 1-item queue, so
 * next/prev traverse the whole list (a playlist, liked songs, etc).
 * onToggleLike/onAddToPlaylist/onMoveUp/onMoveDown/onRemove are all
 * optional too; their buttons only render when a handler is passed, so
 * existing callers (Home.jsx) are visually and behaviorally unchanged
 * unless explicitly wired up. Playlist-owner controls (move/remove) are
 * plain buttons alongside like/add-to-playlist rather than a second
 * wrapping element, since this component already renders a single <li>
 * and callers render it inside a <ul> — nesting another <li> around it
 * for "extra" controls is invalid HTML (React warns on it).
 */
export default function TrackRow({
  track, queueTracks, queueSource, likedTrackIds, onToggleLike, onAddToPlaylist,
  onMoveUp, onMoveDown, onRemove, canMoveUp = true, canMoveDown = true,
}) {
  const { currentTrack: current, playTrack, playQueue } = usePlayerContext();
  const artistNames = track.artists?.map((a) => a.name).join(", ") ?? track.artistNames ?? "";
  const isPlaying = current?.id === track.id;
  const isLiked = likedTrackIds?.has(track.id) ?? false;

  const handleClick = () => {
    if (queueTracks) {
      const idx = queueTracks.findIndex((t) => t.id === track.id);
      playQueue(queueTracks, idx === -1 ? 0 : idx, queueSource ?? null);
    } else {
      playTrack({ id: track.id, title: track.title, artistNames, access: track.access }, queueSource ?? null);
    }
  };

  return (
    <li className={`track-row${isPlaying ? " playing" : ""}`} onClick={handleClick}>
      <div className="track-cover">{(track.title || "?")[0].toUpperCase()}</div>
      <div className="track-meta">
        <div className="track-title">
          {track.title}
          {track.access === "premium" && <span className="badge-premium">PREMIUM</span>}
        </div>
        <div className="track-artist">{artistNames || "Artiste inconnu"}</div>
      </div>
      {onToggleLike && (
        <button
          className="track-action"
          onClick={(e) => { e.stopPropagation(); onToggleLike(track); }}
          aria-label={isLiked ? "Retirer des titres likés" : "Ajouter aux titres likés"}
        >
          {isLiked ? "♥" : "♡"}
        </button>
      )}
      {onAddToPlaylist && (
        <button
          className="track-action"
          onClick={(e) => { e.stopPropagation(); onAddToPlaylist(track); }}
          aria-label="Ajouter à une playlist"
        >
          +
        </button>
      )}
      {(onMoveUp || onMoveDown) && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {onMoveUp && (
            <button
              className="track-action"
              onClick={(e) => { e.stopPropagation(); onMoveUp(track); }}
              disabled={!canMoveUp}
              aria-label="Monter"
            >
              ▲
            </button>
          )}
          {onMoveDown && (
            <button
              className="track-action"
              onClick={(e) => { e.stopPropagation(); onMoveDown(track); }}
              disabled={!canMoveDown}
              aria-label="Descendre"
            >
              ▼
            </button>
          )}
        </div>
      )}
      {onRemove && (
        <button
          className="track-action"
          onClick={(e) => { e.stopPropagation(); onRemove(track); }}
          aria-label="Retirer de la playlist"
        >
          ✕
        </button>
      )}
    </li>
  );
}
