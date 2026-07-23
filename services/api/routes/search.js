/**
 * Search endpoint — one query box, three indexes, one round-trip.
 *
 * GET /v1/search?q=youssou&limit=5
 * → { tracks: [...], artists: [...], albums: [...] }
 *
 * The app renders these as sections (like the Spotify search screen).
 * Typo tolerance is Meilisearch's default, so "yousou ndur" still
 * finds the right artist.
 */

import { Router } from "express";
import { meili } from "../lib/meili.js";

export const searchRouter = Router();

searchRouter.get("/v1/search", async (req, res) => {
  const q = (req.query.q ?? "").toString().trim();
  const limit = Math.min(parseInt(req.query.limit ?? "5", 10) || 5, 20);

  if (q.length < 2) {
    return res.json({ tracks: [], artists: [], albums: [] });
  }

  const { results } = await meili.multiSearch({
    queries: [
      { indexUid: "tracks",  q, limit },
      { indexUid: "artists", q, limit },
      { indexUid: "albums",  q, limit },
    ],
  });

  const byIndex = Object.fromEntries(results.map((r) => [r.indexUid, r.hits]));

  res
    .set("Cache-Control", "public, max-age=30") // popular queries hit CDN/cache
    .json({
      tracks: byIndex.tracks ?? [],
      artists: byIndex.artists ?? [],
      albums: byIndex.albums ?? [],
    });
});

/**
 * Optional genre browse (uses the filterable attribute):
 * GET /v1/search/genre/:genre?limit=20 → most-played tracks in a genre
 */
searchRouter.get("/v1/search/genre/:genre", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? "20", 10) || 20, 50);

  const hits = await meili.index("tracks").search("", {
    filter: [`genre = ${JSON.stringify(req.params.genre)}`],
    sort: ["playCount:desc"],
    limit,
  });

  res.set("Cache-Control", "public, max-age=60").json({ tracks: hits.hits });
});
