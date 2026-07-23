import React, { useState, useEffect, useCallback } from "react";
import { getSubscription, checkout } from "../api/client";

export default function Subscribe() {
  const [status, setStatus] = useState(null);
  const [planCode, setPlanCode] = useState("premium-monthly");
  const [checkoutUrl, setCheckoutUrl] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await getSubscription());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const startCheckout = async () => {
    setBusy(true);
    setError(null);
    setCheckoutUrl(null);
    try {
      const r = await checkout(planCode.trim());
      setCheckoutUrl(r.checkoutUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Abonnement</h2>

      {status?.premium ? (
        <p style={{ color: "#1DB954", fontWeight: 600 }}>
          Premium actif — {status.planName}, jusqu'au{" "}
          {new Date(status.expiresAt).toLocaleDateString("fr-FR")}
        </p>
      ) : status ? (
        <p style={{ color: "#b3b3b3" }}>Aucun abonnement actif.</p>
      ) : null}

      <label className="label">Code du plan</label>
      <input className="input" value={planCode} onChange={(e) => setPlanCode(e.target.value)} />

      <button className="btn" onClick={startCheckout} disabled={busy || !planCode.trim()}>
        {busy ? "Patientez…" : "S'abonner — Wave / Orange Money"}
      </button>

      {error && <p className="error-state">{error}</p>}

      {checkoutUrl && (
        <p style={{ marginTop: 16, fontSize: 13 }}>
          Paiement prêt —{" "}
          <a href={checkoutUrl} target="_blank" rel="noreferrer">
            ouvrir la page PayDunya
          </a>
          . L'abonnement s'active automatiquement après confirmation (webhook IPN).
        </p>
      )}
    </div>
  );
}
