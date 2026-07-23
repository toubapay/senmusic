import React, { useState } from "react";
import { getToken, setToken, clearToken } from "../api/client";

/**
 * No login/signup route exists yet (see CLAUDE.md), so this is where a
 * session JWT gets in — same localStorage "token" key web/player and the
 * original ArtistUpload.jsx use. The signed-in user also needs a row in
 * `artists` with owner_user_id matching the token's sub, or every route
 * here 403s with not_an_artist (see routes/artist-uploads.js).
 */
export default function Settings() {
  const [value, setValue] = useState(getToken());
  const [saved, setSaved] = useState(false);

  const save = () => {
    setToken(value.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const clear = () => {
    clearToken();
    setValue("");
  };

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Session</h2>
      <p style={{ color: "#b3b3b3", fontSize: 13 }}>
        Aucune page de connexion n'existe encore côté API — collez un JWT de
        session pour un compte lié à un profil artiste.
      </p>
      <label className="label">Bearer token</label>
      <input
        className="input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="eyJhbGciOi..."
      />
      <button className="btn" onClick={save}>{saved ? "Enregistré ✓" : "Enregistrer"}</button>
      <button className="btn-ghost" onClick={clear}>Effacer</button>
    </div>
  );
}
