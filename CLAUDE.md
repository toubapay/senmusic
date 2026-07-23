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
  lib/db.js                  # NOT yet built — pg.Pool wrapper, needed by all routes
  lib/auth.js                 # NOT yet built — requireAuth JWT middleware, needed by all routes
/services/transcoder/        # from hls-transcoder/ as-is (separate Cloud Run service)
/services/royalties-job/     # from phase3/royalties/compute-royalties.js (Cloud Run job)
/mobile/                     # React Native app
  src/api/client.js
  src/hooks/usePlayTracking.js
  src/screens/PlayerScreen.jsx
  src/offline/offlineManager.js
/web/dashboard/               # React artist dashboard
  ArtistUpload.jsx
```

## Known gaps — build these to make the pieces actually run
- `lib/db.js` — every backend route imports `{ pool }` from here; doesn't exist yet
- `lib/auth.js` — every backend route imports `requireAuth`; doesn't exist yet
- `index.js` / app bootstrap — wire all routers into one Express app
- `offline_keys` table — apply `offline-migration.sql`, and add the
  `download.m4a` FFmpeg pass described in that file's comments to the transcoder
- `play_count_applied` table — referenced in `routes/plays.js`'s trailing comment, needs its own migration
- Environment variables — consolidate every `process.env.X` referenced
  across the pieces into one `.env.example`

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
(fill in once package.json / docker-compose exist — not yet established)

## What NOT to change without asking
- The royalty pool formula in `compute-royalties.js` (pro-rata model, already reasoned through)
- The signed-URL / entitlement flow in `streaming.js` + `cdn-signer.js` (security-sensitive)
