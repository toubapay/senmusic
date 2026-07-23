/**
 * ArtistUpload — dashboard component for the React web app.
 *
 * Flow: metadata form → POST /v1/artist/tracks → PUT file straight to the
 * signed GCS URL (with real progress via XHR) → poll status every 3s
 * until the transcoder flips it to 'ready' (or 'failed').
 */

import React, { useCallback, useEffect, useRef, useState } from "react";

const API = "https://api.yourdomain.sn";
const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const STATUS_LABELS = {
  uploading:  { text: "Envoi du fichier…",        color: "#f59e0b" },
  processing: { text: "Transcodage en cours…",    color: "#3b82f6" },
  ready:      { text: "En ligne ✓",               color: "#22c55e" },
  failed:     { text: "Échec — réessayez",        color: "#ef4444" },
};

export default function ArtistUpload() {
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
    if (!meta.title) {
      setMeta((m) => ({ ...m, title: f.name.replace(/\.[^.]+$/, "") }));
    }
  };

  const startPolling = useCallback((trackId) => {
    setPhase("processing");
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/v1/artist/tracks/${trackId}`, {
          headers: authHeaders(),
        });
        const track = await res.json();
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
      // 1. Register the track, get the signed URL
      const res = await fetch(`${API}/v1/artist/tracks`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          title: meta.title,
          genre: meta.genre || null,
          access: meta.access,
          contentType: file.type || "audio/wav",
          sizeBytes: file.size,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `http_${res.status}`);
      }
      const { trackId, uploadUrl, contentType } = await res.json();

      // 2. PUT the file directly to GCS with progress (XHR for onprogress)
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", contentType);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`gcs_upload_${xhr.status}`));
        xhr.onerror = () => reject(new Error("gcs_upload_network_error"));
        xhr.send(file);
      });

      // 3. Eventarc → transcoder is now running; poll until done
      startPolling(trackId);
    } catch (e) {
      setPhase("failed");
      setError(e.message);
    }
  }, [file, meta, startPolling]);

  const status = STATUS_LABELS[phase];
  const busy = phase === "uploading" || phase === "processing";

  return (
    <div style={s.card}>
      <h2 style={s.h2}>Publier un titre</h2>

      <label style={s.label}>Fichier audio (WAV, FLAC ou MP3 — max 500 Mo)</label>
      <input type="file" accept=".wav,.flac,.mp3,audio/*" onChange={onFileChange} disabled={busy} />

      <label style={s.label}>Titre</label>
      <input
        style={s.input}
        value={meta.title}
        onChange={(e) => setMeta({ ...meta, title: e.target.value })}
        disabled={busy}
        placeholder="Titre du morceau"
      />

      <div style={s.row}>
        <div style={{ flex: 1 }}>
          <label style={s.label}>Genre</label>
          <input
            style={s.input}
            value={meta.genre}
            onChange={(e) => setMeta({ ...meta, genre: e.target.value })}
            disabled={busy}
            placeholder="Mbalax, Afrobeats…"
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={s.label}>Accès</label>
          <select
            style={s.input}
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
        <div style={s.progressOuter}>
          <div style={{ ...s.progressInner, width: `${progress}%` }} />
          <span style={s.progressText}>{progress}%</span>
        </div>
      )}

      {status && <p style={{ color: status.color, fontWeight: 600 }}>{status.text}</p>}
      {error && <p style={{ color: "#ef4444" }}>{error}</p>}

      <button style={s.btn} onClick={upload} disabled={busy || !file}>
        {busy ? "Patientez…" : "Publier"}
      </button>

      {phase === "ready" && (
        <button style={s.btnGhost} onClick={() => { setFile(null); setPhase("idle"); setProgress(0); setMeta({ title: "", genre: "", access: "free" }); }}>
          Publier un autre titre
        </button>
      )}
    </div>
  );
}

const s = {
  card: { maxWidth: 520, margin: "0 auto", padding: 24, background: "#181818", borderRadius: 16, color: "#fff", fontFamily: "system-ui" },
  h2: { marginTop: 0 },
  label: { display: "block", margin: "16px 0 6px", fontSize: 13, color: "#b3b3b3" },
  input: { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #333", background: "#242424", color: "#fff", boxSizing: "border-box" },
  row: { display: "flex", gap: 12 },
  progressOuter: { position: "relative", height: 22, background: "#242424", borderRadius: 11, marginTop: 16, overflow: "hidden" },
  progressInner: { height: "100%", background: "#1DB954", transition: "width .2s" },
  progressText: { position: "absolute", inset: 0, textAlign: "center", fontSize: 12, lineHeight: "22px" },
  btn: { marginTop: 20, width: "100%", padding: "12px 0", borderRadius: 24, border: "none", background: "#1DB954", color: "#000", fontWeight: 700, cursor: "pointer" },
  btnGhost: { marginTop: 10, width: "100%", padding: "10px 0", borderRadius: 24, border: "1px solid #444", background: "transparent", color: "#fff", cursor: "pointer" },
};
