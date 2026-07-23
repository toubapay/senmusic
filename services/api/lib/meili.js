/**
 * Meilisearch integration.
 * ------------------------------------------------------------
 * Why Meilisearch over Elasticsearch here: single small container
 * (runs happily on a e2-small or Cloud Run with a volume), typo
 * tolerance out of the box (crucial: "Yousou Ndour" must still find
 * Youssou N'Dour), and ~zero ops.
 *
 *   npm i meilisearch
 *
 * Env: MEILI_HOST, MEILI_API_KEY
 *
 * Three indexes: tracks, artists, albums — searched together via
 * multiSearch so one query box covers the whole catalog.
 */

import { MeiliSearch } from "meilisearch";
import { pool } from "./db.js";

export const meili = new MeiliSearch({
  host: process.env.MEILI_HOST,
  apiKey: process.env.MEILI_API_KEY,
});

// ------------------------------------------------------------
// One-time index settings (run at boot — settings updates are cheap no-ops)
// ------------------------------------------------------------
export async function configureIndexes() {
  await meili.index("tracks").updateSettings({
    searchableAttributes: ["title", "artistNames", "albumTitle", "genre"],
    filterableAttributes: ["access", "genre", "artistIds"],
    sortableAttributes: ["playCount", "createdAt"],
    // popular tracks surface first among equally-relevant matches
    rankingRules: ["words", "typo", "proximity", "attribute", "sort", "exactness", "playCount:desc"],
  });

  await meili.index("artists").updateSettings({
    searchableAttributes: ["name"],
    sortableAttributes: ["name"],
  });

  await meili.index("albums").updateSettings({
    searchableAttributes: ["title", "artistNames"],
    filterableAttributes: ["albumType"],
  });
}

// ------------------------------------------------------------
// Per-document sync — call these from your app code:
//   indexTrack(id)   when the transcoder flips status to 'ready',
//                    and after any metadata edit
//   removeTrack(id)  when a track is removed/taken down
// ------------------------------------------------------------
export async function indexTrack(trackId) {
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.genre, t.access, t.play_count,
            EXTRACT(EPOCH FROM t.created_at)::bigint AS created_at,
            al.title AS album_title,
            COALESCE(json_agg(json_build_object('id', ar.id, 'name', ar.name))
                     FILTER (WHERE ar.id IS NOT NULL), '[]') AS artists
     FROM tracks t
     LEFT JOIN albums al ON al.id = t.album_id
     LEFT JOIN track_artists ta ON ta.track_id = t.id
     LEFT JOIN artists ar ON ar.id = ta.artist_id
     WHERE t.id = $1 AND t.status = 'ready'
     GROUP BY t.id, al.title`,
    [trackId]
  );
  if (rows.length === 0) return; // not ready / removed → nothing to index

  const t = rows[0];
  await meili.index("tracks").addDocuments([{
    id: t.id,
    title: t.title,
    genre: t.genre,
    access: t.access,
    playCount: Number(t.play_count),
    createdAt: Number(t.created_at),
    albumTitle: t.album_title,
    artistIds: t.artists.map((a) => a.id),
    artistNames: t.artists.map((a) => a.name).join(" "),
    artists: t.artists, // stored for display in results
  }]);
}

export const removeTrack = (trackId) =>
  meili.index("tracks").deleteDocument(trackId);

export async function indexArtist(artistId) {
  const { rows } = await pool.query(
    `SELECT id, name, slug, image_url, verified FROM artists WHERE id = $1`,
    [artistId]
  );
  if (rows.length) await meili.index("artists").addDocuments(rows);
}

export async function indexAlbum(albumId) {
  const { rows } = await pool.query(
    `SELECT al.id, al.title, al.album_type AS "albumType", al.cover_url AS "coverUrl",
            COALESCE(string_agg(ar.name, ' '), '') AS "artistNames"
     FROM albums al
     LEFT JOIN album_artists aa ON aa.album_id = al.id
     LEFT JOIN artists ar ON ar.id = aa.artist_id
     WHERE al.id = $1 AND al.status = 'published'
     GROUP BY al.id`,
    [albumId]
  );
  if (rows.length) await meili.index("albums").addDocuments(rows);
}

// ------------------------------------------------------------
// Full reindex — run once at launch, or after bulk imports:
//   node -e 'import("./lib/meili.js").then(m => m.reindexAll())'
// ------------------------------------------------------------
export async function reindexAll() {
  await configureIndexes();

  const { rows: tracks } = await pool.query(`SELECT id FROM tracks WHERE status = 'ready'`);
  for (const { id } of tracks) await indexTrack(id);

  const { rows: artists } = await pool.query(`SELECT id FROM artists`);
  for (const { id } of artists) await indexArtist(id);

  const { rows: albums } = await pool.query(`SELECT id FROM albums WHERE status = 'published'`);
  for (const { id } of albums) await indexAlbum(id);

  console.log(`Reindexed ${tracks.length} tracks, ${artists.length} artists, ${albums.length} albums`);
}
