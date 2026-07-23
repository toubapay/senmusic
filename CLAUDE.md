# ProMusic — Music Streaming Platform

## What this is
Spotify-style streaming app for the Senegalese market: upload, HLS
streaming, playlists, free + paid tiers, offline downloads, artist
royalties. Built incrementally (see `/docs/pieces/`) and now being
assembled into one working repo.

## Stack
- **Mobile**: React Native (client, player, offline manager)
- **Web**: React (artist dashboard)
- **API**: Node.js / Express on Cloud Run
- **DB**: PostgreSQL (Cloud SQL)
- **Storage/CDN**: Google Cloud Storage + Cloud CDN (signed URLs)
- **Transcoding**: FFmpeg in a separate Cloud Run service, triggered by Eventarc
- **Search**: Meilisearch
- **Payments**: PayDunya (Wave, Orange Money, cards)
- **SMS**: Promobile's own CPaaS bulk SMS API (renewal reminders, confirmations)

## Repo layout (target — build this if it doesn't exist yet)
```
/db/schema.sql              # from music_streaming_schema.sql
/db/migrations/              # offline-migration.sql etc, numbered in order
/services/api/               # main Express API — merge these routers:
  routes/streaming.js
  routes/plays.js
  routes/subscriptions.js
  routes/artist-uploads.js
  routes/search.js
  routes/offline.js
  lib/cdn-signer.js
  lib/paydunya.js
  lib/meili.js
  lib/db.js                  # pg.Pool wrapper, needed by all routes
  lib/auth.js                 # requireAuth JWT middleware, needed by all routes
/services/transcoder/        # from hls-transcoder/ as-is (separate Cloud Run service)
/services/royalties-job/     # from phase3/royalties/compute-royalties.js (Cloud Run job)
/mobile/                     # React Native app
  src/api/client.js
  src/hooks/usePlayTracking.js
  src/screens/PlayerScreen.jsx
  src/offline/offlineManager.js
/web/dashboard/               # React artist dashboard
  ArtistUpload.jsx
/web/player/                  # React listener web app (search, HLS playback,
                               # subscriptions) — separate origin from the API,
                               # a Vite SPA, not part of the original target
                               # layout above but built out the same way
```

## Known gaps — all filled; repo runs end-to-end
- `lib/db.js` — `pg.Pool` wrapper, done
- `lib/auth.js` — `requireAuth` JWT middleware, done
- `index.js` — Express bootstrap wiring all six routers, done. Async route
  handlers are wrapped via `express-async-errors` (imported once in
  `index.js`) so a rejected promise (DB/Meilisearch/GCS transiently down)
  reaches the error middleware and returns a 500 instead of hanging the
  client's connection forever — none of the individual route files need
  their own try/catch for this
- `offline_keys` table — `db/migrations/001_offline_downloads.sql`; the
  transcoder's `download.m4a` FFmpeg pass is in `services/transcoder/index.js`
- `play_count_applied` table — `db/migrations/002_play_count_applied.sql`
- Environment variables — consolidated in `.env.example`
- CORS — `web/player` is a genuinely separate-origin browser client (unlike
  the same-origin test console), so `index.js` now does
  `app.use(cors({ origin: process.env.APP_BASE_URL, credentials: true }))`.
  `APP_BASE_URL` was already the env var `paydunya.js` used for the web
  app's origin; it's now also the CORS allowlist and web/player's dev port
  (5173) by default

## Conventions already established in the code — keep these
- All money in XOF as integers (whole francs), never floats
- All IDs are UUIDs (`gen_random_uuid()`)
- Every webhook / payment path is idempotent (unique constraint on
  `payments.provider_token`, `ON CONFLICT DO NOTHING` on royalty statements)
- Every route file exports a named `Router` (e.g. `export const streamingRouter`)
  — the app bootstrap just does `app.use(streamingRouter)`
- Free tier capped at 128kbps; premium unlocks 256kbps — enforced both in
  the master playlist rewrite AND the variant-token check (defense in depth)
- A play counts toward royalties at >=30s listened, tracked via heartbeat PATCH

## Build/test commands
```
cp .env.example .env               # fill in real secrets/keys
docker compose up -d db            # Postgres, schema + migrations auto-applied on first boot
cd services/api && npm install && npm start   # or: docker compose up api
curl localhost:8090/healthz        # (host port from docker-compose.yml; 8080 if run directly)
```
No automated test suite yet. For manual testing, open
`services/api/public/test-console.html` (served by the API itself at
`/test-console.html`, same-origin so no CORS setup is needed) — it has a
form for every route across all six routers, plus a client-side JWT
generator (paste your `JWT_SECRET` + any UUID as the user id) since there's
no login route yet to issue real session tokens.

For the listener web app:
```
cd web/player && npm install
echo "VITE_API_BASE_URL=http://localhost:8080" > .env.local
npm run dev   # http://localhost:5173
```
It has no login page either — paste a token on the Session page (stored in
`localStorage` under the same `token` key `ArtistUpload.jsx` uses). Playback
needs `hls.js` (native browser HLS can't send the Authorization header the
master-playlist route requires) and, for real audio, a live GCS + Cloud CDN
backend — without one, streaming/search/checkout calls correctly reach the
API and fail there (verified end-to-end via CORS + a real JWT), not before.

## What NOT to change without asking
- The royalty pool formula in `compute-royalties.js` (pro-rata model, already reasoned through)
- The signed-URL / entitlement flow in `streaming.js` + `cdn-signer.js` (security-sensitive)
