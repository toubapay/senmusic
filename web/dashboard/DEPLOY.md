# Deploying web/dashboard

Same shape as `web/player/DEPLOY.md` (a static Vite build, GCS + Cloud CDN +
load balancer) — see that doc for the full command-by-command walkthrough.
The differences:

## 1. Build

```bash
cd web/dashboard
npm install
echo "VITE_API_BASE_URL=https://api.yourdomain.sn" > .env.production
npm run build   # → dist/
```

## 2-3. Bucket + load balancer

Same as `web/player/DEPLOY.md` §2-3, with a different bucket/backend-bucket
name and domain, e.g.:

```bash
gcloud storage buckets create gs://promusic-dashboard --location=europe-west1 \
  --uniform-bucket-level-access
# ...same rsync / backend-bucket / url-map / cert / proxy / forwarding-rule
# steps as web/player, substituting promusic-dashboard and
# dashboard.yourdomain.sn throughout.
```

## 4. Point the API at this origin

Set `ARTIST_DASHBOARD_URL=https://dashboard.yourdomain.sn` on the API (see
`services/api/DEPLOY.md` step 6) — this is a separate env var from
`APP_BASE_URL` (web/player's origin) because only web/player's origin is
also used for PayDunya's checkout redirect; this app has no checkout flow.

## Redeploying

Same cache-invalidation note as `web/player/DEPLOY.md` — rsync the new
`dist/` then invalidate the CDN cache, or users keep getting the old build.
