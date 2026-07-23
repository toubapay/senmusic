# Deploying web/player

A static Vite build — no server needed. Hosted here as a public GCS bucket
behind Cloud CDN + a global HTTPS load balancer, consistent with the rest of
the stack's "GCS + Cloud CDN" storage layer (this bucket is public, unlike
the private HLS bucket — there's nothing sensitive in a compiled SPA).

If you'd rather skip the load-balancer setup, **Firebase Hosting** (also
GCP, under the same project) does steps 2-4 for you in one `firebase deploy`
— reasonable for a first deploy; switch to the GCS+LB path below once you
need it to share a load balancer with other GCP-native services.

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
