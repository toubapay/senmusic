/**
 * UploadForm — the artist upload flow.
 *
 * Flow: metadata form → POST /v1/artist/tracks → PUT file straight to the
 * signed GCS URL (with real progress via XHR) → poll status every 3s
 * until the transcoder flips it to 'ready' (or 'failed').
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createTrack, uploadToGcs, getTrack } from "../api/client";

const STATUS_LABELS = {
  uploading:  { text: "Envoi du fichier…",     color: "#f59e0b" },
  processing: { text: "Transcodage en cours…", color: "#3b82f6" },
  ready:      { text: "En ligne ✓",            color: "#22c55e" },
  failed:     { text: "Échec — réessayez",     color: "#ef4444" },
};

export default function UploadForm() {
  const [file, setFile] = useState(null);
  const [meta, setMeta] = useState({ title: "", genre: "", access: "free" });
  const [phase, setPhase] = useState("idle"); // idle|uploading|processing|ready|failed
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  const onFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    if (!meta.title) setMeta((m) => ({ ...m, title: f.name.replace(/\.[^.]+$/, "") }));
  };

  const startPolling = useCallback((trackId) => {
    setPhase("processing");
    pollRef.current = setInterval(async () => {
      try {
        const track = await getTrack(trackId);
        if (track.status === "ready" || track.status === "failed") {
          clearInterval(pollRef.current);
          setPhase(track.status);
        }
      } catch {
        /* transient — keep polling */
      }
    }, 3000);
  }, []);

  const upload = useCallback(async () => {
    if (!file || !meta.title.trim()) {
      setError("Titre et fichier requis");
      return;
    }
    setError(null);
    setPhase("uploading");
    setProgress(0);

    try {
      const contentType = file.type || "audio/wav";
      const { trackId, uploadUrl } = await createTrack({
        title: meta.title,
        genre: meta.genre || null,
        access: meta.access,
        contentType,
        sizeBytes: file.size,
      });

      await uploadToGcs(uploadUrl, file, contentType, setProgress);
      startPolling(trackId);
    } catch (e) {
      setPhase("failed");
      setError(e.message);
    }
  }, [file, meta, startPolling]);

  const status = STATUS_LABELS[phase];
  const busy = phase === "uploading" || phase === "processing";

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Publier un titre</h2>

      <label className="label">Fichier audio (WAV, FLAC ou MP3 — max 500 Mo)</label>
      <input type="file" accept=".wav,.flac,.mp3,audio/*" onChange={onFileChange} disabled={busy} />

      <label className="label">Titre</label>
      <input
        className="input"
        value={meta.title}
        onChange={(e) => setMeta({ ...meta, title: e.target.value })}
        disabled={busy}
        placeholder="Titre du morceau"
      />

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label className="label">Genre</label>
          <input
            className="input"
            value={meta.genre}
            onChange={(e) => setMeta({ ...meta, genre: e.target.value })}
            disabled={busy}
            placeholder="Mbalax, Afrobeats…"
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">Accès</label>
          <select
            className="input"
            value={meta.access}
            onChange={(e) => setMeta({ ...meta, access: e.target.value })}
            disabled={busy}
          >
            <option value="free">Gratuit</option>
            <option value="premium">Abonnés uniquement</option>
          </select>
        </div>
      </div>

      {phase === "uploading" && (
        <div className="progress-outer">
          <div className="progress-inner" style={{ width: `${progress}%` }} />
          <span className="progress-text">{progress}%</span>
        </div>
      )}

      {status && <p style={{ color: status.color, fontWeight: 600 }}>{status.text}</p>}
      {error && <p className="error-state">{error}</p>}

      <button className="btn" onClick={upload} disabled={busy || !file}>
        {busy ? "Patientez…" : "Publier"}
      </button>

      {phase === "ready" && (
        <button
          className="btn-ghost"
          onClick={() => { setFile(null); setPhase("idle"); setProgress(0); setMeta({ title: "", genre: "", access: "free" }); }}
        >
          Publier un autre titre
        </button>
      )}
    </div>
  );
}
