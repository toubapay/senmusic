# ProMusic — Music Streaming Platform

## What this is
Spotify-style streaming app for the Senegalese market: upload, HLS
streaming, playlists, free + paid tiers, offline downloads, artist
royalties. Built incrementally (see `/docs/pieces/`) and now being
assembled into one working repo.

## Stack
- **Mobile**: Flutter (client, player, offline manager) — replaced React
  Native; see "Known gaps" below for why
- **Web**: React (artist dashboard)
- **API**: Node.js / Express on Cloud Run — in production also serves
  web/player (`/app`) and web/dashboard (`/dashboard`) as static builds,
  consolidated into this one Cloud Run service (see DEPLOY.md); local dev
  still runs each independently
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
  routes/tracks.js
  routes/plays.js
  routes/subscriptions.js
  routes/artist-uploads.js
  routes/search.js
  routes/offline.js
  routes/playlists.js
  routes/library.js
  lib/cdn-signer.js
  lib/paydunya.js
  lib/meili.js
  lib/db.js                  # pg.Pool wrapper, needed by all routes
  lib/auth.js                 # requireAuth JWT middleware, needed by all routes
/services/transcoder/        # from hls-transcoder/ as-is (separate Cloud Run service)
/services/royalties-job/     # DEPRECATED, kept for reference only — superseded by
                              # services/api/lib/compute-royalties.js (see Known gaps)
/mobile/                     # Flutter app (Android + iOS)
  lib/api/client.dart
  lib/services/play_tracking.dart
  lib/services/offline_manager.dart
  lib/screens/player_screen.dart
/web/dashboard/               # React artist dashboard (Vite SPA)
  src/components/UploadForm.jsx
  src/pages/Tracks.jsx
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
  the same-origin test console), so `index.js` now allows `APP_BASE_URL`
  and `ARTIST_DASHBOARD_URL` as CORS origins. `APP_BASE_URL` was already the
  env var `paydunya.js` used for the web app's origin; it's now also in the
  CORS allowlist, and web/player's dev port (5173) by default
- `services/royalties-job` — had no `package.json`/`Dockerfile` (its own
  header comment's `gcloud run jobs create --source .` had nothing to
  build); both now exist
- Deployment — every service targeted GCP already but only the transcoder
  had a deploy doc; see the root `DEPLOY.md` for the full order, and each
  service/app's own `DEPLOY.md` for specifics
- `web/dashboard` — was a loose `ArtistUpload.jsx` with no app shell; now a
  real Vite SPA (upload flow, a track-status table, the same token-paste
  Settings page as web/player) and its `DEPLOY.md` has real steps instead
  of a "not buildable yet" note
- `mobile/` — was loose React Native pieces with no app shell (same
  situation web/dashboard was in); replaced with Flutter/Dart on request,
  1:1 behavior port (same API contract, same 10s/30s play-tracking
  thresholds, same AES-256-CTR offline-file contract) — see `mobile/README.md`
  for the full piece-by-piece mapping. `flutter analyze` and `flutter test`
  pass; no Android SDK/iOS toolchain was available to verify an actual
  device build
- Playlists, liked tracks, a play queue, and recently-played — the
  `playlists`/`playlist_tracks`/`library_items` tables existed in
  `schema.sql` from the start but were never wired to any route or
  client. Now: `routes/playlists.js` (CRUD + add/remove/reorder track,
  gapped-integer positions per the schema's own comment, reflowing to
  1000/2000/... when a reorder runs out of integer gap), `routes/library.js`
  (like/unlike, scoped to `item_type='track'` — the other polymorphic
  types `library_items` supports are out of scope), and `GET
  /v1/plays/recent` (added to the existing `routes/plays.js`, deduped to
  one row per track via `DISTINCT ON`). web/player and mobile both got a
  real ordered-queue player (`queue`/`currentIndex`/`next`/`prev` — was a
  single `currentTrack` before) instead of only ever replacing one track;
  `playTrack()` still works as 1-item-queue sugar so old call sites are
  unchanged. A single unified Library view (Liked Songs pinned first,
  playlists below) plus a "Repris récemment" section on Home — not three
  separate destinations — following the IA in Spotify's own App Store
  screenshots, not something invented here
