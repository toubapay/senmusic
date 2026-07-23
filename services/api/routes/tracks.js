/**
 * Track metadata — GET /v1/tracks/:trackId
 *
 * mobile/src/api/client.js's getTrack() has called this since the mobile
 * piece was first written, but no route ever backed it — PlayerScreen's
 * flow (load track metadata, then navigate to the player) was broken at
 * the first step. Kept in its own file rather than streaming.js, which
 * CLAUDE.md flags as security-sensitive and off-limits without asking;
 * this route doesn't touch entitlement or signed URLs at all, just the
 * catalog metadata a client needs before it requests a stream.
 */

import { Router } from "express";
import { pool } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";

export const tracksRouter = Router();

tracksRouter.get("/v1/tracks/:trackId", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.duration_ms AS "durationMs", t.access, t.genre,
            t.explicit, t.status,
            al.title AS "albumTitle", al.cover_url AS "coverUrl",
            COALESCE(json_agg(json_build_object('id', ar.id, 'name', ar.name))
                     FILTER (WHERE ar.id IS NOT NULL), '[]') AS artists
     FROM tracks t
     LEFT JOIN albums al ON al.id = t.album_id
     LEFT JOIN track_artists ta ON ta.track_id = t.id
     LEFT JOIN artists ar ON ar.id = ta.artist_id
     WHERE t.id = $1 AND t.status != 'removed'
     GROUP BY t.id, al.title, al.cover_url`,
    [req.params.trackId]
  );

  if (rows.length === 0) return res.status(404).json({ error: "track_not_found" });
  res.json(rows[0]);
});
