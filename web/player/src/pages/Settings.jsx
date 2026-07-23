import React, { useState } from "react";
import { getToken, setToken, clearToken } from "../api/client";

/**
 * There's no login/signup route yet (see CLAUDE.md), so this is where a
 * session JWT gets in: paste one issued elsewhere (e.g. the API test
 * console's token generator) and it's stored under the same localStorage
 * key ArtistUpload.jsx already uses.
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
      <h2>Session</h2>
      <p style={{ color: "#b3b3b3", fontSize: 13 }}>
        Aucune page de connexion n'existe encore côté API — collez un JWT de
        session ici pour tester l'app.
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