- `db/migrations/003_plays_partitions.sql` — found mid-work, unrelated to
  the above but blocking `GET /v1/plays/recent`: `schema.sql` only ever
  created one `plays` partition (`plays_2026_07`, up to but not including
  2026-08-01), so every `INSERT INTO plays` had been failing since that
  date passed. Fixed with an explicit `plays_2026_08` partition plus a
  permanent `plays_default DEFAULT` partition as a safety net — verified
  both a same-day insert and a future-dated one land in the right place.
  Pre-creating each month's partition ahead of time (a scheduled job, same
  shape as the royalty run below) is recommended follow-up work, not
  built here — see the migration file's own comment for why it still
  matters with the default partition in place
- **One Postgres + one Cloud Run service** (asked for directly): Postgres
  was already a single Cloud SQL instance. On the Cloud Run side, folded
  web/player, web/dashboard, and the royalties job into the API's one
  service — the transcoder and Meilisearch stay separate, deliberately (see
  below for why). The repo-root `Dockerfile` (new — `services/api/Dockerfile`
  still exists, unchanged, for local `docker compose`) multi-stage-builds
  both SPAs and copies their `dist/` into the API image; `index.js` serves
  them at `/app` and `/dashboard` with an SPA fallback. `web/player`'s and
  `web/dashboard`'s `api/client.js` now default to a same-origin relative
  `API_BASE_URL` (`""`) when `VITE_API_BASE_URL` is unset, which is exactly
  the unset case for this consolidated build; local dev still sets it
  explicitly via `.env.local` since the Vite dev server and API run on
  different ports there. `lib/paydunya.js`'s return/cancel URLs got an
  `/app` prefix to match. The royalty computation moved to
  `services/api/lib/compute-royalties.js` (**formula unchanged** — see
  "what not to change" below) and is now called via `POST
  /internal/royalties/run` (`routes/internal.js`, guarded by an
  `X-Internal-Secret` header since Cloud Run's `--allow-unauthenticated`
  applies to the whole service, not per-route) instead of a separate Cloud
  Run Job; `services/royalties-job/` is kept only as a deprecated reference
  (deletion was blocked by a permission classifier mid-session — harmless
  to leave, clearly marked, not referenced by anything that still runs).
  The transcoder wasn't folded in because its resource profile
  (`--concurrency 1`, 2Gi/2 CPU, 900s timeout — FFmpeg saturates a CPU for
  minutes per track) would apply to the *entire* service if merged, forcing
  every ordinary API request through the same one-request-per-instance
  ceiling. Meilisearch wasn't folded in because it needs a persistent index
  on disk that survives restarts, which doesn't fit Cloud Run's
  ephemeral/scale-to-zero model. See root `DEPLOY.md`'s "One Cloud Run
  service" section and `services/api/DEPLOY.md` §6 for the deploy
  mechanics; `web/player/DEPLOY.md` / `web/dashboard/DEPLOY.md` still work
  as standalone alternatives if you want to scale either independently
  later

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
- Ownership checks reply 404 for "doesn't exist" AND "exists but not visible
  to you" on GET (don't leak existence via a 403/404 split), but 403 for
  "exists, not yours" on mutating routes (the caller already knows the id
  there, so 403 tells them nothing new) — see `playlists.js`'s detail GET
  vs its PATCH/DELETE/track routes for the pattern

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
form for every route across all nine routers, plus a client-side JWT
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

For the mobile app (Flutter, Android + iOS):
```
cd mobile && flutter pub get
flutter run --dart-define=API_BASE_URL=http://localhost:8080
```
Same no-login-yet situation — paste a token on the Session tab (stored via
`flutter_secure_storage`, not `localStorage`, but same idea). See
`mobile/README.md` for what was verified (`flutter analyze` + `flutter test`)
and what wasn't (no device/emulator run — no Android SDK/iOS toolchain in
the environment this was built in).

## What NOT to change without asking
- The royalty pool formula in `services/api/lib/compute-royalties.js` (pro-rata model, already reasoned through — moved here from `services/royalties-job/`, logic unchanged)
- The signed-URL / entitlement flow in `streaming.js` + `cdn-signer.js` (security-sensitive)
