import React, { useState, useEffect, useCallback } from "react";
import { getLikedTracks } from "../api/client";
import { usePlayerContext } from "../context/PlayerContext";
import { useLibrary } from "../hooks/useLibrary";
import TrackRow from "../components/TrackRow";
import AddToPlaylistMenu from "../components/AddToPlaylistMenu";

export default function LikedSongs() {
  const { playQueue } = usePlayerContext();
  const { likedTrackIds, toggleLike } = useLibrary();
  const [tracks, setTracks] = useState(null);
  const [error, setError] = useState(null);
  const [addMenuTrack, setAddMenuTrack] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await getLikedTracks();
      setTracks(r.tracks);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Re-fetch the list whenever a like is toggled from within this page,
  // so unliking a track here removes it from view immediately.
  const handleToggle = async (track) => {
    await toggleLike(track);
    load();
  };

  const playAll = () => {
    if (tracks?.length) playQueue(tracks, 0, "liked_songs");
  };

  if (error) return <p className="error-state">{error}</p>;
  if (!tracks) return <p className="empty-state">Chargement…</p>;

  return (
    <>
      <h2 className="section-title" style={{ marginTop: 0 }}>Titres likés</h2>
      <button className="btn-small" onClick={playAll} disabled={tracks.length === 0} style={{ marginBottom: 12 }}>
        ▶ Tout lire
      </button>

      {tracks.length === 0 ? (
        <p className="empty-state">Aucun titre liké pour l'instant.</p>
      ) : (
        <ul className="track-list">
          {tracks.map((t) => (
            <TrackRow
              key={t.id}
              track={t}
              queueTracks={tracks}
              queueSource="liked_songs"
              likedTrackIds={likedTrackIds}
              onToggleLike={handleToggle}
              onAddToPlaylist={setAddMenuTrack}
            />
          ))}
        </ul>
      )}

      {addMenuTrack && <AddToPlaylistMenu track={addMenuTrack} onClose={() => setAddMenuTrack(null)} />}
    </>
  );
}
