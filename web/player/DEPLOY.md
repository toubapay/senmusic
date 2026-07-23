# Deploying web/player

A static Vite build — no server needed. Two ways to host it:

## No domain yet: Cloud Run

The `Dockerfile` here builds the SPA and serves it with `serve -s` (handles
the SPA deep-link fallback itself, no load-balancer config needed) — gets a
working `https://....run.app` URL immediately, no domain/cert/LB required.
This is the path to use before a domain exists.

```bash
cd web/player
API_URL=https://promusic-api-xxxxx.run.app   # the deployed API's URL
IMAGE=europe-west1-docker.pkg.dev/$PROJECT_ID/promusic/player

gcloud auth configure-docker europe-west1-docker.pkg.dev
docker build --build-arg VITE_API_BASE_URL=$API_URL -t $IMAGE .
docker push $IMAGE

gcloud run deploy promusic-player --image $IMAGE \
  --region europe-west1 --allow-unauthenticated
```

(`gcloud builds submit --tag` also works if you'd rather not build locally,
but plain `docker build --build-arg` is the simplest way to get
`VITE_API_BASE_URL` baked in correctly — Cloud Build's buildpacks path
doesn't apply here since this repo has an explicit `Dockerfile`.)

Then set the API's `APP_BASE_URL` to the resulting `promusic-player` URL
(see `services/api/DEPLOY.md`) — same CORS + PayDunya-redirect role either
way, just a `*.run.app` origin instead of a custom domain for now.

## Once there's a domain: GCS + Cloud CDN + load balancer

More GCP-native, and consistent with the rest of the stack's "GCS + Cloud
CDN" storage layer (this bucket is public, unlike the private HLS bucket —
there's nothing sensitive in a compiled SPA). **Firebase Hosting** (also
GCP, same project) does steps 2-4 below for you in one `firebase deploy` if
you'd rather skip the load-balancer setup entirely.

## 1. Build

```bash
cd web/player
npm install
echo "VITE_API_BASE_URL=https://api.yourdomain.sn" > .env.production
npm run build   # → dist/
```

## 2. Bucket

```bash
gcloud storage buckets create gs://promusic-app --location=europe-west1 \
  --uniform-bucket-level-access
gcloud storage buckets add-iam-policy-binding gs://promusic-app \
  --member=allUsers --role=roles/storage.objectViewer

gcloud storage rsync dist gs://promusic-app --delete-unmatched-destination-objects
gcloud storage buckets update gs://promusic-app --web-main-page-suffix=index.html
```

The SPA does client-side routing (`react-router-dom`), so unknown paths
(e.g. `/subscribe` requested directly) need to fall back to `index.html`
rather than 404 — `--web-main-page-suffix` only covers the bucket root, so
the load balancer's URL map (step 3) is what actually makes deep links work.

## 3. Load balancer + Cloud CDN

```bash
gcloud compute backend-buckets create promusic-app-backend \
  --gcs-bucket-name=promusic-app --enable-cdn

gcloud compute url-maps create promusic-app-lb \
  --default-backend-bucket=promusic-app-backend
# Deep-link fallback: any path that isn't a real object serves index.html
gcloud compute url-maps add-path-matcher promusic-app-lb \
  --path-matcher-name=spa-fallback \
  --default-backend-bucket=promusic-app-backend \
  --backend-bucket-path-rules="/*=promusic-app-backend"

gcloud compute ssl-certificates create promusic-app-cert \
  --domains=app.yourdomain.sn

gcloud compute target-https-proxies create promusic-app-proxy \
  --url-map=promusic-app-lb --ssl-certificates=promusic-app-cert

gcloud compute forwarding-rules create promusic-app-fr \
  --global --target-https-proxy=promusic-app-proxy --ports=443
```

Point `app.yourdomain.sn`'s DNS at the forwarding rule's IP
(`gcloud compute forwarding-rules describe promusic-app-fr --global`).

## 4. Point the API at this origin

Set `APP_BASE_URL=https://app.yourdomain.sn` on the API (see
`services/api/DEPLOY.md` step 6) — it's both the CORS allowlist entry for
this app and PayDunya's checkout return/cancel base.

## Redeploying

```bash
npm run build
gcloud storage rsync dist gs://promusic-app --delete-unmatched-destination-objects
gcloud compute url-maps invalidate-cdn-cache promusic-app-lb --path "/*"
```

The cache invalidation matters — Cloud CDN will otherwise keep serving the
previous build's `index.html`/JS bundle to users for a while after a deploy.
