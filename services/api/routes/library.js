/**
 * Library — liked tracks. library_items is polymorphic (item_type also
 * covers 'album'/'artist'/'playlist' per its CHECK constraint), but only
 * 'track' is implemented here; saving albums/artists/other playlists is
 * out of scope for this pass.
 *
 * POST   /v1/library/tracks/:trackId       like
 * DELETE /v1/library/tracks/:trackId       unlike
 * GET    /v1/library/tracks                liked tracks, newest first
 * GET    /v1/library/tracks/ids            just the ids, for cheap "is this liked" checks
 */

import { Router } from "express";
import { pool } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";

export const libraryRouter = Router();

libraryRouter.post("/v1/library/tracks/:trackId", requireAuth, async (req, res) => {
  const { rows: trackRows } = await pool.query(
    `SELECT 1 FROM tracks WHERE id = $1 AND status != 'removed'`,
    [req.params.trackId]
  );
  if (trackRows.length === 0) return res.status(404).json({ error: "track_not_found" });

  await pool.query(
    `INSERT INTO library_items (user_id, item_type, item_id)
     VALUES ($1, 'track', $2)
     ON CONFLICT DO NOTHING`,
    [req.user.id, req.params.trackId]
  );
  res.json({ trackId: req.params.trackId, liked: true });
});

libraryRouter.delete("/v1/library/tracks/:trackId", requireAuth, async (req, res) => {
  await pool.query(
    `DELETE FROM library_items WHERE user_id = $1 AND item_type = 'track' AND item_id = $2`,
    [req.user.id, req.params.trackId]
  );
  res.status(204).end();
});

libraryRouter.get("/v1/library/tracks/ids", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT item_id AS "trackId" FROM library_items WHERE user_id = $1 AND item_type = 'track'`,
    [req.user.id]
  );
  res.json({ trackIds: rows.map((r) => r.trackId) });
});

libraryRouter.get("/v1/library/tracks", requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? "50", 10) || 50, 100);
  const offset = Math.max(parseInt(req.query.offset ?? "0", 10) || 0, 0);

  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.duration_ms AS "durationMs", t.access, t.explicit,
            al.title AS "albumTitle", al.cover_url AS "coverUrl",
            li.added_at AS "likedAt",
            COALESCE(json_agg(json_build_object('id', ar.id, 'name', ar.name))
                     FILTER (WHERE ar.id IS NOT NULL), '[]') AS artists
     FROM library_items li
     JOIN tracks t ON t.id = li.item_id
     LEFT JOIN albums al ON al.id = t.album_id
     LEFT JOIN track_artists ta ON ta.track_id = t.id
     LEFT JOIN artists ar ON ar.id = ta.artist_id
     WHERE li.user_id = $1 AND li.item_type = 'track' AND t.status != 'removed'
     GROUP BY t.id, al.title, al.cover_url, li.added_at
     ORDER BY li.added_at DESC
     LIMIT $2 OFFSET $3`,
    [req.user.id, limit, offset]
  );
  res.json({ tracks: rows });
});
