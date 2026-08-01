import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  getPlaylist, updatePlaylist, deletePlaylist,
  removePlaylistTrack, reorderPlaylistTrack,
} from "../api/client";
import { usePlayerContext } from "../context/PlayerContext";
import { useLibrary } from "../hooks/useLibrary";
import TrackRow from "../components/TrackRow";
import AddToPlaylistMenu from "../components/AddToPlaylistMenu";

export default function PlaylistDetail() {
  const { playlistId } = useParams();
  const navigate = useNavigate();
  const { playQueue } = usePlayerContext();
  const { likedTrackIds, toggleLike } = useLibrary();

  const [playlist, setPlaylist] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [addMenuTrack, setAddMenuTrack] = useState(null);

  const load = useCallback(async () => {
    try {
      const p = await getPlaylist(playlistId);
      setPlaylist(p);
      setTitle(p.title);
    } catch (e) {
      setError(e.message);
    }
  }, [playlistId]);

  useEffect(() => { load(); }, [load]);

  const playAll = () => {
    if (playlist?.tracks?.length) playQueue(playlist.tracks, 0, "playlist");
  };

  const saveTitle = async () => {
    await updatePlaylist(playlistId, { title: title.trim() });
    setEditing(false);
    load();
  };

  const remove = async () => {
    await deletePlaylist(playlistId);
    navigate("/library");
  };

  const removeTrack = async (trackId) => {
    await removePlaylistTrack(playlistId, trackId);
    load();
  };

  const move = async (index, direction) => {
    const tracks = playlist.tracks;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= tracks.length) return;
    // Moving up = place after the track currently two spots up (or front);
    // moving down = place after the track currently one spot down.
    const afterIndex = direction === -1 ? targetIndex - 1 : targetIndex;
    const afterTrackId = afterIndex < 0 ? null : tracks[afterIndex].id;
    await reorderPlaylistTrack(playlistId, tracks[index].id, afterTrackId);
    load();
  };

  if (error) return <p className="error-state">{error}</p>;
  if (!playlist) return <p className="empty-state">Chargement…</p>;

  return (
    <>
      {editing ? (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input className="search-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="btn-small" onClick={saveTitle}>Enregistrer</button>
        </div>
      ) : (
        <h2 className="section-title" style={{ marginTop: 0 }} onClick={() => playlist.isOwner && setEditing(true)}>
          {playlist.title}
        </h2>
      )}
      {playlist.description && <p style={{ color: "#b3b3b3" }}>{playlist.description}</p>}

      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <button className="btn-small" onClick={playAll} disabled={playlist.tracks.length === 0}>
          ▶ Tout lire
        </button>
        {playlist.isOwner && (
          <button className="btn-small" style={{ background: "transparent", border: "1px solid #444", color: "#fff" }} onClick={remove}>
            Supprimer la playlist
          </button>
        )}
      </div>

      {playlist.tracks.length === 0 ? (
        <p className="empty-state">Playlist vide.</p>
      ) : (
        <ul className="track-list">
          {playlist.tracks.map((t, i) => (
            <TrackRow
              key={t.id}
              track={t}
              queueTracks={playlist.tracks}
              queueSource="playlist"
              likedTrackIds={likedTrackIds}
              onToggleLike={toggleLike}
              onAddToPlaylist={setAddMenuTrack}
              onMoveUp={playlist.isOwner ? () => move(i, -1) : undefined}
              onMoveDown={playlist.isOwner ? () => move(i, 1) : undefined}
              onRemove={playlist.isOwner ? () => removeTrack(t.id) : undefined}
              canMoveUp={i > 0}
              canMoveDown={i < playlist.tracks.length - 1}
            />
          ))}
        </ul>
      )}

      {addMenuTrack && <AddToPlaylistMenu track={addMenuTrack} onClose={() => setAddMenuTrack(null)} />}
    </>
  );
}
