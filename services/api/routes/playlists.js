/**
 * Playlists — create, list, view, edit, delete; add/remove/reorder tracks.
 *
 * POST   /v1/playlists                                  { title, description?, isPublic? }
 * GET    /v1/playlists/mine                              -> { playlists: [...] }
 * GET    /v1/playlists/:playlistId                       -> playlist + ordered tracks
 * PATCH  /v1/playlists/:playlistId                       { title?, description?, isPublic?, coverUrl? }
 * DELETE /v1/playlists/:playlistId
 * POST   /v1/playlists/:playlistId/tracks                 { trackId }
 * DELETE /v1/playlists/:playlistId/tracks/:trackId
 * PATCH  /v1/playlists/:playlistId/tracks/:trackId/reorder { afterTrackId: string | null }
 *
 * /mine is registered before /:playlistId so Express doesn't treat "mine"
 * as a playlist id.
 *
 * playlist_tracks.position uses gapped integers (1000, 2000, ...) per
 * schema.sql's own comment; reorder computes a midpoint between the two
 * new neighbors, and reflows the whole list only when no integer gap is
 * left between them.
 */

import { Router } from "express";
import { pool } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";

export const playlistsRouter = Router();

const PLAYLIST_FIELDS = `
  id, title, description, cover_url AS "coverUrl", is_public AS "isPublic",
  is_editorial AS "isEditorial", created_at AS "createdAt", updated_at AS "updatedAt"
`;

// ------------------------------------------------------------
// 1. Create
// ------------------------------------------------------------
playlistsRouter.post("/v1/playlists", requireAuth, async (req, res) => {
  const { title, description, isPublic } = req.body ?? {};
  if (!title?.trim()) return res.status(400).json({ error: "title_required" });

  const { rows } = await pool.query(
    `INSERT INTO playlists (owner_user_id, title, description, is_public)
     VALUES ($1, $2, $3, COALESCE($4, TRUE))
     RETURNING ${PLAYLIST_FIELDS}`,
    [req.user.id, title.trim(), description ?? null, isPublic ?? null]
  );
  res.status(201).json(rows[0]);
});

