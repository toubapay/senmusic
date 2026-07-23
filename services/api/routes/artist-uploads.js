/**
 * Artist upload endpoints
 * ------------------------------------------------------------
 * POST /v1/artist/tracks          metadata → { trackId, uploadUrl }
 * GET  /v1/artist/tracks          list own tracks with pipeline status
 * GET  /v1/artist/tracks/:id      poll a single track (dashboard polls this
 *                                 until status becomes 'ready' or 'failed')
 *
 * The audio file goes DIRECTLY from the browser to GCS via a V4 signed
 * PUT URL — it never transits your API, so a 200 MB WAV costs your
 * Cloud Run instance nothing. The GCS finalize event then triggers the
 * transcoder automatically (already wired via Eventarc).
 */

import { Router } from "express";
import { Storage } from "@google-cloud/storage";
import { pool } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";

const storage = new Storage();
const ORIGINALS_BUCKET = process.env.ORIGINALS_BUCKET;

const ALLOWED_TYPES = {
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/flac": ".flac",
  "audio/mpeg": ".mp3",
};
const MAX_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB

export const artistRouter = Router();

/** Resolve the artist profile owned by this user (401/403 otherwise) */
async function requireArtist(req, res, next) {
  const { rows } = await pool.query(
    `SELECT id, name FROM artists WHERE owner_user_id = $1`,
    [req.user.id]
  );
  if (rows.length === 0) {
    return res.status(403).json({ error: "not_an_artist" });
  }
  req.artist = rows[0];
  next();
}

// ------------------------------------------------------------
// 1. Create the track + hand back a signed upload URL
// ------------------------------------------------------------
artistRouter.post("/v1/artist/tracks", requireAuth, requireArtist, async (req, res) => {
  const { title, albumId, trackNumber, genre, access, explicit, contentType, sizeBytes } =
    req.body ?? {};

  if (!title?.trim()) return res.status(400).json({ error: "title_required" });
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) return res.status(400).json({ error: "unsupported_format", allowed: Object.keys(ALLOWED_TYPES) });
  if (!sizeBytes || sizeBytes > MAX_SIZE_BYTES) {
    return res.status(400).json({ error: "file_too_large", maxBytes: MAX_SIZE_BYTES });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO tracks (title, album_id, track_number, genre, access, explicit, status)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'free'), COALESCE($6, FALSE), 'processing')
       RETURNING id`,
      [title.trim(), albumId ?? null, trackNumber ?? null, genre ?? null, access, explicit]
    );
    const trackId = rows[0].id;

    await client.query(
      `INSERT INTO track_artists (track_id, artist_id, role)
       VALUES ($1, $2, 'primary')`,
      [trackId, req.artist.id]
    );

    // Auto-create the 100% royalty split; collab splits edited later
    await client.query(
      `INSERT INTO royalty_splits (track_id, artist_id, share_percent)
       VALUES ($1, $2, 100)`,
      [trackId, req.artist.id]
    );

    await client.query("COMMIT");

    // V4 signed PUT URL — browser uploads straight to GCS
    const objectName = `originals/${trackId}/master${ext}`;
    const [uploadUrl] = await storage
      .bucket(ORIGINALS_BUCKET)
      .file(objectName)
      .getSignedUrl({
        version: "v4",
        action: "write",
        expires: Date.now() + 30 * 60 * 1000, // 30 min to complete the upload
        contentType,
        extensionHeaders: { "x-goog-content-length-range": `0,${MAX_SIZE_BYTES}` },
      });

    res.status(201).json({ trackId, uploadUrl, contentType });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------
// 2. List own tracks (dashboard table)
// ------------------------------------------------------------
artistRouter.get("/v1/artist/tracks", requireAuth, requireArtist, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.status, t.access, t.duration_ms, t.play_count,
            t.created_at, a.title AS album_title
     FROM tracks t
     JOIN track_artists ta ON ta.track_id = t.id AND ta.artist_id = $1
     LEFT JOIN albums a ON a.id = t.album_id
     WHERE t.status != 'removed'
     ORDER BY t.created_at DESC
     LIMIT 200`,
    [req.artist.id]
  );
  res.json({ tracks: rows });
});

// ------------------------------------------------------------
// 3. Poll one track's pipeline status
// ------------------------------------------------------------
artistRouter.get("/v1/artist/tracks/:id", requireAuth, requireArtist, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.status, t.duration_ms
     FROM tracks t
     JOIN track_artists ta ON ta.track_id = t.id AND ta.artist_id = $2
     WHERE t.id = $1`,
    [req.params.id, req.artist.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: "track_not_found" });
  res.json(rows[0]);
});
