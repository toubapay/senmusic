/**
 * Play tracking — the data your royalty statements are built from.
 *
 * Model: the app opens a play session when playback starts, then sends
 * heartbeats (~every 10s and on pause/skip/end) with total ms listened.
 * At >= 30 000 ms the play flips to counted = TRUE exactly once, and the
 * track's denormalized play_count increments atomically.
 *
 * POST  /v1/plays                → { playId }
 * PATCH /v1/plays/:playId        body: { msPlayed }
 */

import { Router } from "express";
import { pool } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";

const COUNT_THRESHOLD_MS = 30_000;

export const playsRouter = Router();

playsRouter.post("/v1/plays", requireAuth, async (req, res) => {
  const { trackId, source, device } = req.body ?? {};
  if (!trackId) return res.status(400).json({ error: "trackId_required" });

  const { rows } = await pool.query(
    `INSERT INTO plays (user_id, track_id, source, device)
     VALUES ($1, $2, $3, $4)
     RETURNING id, started_at`,
    [req.user.id, trackId, source ?? null, device ?? null]
  );

  res.status(201).json({ playId: rows[0].id, startedAt: rows[0].started_at });
});

playsRouter.patch("/v1/plays/:playId", requireAuth, async (req, res) => {
  const msPlayed = parseInt(req.body?.msPlayed, 10);
  if (!Number.isFinite(msPlayed) || msPlayed < 0) {
    return res.status(400).json({ error: "msPlayed_invalid" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ms_played only ever grows; `counted` flips at most once (guarded by
    // the `AND NOT counted` in the returning comparison below)
    const { rows } = await client.query(
      `UPDATE plays
       SET ms_played = GREATEST(ms_played, $3),
           counted   = counted OR GREATEST(ms_played, $3) >= $4
       WHERE id = $1 AND user_id = $2
       RETURNING track_id, counted`,
      [req.params.playId, req.user.id, msPlayed, COUNT_THRESHOLD_MS]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "play_not_found" });
    }

    // Increment the denormalized counter only on the transition to counted.
    // We detect the transition by re-checking: was it below threshold before?
    const becameCounted = await client.query(
      `SELECT 1 FROM plays
       WHERE id = $1 AND counted = TRUE AND ms_played >= $2
         AND NOT EXISTS (
           SELECT 1 FROM play_count_applied a WHERE a.play_id = plays.id
         )`,
      [req.params.playId, COUNT_THRESHOLD_MS]
    );

    if (becameCounted.rows.length > 0) {
      await client.query(
        `INSERT INTO play_count_applied (play_id) VALUES ($1)
         ON CONFLICT DO NOTHING`,
        [req.params.playId]
      );
      await client.query(
        `UPDATE tracks SET play_count = play_count + 1 WHERE id = $1`,
        [rows[0].track_id]
      );
    }

    await client.query("COMMIT");
    res.json({ counted: rows[0].counted });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
});

/**
 * Recently played — one row per track (its most recent play), newest
 * first. `plays` is partitioned by started_at, not user_id, so an
 * unbounded per-user scan would touch every partition ever created;
 * bounded to a semantically-reasonable "recent" window instead.
 */
playsRouter.get("/v1/plays/recent", requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? "20", 10) || 20, 50);

  const { rows } = await pool.query(
    `WITH latest_plays AS (
       SELECT DISTINCT ON (p.track_id) p.track_id, p.started_at
       FROM plays p
       WHERE p.user_id = $1 AND p.started_at > now() - interval '180 days'
       ORDER BY p.track_id, p.started_at DESC
     )
     SELECT lp.started_at AS "playedAt",
            t.id, t.title, t.duration_ms AS "durationMs", t.access, t.explicit,
            al.title AS "albumTitle", al.cover_url AS "coverUrl",
            COALESCE(json_agg(json_build_object('id', ar.id, 'name', ar.name))
                     FILTER (WHERE ar.id IS NOT NULL), '[]') AS artists
     FROM latest_plays lp
     JOIN tracks t ON t.id = lp.track_id
     LEFT JOIN albums al ON al.id = t.album_id
     LEFT JOIN track_artists ta ON ta.track_id = t.id
     LEFT JOIN artists ar ON ar.id = ta.artist_id
     WHERE t.status != 'removed'
     GROUP BY lp.started_at, t.id, al.title, al.cover_url
     ORDER BY lp.started_at DESC
     LIMIT $2`,
    [req.user.id, limit]
  );
  res.json({ tracks: rows });
});

/* Companion migration:

CREATE TABLE play_count_applied (
    play_id BIGINT PRIMARY KEY
);

Small bookkeeping table guaranteeing each play increments
tracks.play_count exactly once, even with concurrent heartbeats.
*/
