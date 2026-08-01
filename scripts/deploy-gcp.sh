#!/usr/bin/env bash
# End-to-end GCP deployment: Cloud SQL, buckets, secrets, IAM, transcoder,
# API, royalties job, and both web apps — on default *.run.app URLs (no
# custom domain). Run from the repo root, in an environment with gcloud +
# docker already available and authenticated (e.g. Cloud Shell).
#
# Skips, deliberately, because they need real values this script can't
# generate: PayDunya keys, the Cloud CDN signing key, and Meilisearch
# hosting. Search/streaming/checkout will correctly reach the API and fail
# there until those are added — see services/api/DEPLOY.md §3 and §5, and
# the root DEPLOY.md for the CDN + custom-domain path once you have one.
#
# Safe to re-run: every create step either no-ops or is followed by an
# update on failure.
#
# Usage:
#   PROJECT_ID=your-project REGION=europe-west1 ./scripts/deploy-gcp.sh

set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID, e.g. PROJECT_ID=my-project ./scripts/deploy-gcp.sh}"
REGION="${REGION:-europe-west1}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Project: $PROJECT_ID   Region: $REGION"
gcloud config set project "$PROJECT_ID" >/dev/null

echo "==> Enabling APIs"
gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  secretmanager.googleapis.com storage.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com \
  eventarc.googleapis.com pubsub.googleapis.com \
  cloudscheduler.googleapis.com iam.googleapis.com

echo "==> Artifact Registry for container images"
gcloud artifacts repositories describe promusic --location="$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create promusic \
    --repository-format=docker --location="$REGION" \
    --description="ProMusic service images"
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet

# ------------------------------------------------------------
# Cloud SQL
# ------------------------------------------------------------
echo "==> Cloud SQL instance (this step takes several minutes on first run)"
if ! gcloud sql instances describe promusic-db >/dev/null 2>&1; then
  DB_PASSWORD="$(openssl rand -base64 24)"
  gcloud sql instances create promusic-db \
    --database-version=POSTGRES_16 --region="$REGION" \
    --tier=db-g1-small --storage-auto-increase
  gcloud sql databases create promusic --instance=promusic-db
  gcloud sql users create promusic --instance=promusic-db --password="$DB_PASSWORD"
  echo "$DB_PASSWORD" > .db-password.txt
  echo "==> DB password saved to .db-password.txt (gitignored) — keep it"
else
  echo "==> promusic-db already exists, skipping create"
  if [ ! -f .db-password.txt ]; then
    echo "!! promusic-db exists but .db-password.txt is missing — schema load below will fail without it."
    echo "!! Reset the promusic user's password with: gcloud sql users set-password promusic --instance=promusic-db --password=NEW_PASSWORD"
    echo "!! then put NEW_PASSWORD in .db-password.txt and re-run."
  fi
fi
DB_PASSWORD="$(cat .db-password.txt)"
INSTANCE_CONNECTION_NAME="$(gcloud sql instances describe promusic-db --format='value(connectionName)')"
echo "==> Instance connection name: $INSTANCE_CONNECTION_NAME"

echo "==> Applying schema + migrations via Cloud SQL Auth Proxy"
command -v cloud-sql-proxy >/dev/null 2>&1 || gcloud components install cloud-sql-proxy --quiet
cloud-sql-proxy "$INSTANCE_CONNECTION_NAME" &
PROXY_PID=$!
trap 'kill $PROXY_PID 2>/dev/null || true' EXIT
sleep 5
PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U promusic -d promusic -v ON_ERROR_STOP=0 -f db/schema.sql
PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U promusic -d promusic -v ON_ERROR_STOP=0 -f db/migrations/001_offline_downloads.sql
PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U promusic -d promusic -v ON_ERROR_STOP=0 -f db/migrations/002_play_count_applied.sql
PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U promusic -d promusic -v ON_ERROR_STOP=0 -f db/migrations/003_plays_partitions.sql
kill "$PROXY_PID" 2>/dev/null || true
trap - EXIT

