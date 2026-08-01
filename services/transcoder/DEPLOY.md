# Deploying the HLS Transcoder

## 1. Buckets

GCS bucket names are globally unique across *all* of GCP, not just your
project — plain names like `promusic-originals` will likely already be
taken by someone else. Suffix with your project ID (same convention
`scripts/deploy-gcp.sh` uses):

```bash
gcloud storage buckets create gs://promusic-originals-$PROJECT_ID --location=europe-west1
gcloud storage buckets create gs://promusic-hls-$PROJECT_ID --location=europe-west1
```

The HLS bucket stays **private** — streaming goes through Cloud CDN with signed URLs, never direct public access.

## 2. Build & deploy the service

```bash
gcloud run deploy hls-transcoder \
  --source . \
  --region europe-west1 \
  --no-allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 900 \
  --concurrency 1 \
  --max-instances 10 \
  --set-env-vars ORIGINALS_BUCKET=promusic-originals-$PROJECT_ID,HLS_BUCKET=promusic-hls-$PROJECT_ID \
  --set-secrets DATABASE_URL=music-db-url:latest
```

Key settings:
- `--concurrency 1` — one transcode per instance; FFmpeg saturates the CPU
- `--timeout 900` — long tracks / slow uploads need headroom
- `--memory 2Gi` — /tmp is in-memory on Cloud Run; a WAV original + HLS output can hit hundreds of MB

## 3. Wire up Eventarc (GCS upload → transcoder)

```bash
# Service account for the trigger
gcloud iam service-accounts create eventarc-trigger

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:eventarc-trigger@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker"

# GCS publishes via Pub/Sub — grant it
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:service-$PROJECT_NUMBER@gs-project-accounts.iam.gserviceaccount.com" \
  --role="roles/pubsub.publisher"

gcloud eventarc triggers create on-track-upload \
  --location=europe-west1 \
  --destination-run-service=hls-transcoder \
  --destination-run-region=europe-west1 \
  --event-filters="type=google.cloud.storage.object.v1.finalized" \
  --event-filters="bucket=promusic-originals-$PROJECT_ID" \
  --service-account="eventarc-trigger@$PROJECT_ID.iam.gserviceaccount.com"
```

## 4. Upload convention (from your API)

When an artist uploads a track, your API should:

1. `INSERT INTO tracks (...) VALUES (...)` with `status = 'processing'` → get `trackId`
2. Issue a **resumable signed upload URL** for `originals/{trackId}/{filename}`
3. The client uploads directly to GCS (never through your API — saves bandwidth)
4. Eventarc fires automatically → transcoder runs → `status` flips to `'ready'`
5. The app polls `GET /tracks/{id}` or listens on a websocket for the status change

## 5. Test it end to end

```bash
TRACK_ID=$(uuidgen | tr 'A-Z' 'a-z')
# insert a matching row in tracks first, then:
gcloud storage cp test-song.wav gs://promusic-originals-$PROJECT_ID/originals/$TRACK_ID/test-song.wav

# watch the logs
gcloud run services logs tail hls-transcoder --region europe-west1
```

Expected result in `gs://promusic-hls-$PROJECT_ID/hls/{trackId}/`:

```
master.m3u8
v64k/playlist.m3u8   v64k/seg_0000.ts ...
v128k/playlist.m3u8  v128k/seg_0000.ts ...
v256k/playlist.m3u8  v256k/seg_0000.ts ...
```
