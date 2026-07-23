/**
 * ProMusic API — bootstrap.
 * Mounts every route module; each exports a named Router (see CLAUDE.md).
 */

import "dotenv/config";
import express from "express";
import { streamingRouter } from "./routes/streaming.js";
import { playsRouter } from "./routes/plays.js";
import { subscriptionsRouter } from "./routes/subscriptions.js";
import { artistRouter } from "./routes/artist-uploads.js";
import { searchRouter } from "./routes/search.js";
import { offlineRouter } from "./routes/offline.js";

// None of the route files wrap their async handlers, so in Express 4 an
// unhandled rejection (e.g. Meilisearch/GCS/Postgres transiently down)
// would otherwise crash the whole process, not just that one request.
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection in route handler:", err);
});

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // PayDunya IPN posts form-encoded `data`

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.use(streamingRouter);
app.use(playsRouter);
app.use(subscriptionsRouter);
app.use(artistRouter);
app.use(searchRouter);
app.use(offlineRouter);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal_error" });
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`ProMusic API listening on :${port}`));
