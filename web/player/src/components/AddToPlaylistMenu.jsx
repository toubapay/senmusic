import React, { useState, useEffect } from "react";
import { listMyPlaylists, addPlaylistTrack } from "../api/client";

export default function AddToPlaylistMenu({ track, onClose }) {
  const [playlists, setPlaylists] = useState(null);
  const [error, setError] = useState(null);
  const [addedTo, setAddedTo] = useState(new Set());

  useEffect(() => {
    listMyPlaylists()
      .then((r) => setPlaylists(r.playlists))
      .catch((e) => setError(e.message));
  }, []);

  const add = async (playlistId) => {
    try {
      await addPlaylistTrack(playlistId, track.id);
      setAddedTo((prev) => new Set(prev).add(playlistId));
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Ajouter « {track.title} » à…</h3>
        {error && <p className="error-state">{error}</p>}
        {!playlists && !error && <p className="empty-state">Chargement…</p>}
        {playlists?.length === 0 && <p className="empty-state">Aucune playlist — créez-en une d'abord.</p>}
        {playlists && playlists.length > 0 && (
          <ul className="track-list">
            {playlists.map((p) => (
              <li key={p.id} className="track-row" onClick={() => add(p.id)}>
                <div className="track-meta">
                  <div className="track-title">{p.title}</div>
                  <div className="track-artist">{p.trackCount} titre{p.trackCount === 1 ? "" : "s"}</div>
                </div>
                {addedTo.has(p.id) && <span style={{ color: "#1DB954" }}>Ajouté ✓</span>}
              </li>
            ))}
          </ul>
        )}
        <button className="btn-ghost" onClick={onClose}>Fermer</button>
      </div>
    </div>
  );
}