// ------------------------------------------------------------
// 2. List my playlists
// ------------------------------------------------------------
playlistsRouter.get("/v1/playlists/mine", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.id, p.title, p.description, p.cover_url AS "coverUrl", p.is_public AS "isPublic",
            p.is_editorial AS "isEditorial", p.created_at AS "createdAt", p.updated_at AS "updatedAt",
            COUNT(pt.track_id)::int AS "trackCount"
     FROM playlists p
     LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
     WHERE p.owner_user_id = $1
     GROUP BY p.id
     ORDER BY p.updated_at DESC`,
    [req.user.id]
  );
  res.json({ playlists: rows });
});

// ------------------------------------------------------------
// 3. Detail + ordered tracks
// ------------------------------------------------------------
playlistsRouter.get("/v1/playlists/:playlistId", requireAuth, async (req, res) => {
  const { rows: playlistRows } = await pool.query(
    `SELECT ${PLAYLIST_FIELDS}, owner_user_id AS "ownerUserId" FROM playlists WHERE id = $1`,
    [req.params.playlistId]
  );
  const playlist = playlistRows[0];
  // Same 404 for "doesn't exist" and "exists but private and not mine" --
  // a 403 here would leak that a private playlist with this id exists.
  if (!playlist || (playlist.ownerUserId !== req.user.id && !playlist.isPublic)) {
    return res.status(404).json({ error: "playlist_not_found" });
  }
  const isOwner = playlist.ownerUserId === req.user.id;
  delete playlist.ownerUserId;

  const { rows: tracks } = await pool.query(
    `SELECT t.id, t.title, t.duration_ms AS "durationMs", t.access, t.explicit,
            al.title AS "albumTitle", al.cover_url AS "coverUrl",
            pt.position, pt.added_at AS "addedAt",
            COALESCE(json_agg(json_build_object('id', ar.id, 'name', ar.name))
                     FILTER (WHERE ar.id IS NOT NULL), '[]') AS artists
     FROM playlist_tracks pt
     JOIN tracks t ON t.id = pt.track_id
     LEFT JOIN albums al ON al.id = t.album_id
     LEFT JOIN track_artists ta ON ta.track_id = t.id
     LEFT JOIN artists ar ON ar.id = ta.artist_id
     WHERE pt.playlist_id = $1 AND t.status != 'removed'
     GROUP BY t.id, al.title, al.cover_url, pt.position, pt.added_at
     ORDER BY pt.position ASC`,
    [playlist.id]
  );

  res.json({ ...playlist, isOwner, tracks });
});

// ------------------------------------------------------------
// 4. Update
// ------------------------------------------------------------
playlistsRouter.patch("/v1/playlists/:playlistId", requireAuth, async (req, res) => {
  const owner = await requireOwner(req.params.playlistId, req.user.id);
  if (owner.error) return res.status(owner.status).json({ error: owner.error });

  const { title, description, isPublic, coverUrl } = req.body ?? {};
  const { rows } = await pool.query(
    `UPDATE playlists
     SET title = COALESCE($2, title),
         description = COALESCE($3, description),
         is_public = COALESCE($4, is_public),
         cover_url = COALESCE($5, cover_url),
         updated_at = now()
     WHERE id = $1
     RETURNING ${PLAYLIST_FIELDS}`,
    [req.params.playlistId, title?.trim() ?? null, description ?? null, isPublic ?? null, coverUrl ?? null]
  );
  res.json(rows[0]);
});

// ------------------------------------------------------------
// 5. Delete
// ------------------------------------------------------------
playlistsRouter.delete("/v1/playlists/:playlistId", requireAuth, async (req, res) => {
  const owner = await requireOwner(req.params.playlistId, req.user.id);
  if (owner.error) return res.status(owner.status).json({ error: owner.error });

  await pool.query(`DELETE FROM playlists WHERE id = $1`, [req.params.playlistId]);
  res.status(204).end();
});

// ------------------------------------------------------------
// 6. Add a track
// ------------------------------------------------------------
playlistsRouter.post("/v1/playlists/:playlistId/tracks", requireAuth, async (req, res) => {
  const { trackId } = req.body ?? {};
  if (!trackId) return res.status(400).json({ error: "trackId_required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: plRows } = await client.query(
      `SELECT owner_user_id AS "ownerUserId" FROM playlists WHERE id = $1 FOR UPDATE`,
      [req.params.playlistId]
    );
    if (plRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "playlist_not_found" });
    }
    if (plRows[0].ownerUserId !== req.user.id) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "not_owner" });
    }

    const { rows: trackRows } = await client.query(
      `SELECT 1 FROM tracks WHERE id = $1 AND status != 'removed'`,
      [trackId]
    );
    if (trackRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "track_not_found" });
    }

    const { rows: posRows } = await client.query(
      `SELECT COALESCE(MAX(position), 0) + 1000 AS "nextPosition" FROM playlist_tracks WHERE playlist_id = $1`,
      [req.params.playlistId]
    );

    // ON CONFLICT DO NOTHING makes this idempotent -- adding a track
    // that's already there is a no-op, not an error.
    await client.query(
      `INSERT INTO playlist_tracks (playlist_id, track_id, position, added_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (playlist_id, track_id) DO NOTHING`,
      [req.params.playlistId, trackId, posRows[0].nextPosition, req.user.id]
    );

    const { rows: finalRows } = await client.query(
      `SELECT position FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2`,
      [req.params.playlistId, trackId]
    );
    await client.query(`UPDATE playlists SET updated_at = now() WHERE id = $1`, [req.params.playlistId]);

    await client.query("COMMIT");
    res.json({ trackId, position: finalRows[0].position });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------
// 7. Remove a track
// ------------------------------------------------------------
playlistsRouter.delete("/v1/playlists/:playlistId/tracks/:trackId", requireAuth, async (req, res) => {
  const owner = await requireOwner(req.params.playlistId, req.user.id);
  if (owner.error) return res.status(owner.status).json({ error: owner.error });

  await pool.query(
    `DELETE FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2`,
    [req.params.playlistId, req.params.trackId]
  );
  res.status(204).end();
});

// ------------------------------------------------------------
// 8. Reorder a track
// ------------------------------------------------------------
playlistsRouter.patch("/v1/playlists/:playlistId/tracks/:trackId/reorder", requireAuth, async (req, res) => {
  const { afterTrackId = null } = req.body ?? {};
  const { playlistId, trackId } = req.params;
  if (afterTrackId === trackId) return res.status(400).json({ error: "invalid_reorder" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: plRows } = await client.query(
      `SELECT owner_user_id AS "ownerUserId" FROM playlists WHERE id = $1 FOR UPDATE`,
      [playlistId]
    );
    if (plRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "playlist_not_found" });
    }
    if (plRows[0].ownerUserId !== req.user.id) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "not_owner" });
    }

    const { rows: items } = await client.query(
      `SELECT track_id AS "trackId", position FROM playlist_tracks
       WHERE playlist_id = $1 ORDER BY position ASC FOR UPDATE`,
      [playlistId]
    );

    if (!items.some((i) => i.trackId === trackId)) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "track_not_in_playlist" });
    }

    // Work against the list with the moving track removed, then find
    // where it should land among what's left.
    const rest = items.filter((i) => i.trackId !== trackId);

    let insertAt; // index in `rest` to insert after; -1 = front
    if (afterTrackId == null) {
      insertAt = -1;
    } else {
      insertAt = rest.findIndex((i) => i.trackId === afterTrackId);
      if (insertAt === -1) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "after_track_not_in_playlist" });
      }
    }

    const slot = (list, idx) => {
      const prevPos = idx < 0 ? 0 : list[idx].position;
      const nextPos = list[idx + 1] ? list[idx + 1].position : prevPos + 2000;
      return { prevPos, nextPos };
    };

    let { prevPos, nextPos } = slot(rest, insertAt);

    if (nextPos - prevPos <= 1) {
      // No integer gap left between the neighbors -- reflow everything
      // else to 1000, 2000, ... in its current order, then recompute the
      // slot from the fresh positions (guaranteed a gap now).
      for (let i = 0; i < rest.length; i++) {
        const newPos = (i + 1) * 1000;
        await client.query(
          `UPDATE playlist_tracks SET position = $3 WHERE playlist_id = $1 AND track_id = $2`,
          [playlistId, rest[i].trackId, newPos]
        );
        rest[i].position = newPos;
      }
      ({ prevPos, nextPos } = slot(rest, insertAt));
    }

    const newPosition = prevPos + Math.floor((nextPos - prevPos) / 2);
    await client.query(
      `UPDATE playlist_tracks SET position = $3 WHERE playlist_id = $1 AND track_id = $2`,
      [playlistId, trackId, newPosition]
    );
    await client.query(`UPDATE playlists SET updated_at = now() WHERE id = $1`, [playlistId]);

    await client.query("COMMIT");
    res.json({ trackId, position: newPosition });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
async function requireOwner(playlistId, userId) {
  const { rows } = await pool.query(`SELECT owner_user_id AS "ownerUserId" FROM playlists WHERE id = $1`, [
    playlistId,
  ]);
  if (rows.length === 0) return { error: "playlist_not_found", status: 404 };
  if (rows[0].ownerUserId !== userId) return { error: "not_owner", status: 403 };
  return { error: null };
}
