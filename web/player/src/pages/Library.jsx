import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { listMyPlaylists, createPlaylist, getLikedTracks } from "../api/client";

export default function Library() {
  const [playlists, setPlaylists] = useState(null);
  const [likedCount, setLikedCount] = useState(null);
  const [error, setError] = useState(null);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ playlists }, { tracks }] = await Promise.all([listMyPlaylists(), getLikedTracks()]);
      setPlaylists(playlists);
      setLikedCount(tracks.length);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      await createPlaylist(newTitle.trim());
      setNewTitle("");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <h2 className="section-title" style={{ marginTop: 0 }}>Bibliothèque</h2>

      <form onSubmit={create} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          className="search-input"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Nom de la nouvelle playlist…"
        />
        <button className="btn-small" type="submit" disabled={creating || !newTitle.trim()}>
          Créer
        </button>
      </form>

      {error && <p className="error-state">{error}</p>}
      {!playlists && !error && <p className="empty-state">Chargement…</p>}

      {playlists && (
        <ul className="track-list">
          <li className="track-row">
            <Link to="/liked" style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, textDecoration: "none", color: "inherit" }}>
              <div className="track-cover" style={{ background: "#5b47e0" }}>♥</div>
              <div className="track-meta">
                <div className="track-title">Titres likés</div>
                <div className="track-artist">Playlist • {likedCount ?? "…"} titre{likedCount === 1 ? "" : "s"}</div>
              </div>
            </Link>
          </li>
          {playlists.map((p) => (
            <li key={p.id} className="track-row">
              <Link to={`/playlists/${p.id}`} style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, textDecoration: "none", color: "inherit" }}>
                <div className="track-cover">{p.title[0]?.toUpperCase() ?? "?"}</div>
                <div className="track-meta">
                  <div className="track-title">{p.title}</div>
                  <div className="track-artist">Playlist • {p.trackCount} titre{p.trackCount === 1 ? "" : "s"}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
