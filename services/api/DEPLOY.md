# Deploying the API (+ web/player + web/dashboard) to Cloud Run

This is one consolidated Cloud Run service: the API plus both web SPAs,
built together from the **repo-root** `Dockerfile` (not `services/api/Dockerfile`,
which is only for local `docker compose`) and served at `/`, `/app`, and
`/dashboard` respectively. Run §6's deploy command from the repo root, not
from `services/api/` like the rest of this doc's commands — the build needs
to see `web/player/` and `web/dashboard/` too. See root `DEPLOY.md`'s "One
Cloud Run service" section for why, and `web/player/DEPLOY.md` /
`web/dashboard/DEPLOY.md` if you'd rather deploy either standalone instead.

Assumes `gcloud` is authenticated and `gcloud config set project $PROJECT_ID`
is already set. Region used throughout: `europe-west1` (same as the
transcoder — see `services/transcoder/DEPLOY.md`; keep every Cloud Run
service, Cloud SQL instance, and bucket in one region to avoid cross-region
egress).

```bash
gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  secretmanager.googleapis.com storage.googleapis.com
```

## 1. Cloud SQL (Postgres)

```bash
gcloud sql instances create promusic-db \
  --database-version=POSTGRES_16 \
  --region=europe-west1 \
  --tier=db-g1-small \
  --storage-auto-increase

gcloud sql databases create promusic --instance=promusic-db
gcloud sql users create promusic --instance=promusic-db --password="$DB_PASSWORD"

INSTANCE_CONNECTION_NAME=$(gcloud sql instances describe promusic-db \
  --format='value(connectionName)')
```

Apply the schema and both migrations once, via the Cloud SQL Auth Proxy:

```bash
cloud-sql-proxy "$INSTANCE_CONNECTION_NAME" &
PGPASSWORD=$DB_PASSWORD psql -h 127.0.0.1 -U promusic -d promusic -f ../../db/schema.sql
PGPASSWORD=$DB_PASSWORD psql -h 127.0.0.1 -U promusic -d promusic -f ../../db/migrations/001_offline_downloads.sql
PGPASSWORD=$DB_PASSWORD psql -h 127.0.0.1 -U promusic -d promusic -f ../../db/migrations/002_play_count_applied.sql
PGPASSWORD=$DB_PASSWORD psql -h 127.0.0.1 -U promusic -d promusic -f ../../db/migrations/003_plays_partitions.sql
```

## 2. Buckets + Cloud CDN

Create `ORIGINALS_BUCKET`/`HLS_BUCKET` and the transcoder service exactly as
in `services/transcoder/DEPLOY.md` — this API reads/writes the same two
buckets. Set up the Cloud CDN backend bucket + signed-URL key exactly as
described in the header comment of `lib/cdn-signer.js`.

## 3. Secrets

```bash
printf '%s' "$(openssl rand -base64 48)" | gcloud secrets create jwt-secret --data-file=-
printf '%s' "$(openssl rand -base64 48)" | gcloud secrets create stream-token-secret --data-file=-
# Guards POST /internal/royalties/run (routes/internal.js) — see §6's
# royalties note; Cloud Scheduler sends this back as a header.
printf '%s' "$(openssl rand -base64 32)" | gcloud secrets create internal-secret --data-file=-
printf '%s' "$CDN_KEY_B64"                | gcloud secrets create cdn-key-b64 --data-file=-
printf '%s' "$PAYDUNYA_MASTER_KEY"        | gcloud secrets create paydunya-master-key --data-file=-
printf '%s' "$PAYDUNYA_PRIVATE_KEY"       | gcloud secrets create paydunya-private-key --data-file=-
printf '%s' "$PAYDUNYA_TOKEN"             | gcloud secrets create paydunya-token --data-file=-

# Unix-socket form — no host/port, Cloud Run mounts the instance at /cloudsql
printf 'postgres://promusic:%s@/promusic?host=/cloudsql/%s' \
  "$DB_PASSWORD" "$INSTANCE_CONNECTION_NAME" | gcloud secrets create database-url --data-file=-
```

## 4. Service account + IAM

```bash
gcloud iam service-accounts create promusic-api

for role in roles/cloudsql.client roles/secretmanager.secretAccessor roles/storage.objectAdmin; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:promusic-api@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="$role"
done
```

