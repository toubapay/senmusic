# Deploying web/dashboard

**This is now optional.** The default deploy path (`scripts/deploy-gcp.sh`,
or `services/api/DEPLOY.md` §6) builds this app into the API's own Cloud
Run image, served at `/dashboard` — no separate service, bucket, or LB
needed for it. Use this doc only if you want web/dashboard as its own
standalone deployment instead. Same shape as `web/player/DEPLOY.md` — see
that doc for the full command-by-command walkthrough of both standalone
hosting paths. The differences:

## No domain yet: Cloud Run

```bash
cd web/dashboard
API_URL=https://promusic-api-xxxxx.run.app   # the deployed API's URL
IMAGE=europe-west1-docker.pkg.dev/$PROJECT_ID/promusic/dashboard

gcloud auth configure-docker europe-west1-docker.pkg.dev
docker build --build-arg VITE_API_BASE_URL=$API_URL -t $IMAGE .
docker push $IMAGE

gcloud run deploy promusic-dashboard --image $IMAGE \
  --region europe-west1 --allow-unauthenticated
```

Then set `ARTIST_DASHBOARD_URL` on the API to the resulting
`promusic-dashboard` URL (see `services/api/DEPLOY.md`) — separate env var
from `APP_BASE_URL` (web/player's origin) because only web/player's origin
is also used for PayDunya's checkout redirect; this app has no checkout flow.

## Once there's a domain: GCS + Cloud CDN + load balancer

Same as `web/player/DEPLOY.md`'s GCS+CDN section, with a different
bucket/backend-bucket name and domain, e.g.:

```bash
gcloud storage buckets create gs://promusic-dashboard --location=europe-west1 \
  --uniform-bucket-level-access
# ...same rsync / backend-bucket / url-map / cert / proxy / forwarding-rule
# steps as web/player, substituting promusic-dashboard and
# dashboard.yourdomain.sn throughout.
```
