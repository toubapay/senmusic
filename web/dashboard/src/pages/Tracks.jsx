import React, { useCallback, useEffect, useState } from "react";
import { listTracks } from "../api/client";

const STATUS_LABELS = {
  processing: { text: "Transcodage…", color: "#3b82f6" },
  ready:      { text: "En ligne",     color: "#22c55e" },
  failed:     { text: "Échec",        color: "#ef4444" },
  removed:    { text: "Retiré",       color: "#6a6a6a" },
};

export default function Tracks() {
  const [tracks, setTracks] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const { tracks } = await listTracks();
      setTracks(tracks);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="card wide">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ marginTop: 0 }}>Mes titres</h2>
        <button className="btn-small" onClick={load}>Actualiser</button>
      </div>

      {error && <p className="error-state">{error}</p>}
      {!tracks && !error && <p className="empty-state">Chargement…</p>}
      {tracks && tracks.length === 0 && <p className="empty-state">Aucun titre publié pour l'instant.</p>}

      {tracks && tracks.length > 0 && (
        <table className="tracks-table">
          <thead>
            <tr>
              <th>Titre</th>
              <th>Album</th>
              <th>Accès</th>
              <th>Statut</th>
              <th>Écoutes</th>
              <th>Publié le</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((t) => {
              const status = STATUS_LABELS[t.status] ?? { text: t.status, color: "#b3b3b3" };
              return (
                <tr key={t.id}>
                  <td>{t.title}</td>
                  <td>{t.album_title ?? "—"}</td>
                  <td>{t.access === "premium" ? "Abonnés" : "Gratuit"}</td>
                  <td style={{ color: status.color, fontWeight: 600 }}>{status.text}</td>
                  <td>{t.play_count}</td>
                  <td>{new Date(t.created_at).toLocaleDateString("fr-FR")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
