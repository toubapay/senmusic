import React, { useState, useCallback, useEffect } from "react";
import { search, searchByGenre, getRecentlyPlayed } from "../api/client";
import { usePlayerContext } from "../context/PlayerContext";
import { useLibrary } from "../hooks/useLibrary";
import TrackRow from "../components/TrackRow";
import AddToPlaylistMenu from "../components/AddToPlaylistMenu";

const GENRE_CHIPS = ["mbalax", "afrobeats", "hip-hop", "coupé-décalé", "gospel"];

export default function Home() {
  const { playQueue } = usePlayerContext();
  const { likedTrackIds, toggleLike } = useLibrary();

  const [q, setQ] = useState("");
  const [results, setResults] = useState(null); // { tracks, artists, albums }
  const [genreResults, setGenreResults] = useState(null);
  const [activeGenre, setActiveGenre] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [addMenuTrack, setAddMenuTrack] = useState(null);

  const [recent, setRecent] = useState(null);
  useEffect(() => {
    getRecentlyPlayed(10).then((r) => setRecent(r.tracks)).catch(() => setRecent([]));
  }, []);

  const runSearch = useCallback(async (e) => {
    e?.preventDefault();
    if (q.trim().length < 2) return;
    setLoading(true);
    setError(null);
    setActiveGenre(null);
    try {
      const r = await search(q.trim());
      setResults(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [q]);

  const runGenre = useCallback(async (genre) => {
    setLoading(true);
    setError(null);
    setResults(null);
    setActiveGenre(genre);
    try {
      const r = await searchByGenre(genre);
      setGenreResults(r.tracks);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const trackRowProps = {
    likedTrackIds, onToggleLike: toggleLike, onAddToPlaylist: setAddMenuTrack,
  };

  return (
    <>
      {recent && recent.length > 0 && (
        <>
          <h3 className="section-title" style={{ marginTop: 0 }}>Repris récemment</h3>
          <ul className="track-list">
            {recent.map((t) => (
              <TrackRow key={t.id} track={t} queueTracks={recent} queueSource="recently_played" {...trackRowProps} />
            ))}
          </ul>
        </>
      )}

      <form className="search-form-standalone" onSubmit={runSearch} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input
          className="search-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Chercher un titre, un artiste, un album…"
        />
        <button className="btn-small" type="submit">Chercher</button>
      </form>

      <h3 className="section-title">Parcourir par genre</h3>
      <div className="chips">
        {GENRE_CHIPS.map((g) => (
          <button
            key={g}
            className="chip"
            style={activeGenre === g ? { background: "#1DB954", color: "#000" } : undefined}
            onClick={() => runGenre(g)}
          >
            {g}
          </button>
        ))}
      </div>

      {loading && <p className="empty-state">Chargement…</p>}
      {error && (
        <p className="error-state">
          {error} — vérifiez que Meilisearch est joignable et indexé (voir lib/meili.js).
        </p>
      )}

      {results && (
        <>
          <h3 className="section-title">Titres</h3>
          {results.tracks.length === 0
            ? <p className="empty-state">Aucun résultat.</p>
            : (
              <ul className="track-list">
                {results.tracks.map((t) => (
                  <TrackRow key={t.id} track={t} queueTracks={results.tracks} queueSource="search" {...trackRowProps} />
                ))}
              </ul>
            )}
        </>
      )}

      {genreResults && (
        <>
          <h3 className="section-title">{activeGenre}</h3>
          {genreResults.length === 0
            ? <p className="empty-state">Aucun titre dans ce genre.</p>
            : (
              <ul className="track-list">
                {genreResults.map((t) => (
                  <TrackRow key={t.id} track={t} queueTracks={genreResults} queueSource="genre" {...trackRowProps} />
                ))}
              </ul>
            )}
        </>
      )}

      {addMenuTrack && <AddToPlaylistMenu track={addMenuTrack} onClose={() => setAddMenuTrack(null)} />}
    </>
  );
}
