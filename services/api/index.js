/**
 * ProMusic API — bootstrap.
 * Mounts every route module; each exports a named Router (see CLAUDE.md).
 */

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
// Patches Express's routing so a rejected/thrown promise in an async handler
// reaches the error middleware below instead of hanging the client forever
// (Express 4 doesn't do this on its own, and none of the route files wrap
// their handlers in try/catch themselves).
import "express-async-errors";
import { streamingRouter } from "./routes/streaming.js";
import { tracksRouter } from "./routes/tracks.js";
import { playsRouter } from "./routes/plays.js";
import { subscriptionsRouter } from "./routes/subscriptions.js";
import { artistRouter } from "./routes/artist-uploads.js";
import { searchRouter } from "./routes/search.js";
import { offlineRouter } from "./routes/offline.js";
import { playlistsRouter } from "./routes/playlists.js";
import { libraryRouter } from "./routes/library.js";
import { internalRouter } from "./routes/internal.js";

// Last-resort safety net for rejections outside the request/response cycle
// (e.g. a background timer) — request-path errors are now handled above.
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection outside a request handler:", err);
});

const app = express();

// Browser-facing clients live on different origins than the API: web/player
// at APP_BASE_URL (already used by paydunya.js for the same origin) and
// web/dashboard at ARTIST_DASHBOARD_URL. Mobile apps and server-to-server
// calls aren't subject to CORS, so this only affects browser fetches.
const allowedOrigins = [process.env.APP_BASE_URL, process.env.ARTIST_DASHBOARD_URL].filter(Boolean);
app.use(cors({ origin: allowedOrigins, credentials: true }));

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // PayDunya IPN posts form-encoded `data`

app.get("/healthz", (req, res) => res.json({ ok: true }));

// Manual test console (public/test-console.html) — same-origin so it can
// call the routes below with no CORS setup. Dev-only; nothing in here
// touches production traffic.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "public")));

// web/player and web/dashboard's built SPAs, consolidated into this one
// Cloud Run service (see root Dockerfile) rather than deployed as separate
// services — populated at image build time only; absent in local dev,
// where both apps run via their own `npm run dev` instead (see CLAUDE.md).
// Each is a client-side-routed SPA, so unmatched GETs under its prefix
// fall back to that build's own index.html instead of 404ing.
for (const [urlPrefix, dir] of [["/app", "public/app"], ["/dashboard", "public/dashboard"]]) {
  const buildDir = path.join(__dirname, dir);
  app.use(urlPrefix, express.static(buildDir));
  app.get(`${urlPrefix}/*`, (req, res, next) =>
    res.sendFile(path.join(buildDir, "index.html"), (err) => err && next())
  );
}

app.use(streamingRouter);
app.use(tracksRouter);
app.use(playsRouter);
app.use(subscriptionsRouter);
app.use(artistRouter);
app.use(searchRouter);
app.use(offlineRouter);
app.use(playlistsRouter);
app.use(libraryRouter);
app.use(internalRouter);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal_error" });
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`ProMusic API listening on :${port}`));
