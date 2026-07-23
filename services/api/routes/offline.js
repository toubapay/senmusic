/**
 * Offline downloads — server side.
 * ------------------------------------------------------------
 * POST /v1/offline/downloads { trackId }
 *      premium check → signed GCS URL for download.m4a (1h)
 *      + the per-user AES-256 content key + license expiry
 *
 * GET  /v1/offline/licenses
 *      the renewal heartbeat. Returns ALL of the user's content keys
 *      with a fresh expiry — but ONLY while their subscription is
 *      active. Once it lapses, this returns 403 and the app purges
 *      keys, making every downloaded file unreadable.
 *
 * Honest scope note: this is content protection, not Hollywood DRM.
 * It stops casual copying and file-sharing (the file is AES-encrypted,
 * the key expires with the subscription). A determined attacker with a
 * rooted device can still extract audio — the upgrade path for that is
 * Widevine/FairPlay, which you can adopt later without changing this
 * API shape.
 */

import { Router } from "express";
import crypto from "node:crypto";
import { Storage } from "@google-cloud/storage";
import { pool } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";

const storage = new Storage();
const HLS_BUCKET = process.env.HLS_BUCKET;

// How long the app may keep playing offline without phoning home.
// 30 days matches what the big platforms do.
const LICENSE_GRACE_DAYS = 30;
const MAX_DOWNLOADED_TRACKS = 500;

export const offlineRouter = Router();

async function isPremium(userId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM subscriptions
     WHERE user_id = $1 AND status = 'active' AND expires_at > now()`,
    [userId]
  );
  return rows.length > 0;
}

const licenseExpiry = () =>
  new Date(Date.now() + LICENSE_GRACE_DAYS * 86400000).toISOString();

// ------------------------------------------------------------
// 1. Authorize a download
// ------------------------------------------------------------
offlineRouter.post("/v1/offline/downloads", requireAuth, async (req, res) => {
  const { trackId } = req.body ?? {};
  if (!trackId) return res.status(400).json({ error: "trackId_required" });

  if (!(await isPremium(req.user.id))) {
    return res.status(403).json({ error: "premium_required" });
  }

  const { rows: trackRows } = await pool.query(
    `SELECT status FROM tracks WHERE id = $1`, [trackId]
  );
  if (trackRows[0]?.status !== "ready") {
    return res.status(404).json({ error: "track_not_available" });
  }

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) AS n FROM offline_keys WHERE user_id = $1`, [req.user.id]
  );
  if (Number(countRows[0].n) >= MAX_DOWNLOADED_TRACKS) {
    return res.status(409).json({ error: "download_limit_reached", limit: MAX_DOWNLOADED_TRACKS });
  }

  // One stable key per (user, track): re-downloading reuses it, so a
  // re-fetched file still matches the cached key on the device.
  const freshKey = crypto.randomBytes(32).toString("base64");
  const { rows: keyRows } = await pool.query(
    `INSERT INTO offline_keys (user_id, track_id, key_b64)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, track_id) DO UPDATE SET key_b64 = offline_keys.key_b64
     RETURNING key_b64`,
    [req.user.id, trackId, freshKey]
  );

  const [downloadUrl] = await storage
    .bucket(HLS_BUCKET)
    .file(`hls/${trackId}/download.m4a`)
    .getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 60 * 60 * 1000, // 1h to finish the download
    });

  res.json({
    trackId,
    downloadUrl,
    key: keyRows[0].key_b64,          // client encrypts the file with this
    licenseExpiresAt: licenseExpiry() // client refuses playback past this
  });
});

// ------------------------------------------------------------
// 2. License renewal — the subscription enforcement point
// ------------------------------------------------------------
offlineRouter.get("/v1/offline/licenses", requireAuth, async (req, res) => {
  if (!(await isPremium(req.user.id))) {
    // Client contract: on 403, purge all stored keys immediately.
    return res.status(403).json({ error: "premium_required", action: "purge_keys" });
  }

  const { rows } = await pool.query(
    `SELECT track_id, key_b64 FROM offline_keys WHERE user_id = $1`,
    [req.user.id]
  );

  res.json({
    licenseExpiresAt: licenseExpiry(),
    keys: rows.map((r) => ({ trackId: r.track_id, key: r.key_b64 })),
  });
});

// ------------------------------------------------------------
// 3. Remove a download (frees a slot; client deletes its local file)
// ------------------------------------------------------------
offlineRouter.delete("/v1/offline/downloads/:trackId", requireAuth, async (req, res) => {
  await pool.query(
    `DELETE FROM offline_keys WHERE user_id = $1 AND track_id = $2`,
    [req.user.id, req.params.trackId]
  );
  res.status(204).end();
});