**Signed-URL gotcha:** `artist-uploads.js` and `offline.js` call
`file.getSignedUrl()`. On Cloud Run, with no `GOOGLE_APPLICATION_CREDENTIALS`
key file (the recommended setup — don't ship a key file in the image), the
client library signs V4 URLs via the IAM `signBlob` API using the runtime
service account's own identity. That means the service account needs
permission to sign as itself:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  promusic-api@$PROJECT_ID.iam.gserviceaccount.com \
  --member="serviceAccount:promusic-api@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"
```

Skip this and every `POST /v1/artist/tracks` / `POST /v1/offline/downloads`
call fails with a permissions error from `signBlob`, while everything else
(search, plays, subscriptions) works fine — an easy thing to miss in testing.

## 5. Meilisearch

Not a managed GCP product. Two reasonable options:

- **Compute Engine e2-small + persistent disk** (matches the sizing note in
  `lib/meili.js`): run the `getmeili/meilisearch` Docker image with the disk
  mounted at Meilisearch's data dir, put it on a private IP, and reach it
  from Cloud Run via a
  [Serverless VPC Access connector](https://cloud.google.com/run/docs/configuring/connecting-vpc)
  — don't expose it publicly, since anyone with the URL could otherwise
  read/write the index.
- **Meilisearch Cloud** (their managed SaaS) — no infra to run, but data
  leaves your GCP project.

Either way, set `MEILI_HOST` / `MEILI_API_KEY` accordingly and run
`node -e 'import("./lib/meili.js").then(m => m.reindexAll())'` once against
production to build the indexes and settings.

## 6. Deploy

Run this from the **repo root** (`cd ../..` first if you've been following
along from `services/api/`) — `--source .` here means the whole repo, so
the root `Dockerfile` can build `web/player` and `web/dashboard` alongside
the API:

```bash
gcloud run deploy promusic-api \
  --source . \
  --region europe-west1 \
  --service-account promusic-api@$PROJECT_ID.iam.gserviceaccount.com \
  --add-cloudsql-instances "$INSTANCE_CONNECTION_NAME" \
  --allow-unauthenticated \
  --set-env-vars ORIGINALS_BUCKET=promusic-originals-$PROJECT_ID,HLS_BUCKET=promusic-hls-$PROJECT_ID,API_BASE_URL=https://api.yourdomain.sn,APP_BASE_URL=https://api.yourdomain.sn,ARTIST_DASHBOARD_URL=https://api.yourdomain.sn,CDN_BASE_URL=https://cdn.yourdomain.sn,CDN_KEY_NAME=stream-key-1,MEILI_HOST=$MEILI_HOST,PAYDUNYA_MODE=live \
  --set-secrets DATABASE_URL=database-url:latest,JWT_SECRET=jwt-secret:latest,STREAM_TOKEN_SECRET=stream-token-secret:latest,INTERNAL_SECRET=internal-secret:latest,CDN_KEY_B64=cdn-key-b64:latest,PAYDUNYA_MASTER_KEY=paydunya-master-key:latest,PAYDUNYA_PRIVATE_KEY=paydunya-private-key:latest,PAYDUNYA_TOKEN=paydunya-token:latest
```

`--allow-unauthenticated` is correct here (unlike the transcoder): this
service is the public API every client talks to, and now also serves
`web/player` at `/app` and `web/dashboard` at `/dashboard`. Auth is
enforced per-route by `requireAuth` (`lib/auth.js`) for the API and by the
`X-Internal-Secret` header for `/internal/*` (see below), not at the Cloud
Run/IAM layer. `APP_BASE_URL`/`ARTIST_DASHBOARD_URL` both equal
`API_BASE_URL` above because they're the same origin now — if you deploy
either web app standalone instead (`web/player/DEPLOY.md` /
`web/dashboard/DEPLOY.md`), point these at that app's own origin instead.

### Royalties (replaces the old standalone Cloud Run job)

```bash
gcloud scheduler jobs create http royalties-monthly \
  --location europe-west1 \
  --schedule "0 4 2 * *" --time-zone "Africa/Dakar" \
  --uri "https://api.yourdomain.sn/internal/royalties/run" \
  --http-method POST \
  --headers "X-Internal-Secret=$(gcloud secrets versions access latest --secret=internal-secret),Content-Type=application/json" \
  --message-body "{}"
```

Runs at 04:00 on the 2nd of each month for the month just ended, calling
`POST /internal/royalties/run` (`routes/internal.js`), which runs
`lib/compute-royalties.js` — same formula as the original
`services/royalties-job/compute-royalties.js` (now deprecated, kept only
for reference), just invoked in-process instead of as a separate job.

## 7. Domain + verify

```bash
gcloud run domain-mappings create --service promusic-api \
  --domain api.yourdomain.sn --region europe-west1

curl https://api.yourdomain.sn/healthz
```

If `APP_BASE_URL`/`ARTIST_DASHBOARD_URL` are wrong, requests from the deployed
web apps fail as CORS errors in the browser console, not as API errors —
check those two env vars first if a deployed frontend can't reach the API
but `curl`/the test console can. In the consolidated setup this mostly
applies only if you've split a web app back out to its own origin; visit
`https://api.yourdomain.sn/app` and `/dashboard` to verify both SPAs
themselves loaded correctly from this one service.