# ------------------------------------------------------------
# Buckets
# ------------------------------------------------------------
ORIGINALS_BUCKET="promusic-originals-$PROJECT_ID"
HLS_BUCKET="promusic-hls-$PROJECT_ID"
echo "==> GCS buckets: $ORIGINALS_BUCKET, $HLS_BUCKET (private)"
gcloud storage buckets describe "gs://$ORIGINALS_BUCKET" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$ORIGINALS_BUCKET" --location="$REGION" --uniform-bucket-level-access
gcloud storage buckets describe "gs://$HLS_BUCKET" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$HLS_BUCKET" --location="$REGION" --uniform-bucket-level-access

# ------------------------------------------------------------
# Secrets — JWT/session only. PayDunya + CDN key deferred (need real values).
# ------------------------------------------------------------
echo "==> Secrets"
put_secret() {
  local name="$1" value="$2"
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null
  else
    printf '%s' "$value" | gcloud secrets create "$name" --data-file=- >/dev/null
  fi
}
put_secret jwt-secret "$(openssl rand -base64 48)"
put_secret stream-token-secret "$(openssl rand -base64 48)"
put_secret database-url "postgres://promusic:$DB_PASSWORD@/promusic?host=/cloudsql/$INSTANCE_CONNECTION_NAME"

# ------------------------------------------------------------
# Service account + IAM
# ------------------------------------------------------------
echo "==> API service account + IAM"
SA_EMAIL="promusic-api@$PROJECT_ID.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1 || \
  gcloud iam service-accounts create promusic-api --display-name="ProMusic API"

for role in roles/cloudsql.client roles/secretmanager.secretAccessor roles/storage.objectAdmin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" --role="$role" --condition=None >/dev/null
done

# Signed URLs (artist uploads, offline downloads) need this — the service
# account signs as itself via IAM signBlob since there's no key file.
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --member="serviceAccount:$SA_EMAIL" --role="roles/iam.serviceAccountTokenCreator" >/dev/null

# ------------------------------------------------------------
# Transcoder
# ------------------------------------------------------------
echo "==> Deploying transcoder"
gcloud run deploy promusic-transcoder \
  --source services/transcoder \
  --region "$REGION" \
  --no-allow-unauthenticated \
  --memory 2Gi --cpu 2 --timeout 900 --concurrency 1 --max-instances 10 \
  --set-env-vars "ORIGINALS_BUCKET=$ORIGINALS_BUCKET,HLS_BUCKET=$HLS_BUCKET" \
  --set-secrets DATABASE_URL=database-url:latest

echo "==> Eventarc trigger: GCS upload -> transcoder"
gcloud iam service-accounts describe "eventarc-trigger@$PROJECT_ID.iam.gserviceaccount.com" >/dev/null 2>&1 || \
  gcloud iam service-accounts create eventarc-trigger
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:eventarc-trigger@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker" --condition=None >/dev/null

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:service-$PROJECT_NUMBER@gs-project-accounts.iam.gserviceaccount.com" \
  --role="roles/pubsub.publisher" --condition=None >/dev/null

echo "==> Waiting 60s for IAM propagation before creating the trigger"
sleep 60

gcloud eventarc triggers describe on-track-upload --location="$REGION" >/dev/null 2>&1 || \
  gcloud eventarc triggers create on-track-upload \
    --location="$REGION" \
    --destination-run-service=promusic-transcoder \
    --destination-run-region="$REGION" \
    --event-filters="type=google.cloud.storage.object.v1.finalized" \
    --event-filters="bucket=$ORIGINALS_BUCKET" \
    --service-account="eventarc-trigger@$PROJECT_ID.iam.gserviceaccount.com"

# ------------------------------------------------------------
# API
# ------------------------------------------------------------
echo "==> Deploying API"
gcloud run deploy promusic-api \
  --source services/api \
  --region "$REGION" \
  --service-account "$SA_EMAIL" \
  --add-cloudsql-instances "$INSTANCE_CONNECTION_NAME" \
  --allow-unauthenticated \
  --set-env-vars "ORIGINALS_BUCKET=$ORIGINALS_BUCKET,HLS_BUCKET=$HLS_BUCKET" \
  --set-secrets DATABASE_URL=database-url:latest,JWT_SECRET=jwt-secret:latest,STREAM_TOKEN_SECRET=stream-token-secret:latest

