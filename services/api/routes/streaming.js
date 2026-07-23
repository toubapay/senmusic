/**
 * Streaming endpoints
 * ------------------------------------------------------------
 * GET /v1/tracks/:trackId/stream/master.m3u8
 *      Auth: Bearer JWT (your normal user auth — sent by app code)
 *      → entitlement check (free track OR active subscription)
 *      → returns the master playlist, with:
 *          - 256k variant REMOVED for free-tier users
 *          - variant URIs rewritten to point back at this API,
 *            carrying a short-lived stream token (?st=...)
 *
 * GET /v1/tracks/:trackId/stream/:variant/playlist.m3u8?st=...
 *      Auth: the stream token only (HLS players don't send your headers)
 *      → returns the variant playlist with every segment line rewritten
 *        to an absolute Cloud CDN URL + the prefix signature params
 *
 * Segments themselves NEVER touch this API — they go straight to
 * Cloud CDN, which validates the signature. Playlists are a few KB,
 * so proxying them is negligible.
 */

import { Router } from "express";
import { Storage } from "@google-cloud/storage";
import jwt from "jsonwebtoken";
import { signPrefix } from "../lib/cdn-signer.js";
import { pool } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js"; // your existing JWT middleware

const storage = new Storage();
const HLS_BUCKET = process.env.HLS_BUCKET;
const STREAM_TOKEN_SECRET = process.env.STREAM_TOKEN_SECRET;
const API_BASE_URL = process.env.API_BASE_URL; // e.g. https://api.yourdomain.sn

const FREE_MAX_KBPS = 128;

export const streamingRouter = Router();

// ------------------------------------------------------------
// 1. Master playlist — the entry point the app requests
// ------------------------------------------------------------
streamingRouter.get(
  "/v1/tracks/:trackId/stream/master.m3u8",
  requireAuth,
  async (req, res) => {
    const { trackId } = req.params;
    const userId = req.user.id;

    // --- Entitlement -----------------------------------------
    const { rows } = await pool.query(
      `SELECT t.access, t.status,
              EXISTS (
                SELECT 1 FROM subscriptions s
                WHERE s.user_id = $2
                  AND s.status = 'active'
                  AND s.expires_at > now()
              ) AS is_premium
       FROM tracks t
       WHERE t.id = $1`,
      [trackId, userId]
    );

    const track = rows[0];
    if (!track || track.status !== "ready") {
      return res.status(404).json({ error: "track_not_available" });
    }
    if (track.access === "premium" && !track.is_premium) {
      return res.status(403).json({
        error: "premium_required",
        message: "Abonnez-vous pour écouter ce titre",
      });
    }

    // --- Build the tier-filtered master playlist -------------
    const [masterRaw] = await storage
      .bucket(HLS_BUCKET)
      .file(`hls/${trackId}/master.m3u8`)
      .download();

    const st = jwt.sign(
      { sub: userId, trk: trackId, prm: track.is_premium },
      STREAM_TOKEN_SECRET,
      { expiresIn: "6h" }
    );

    const out = [];
    const lines = masterRaw.toString("utf8").split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith("#EXT-X-STREAM-INF")) {
        const kbps = variantKbps(lines[i + 1]);
        // Free users never even see the 256k variant
        if (!track.is_premium && kbps > FREE_MAX_KBPS) {
          i++; // skip the URI line too
          continue;
        }
        out.push(line);
        out.push(
          `${API_BASE_URL}/v1/tracks/${trackId}/stream/v${kbps}k/playlist.m3u8?st=${st}`
        );
        i++;
      } else {
        out.push(line);
      }
    }

    res
      .set("Content-Type", "application/vnd.apple.mpegurl")
      .set("Cache-Control", "private, no-store") // entitlements are per-user
      .send(out.join("\n"));
  }
);

// ------------------------------------------------------------
// 2. Variant playlist — requested by the player itself
// ------------------------------------------------------------
streamingRouter.get(
  "/v1/tracks/:trackId/stream/:variant/playlist.m3u8",
  async (req, res) => {
    const { trackId, variant } = req.params; // variant = "v64k" | "v128k" | "v256k"

    // --- Validate the stream token ---------------------------
    let claims;
    try {
      claims = jwt.verify(req.query.st ?? "", STREAM_TOKEN_SECRET);
    } catch {
      return res.status(401).json({ error: "invalid_stream_token" });
    }
    if (claims.trk !== trackId) {
      return res.status(403).json({ error: "token_track_mismatch" });
    }
    const kbps = parseInt(variant.replace(/\D/g, ""), 10);
    if (!claims.prm && kbps > FREE_MAX_KBPS) {
      return res.status(403).json({ error: "premium_required" });
    }

    // --- Rewrite segment lines with CDN-signed URLs ----------
    const [variantRaw] = await storage
      .bucket(HLS_BUCKET)
      .file(`hls/${trackId}/${variant}/playlist.m3u8`)
      .download();

    const { params, segmentBase } = signPrefix(trackId);

    const body = variantRaw
      .toString("utf8")
      .split("\n")
      .map((line) => {
        const l = line.trim();
        if (l && !l.startsWith("#")) {
          // "seg_0001.ts" → "https://cdn.../hls/{trackId}/v128k/seg_0001.ts?URLPrefix=...&Signature=..."
          return `${segmentBase}${variant}/${l}?${params}`;
        }
        return line;
      })
      .join("\n");

    res
      .set("Content-Type", "application/vnd.apple.mpegurl")
      .set("Cache-Control", "private, no-store")
      .send(body);
  }
);

function variantKbps(uriLine) {
  // transcoder names variants v64k / v128k / v256k
  const m = /v(\d+)k/.exec(uriLine ?? "");
  return m ? parseInt(m[1], 10) : 0;
}