API_URL="$(gcloud run services describe promusic-api --region "$REGION" --format='value(status.url)')"
echo "==> API deployed: $API_URL"
curl -sf "$API_URL/healthz" && echo " <- healthz OK" || echo "!! healthz check failed"

echo "==> Setting API_BASE_URL on promusic-api to its own URL (streaming.js master-playlist rewrite + paydunya.js webhook callback both need it)"
gcloud run services update promusic-api --region "$REGION" \
  --update-env-vars "API_BASE_URL=$API_URL" >/dev/null

# ------------------------------------------------------------
# Royalties job
# ------------------------------------------------------------
echo "==> Royalties Cloud Run job + monthly scheduler"
if gcloud run jobs describe promusic-royalties --region "$REGION" >/dev/null 2>&1; then
  gcloud run jobs update promusic-royalties \
    --source services/royalties-job --region "$REGION" \
    --set-env-vars ARTIST_SHARE=0.60 --set-secrets DATABASE_URL=database-url:latest
else
  gcloud run jobs create promusic-royalties \
    --source services/royalties-job --region "$REGION" \
    --set-env-vars ARTIST_SHARE=0.60 --set-secrets DATABASE_URL=database-url:latest
fi

gcloud iam service-accounts describe "scheduler@$PROJECT_ID.iam.gserviceaccount.com" >/dev/null 2>&1 || \
  gcloud iam service-accounts create scheduler --display-name="Cloud Scheduler runner"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:scheduler@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker" --condition=None >/dev/null

gcloud scheduler jobs describe royalties-monthly --location="$REGION" >/dev/null 2>&1 || \
  gcloud scheduler jobs create http royalties-monthly \
    --location="$REGION" \
    --schedule "0 4 2 * *" --time-zone "Africa/Dakar" \
    --uri "https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/jobs/promusic-royalties:run" \
    --oauth-service-account-email "scheduler@$PROJECT_ID.iam.gserviceaccount.com" \
    --http-method POST

# ------------------------------------------------------------
# Web apps — built with VITE_API_BASE_URL baked in (Vite is build-time only)
# ------------------------------------------------------------
echo "==> Building + deploying web/player"
PLAYER_IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/promusic/player"
docker build --build-arg VITE_API_BASE_URL="$API_URL" -t "$PLAYER_IMAGE" web/player
docker push "$PLAYER_IMAGE"
gcloud run deploy promusic-player --image "$PLAYER_IMAGE" --region "$REGION" --allow-unauthenticated
PLAYER_URL="$(gcloud run services describe promusic-player --region "$REGION" --format='value(status.url)')"

echo "==> Building + deploying web/dashboard"
DASHBOARD_IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/promusic/dashboard"
docker build --build-arg VITE_API_BASE_URL="$API_URL" -t "$DASHBOARD_IMAGE" web/dashboard
docker push "$DASHBOARD_IMAGE"
gcloud run deploy promusic-dashboard --image "$DASHBOARD_IMAGE" --region "$REGION" --allow-unauthenticated
DASHBOARD_URL="$(gcloud run services describe promusic-dashboard --region "$REGION" --format='value(status.url)')"

echo "==> Wiring CORS: API now allows both web app origins"
gcloud run services update promusic-api --region "$REGION" \
  --update-env-vars "APP_BASE_URL=$PLAYER_URL,ARTIST_DASHBOARD_URL=$DASHBOARD_URL" >/dev/null

cat <<SUMMARY

==================================================
API:        $API_URL
Player:     $PLAYER_URL
Dashboard:  $DASHBOARD_URL
DB password: saved in .db-password.txt (gitignored) — keep it somewhere safe

Still needed before these work fully (see services/api/DEPLOY.md):
  - PayDunya keys (checkout/subscriptions)
  - CDN signing key + a domain (actual audio streaming)
  - Meilisearch hosting (search)
==================================================
SUMMARY
