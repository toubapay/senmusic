# Deploying ProMusic to Google Cloud

Every piece targets GCP already (see `CLAUDE.md`'s Stack section): Cloud Run
for compute, Cloud SQL for Postgres, GCS + Cloud CDN for storage/delivery,
Eventarc for the transcode trigger, Cloud Scheduler for the royalties job.
This is the order that avoids circular dependencies (e.g. the API needs the
Cloud SQL instance and buckets to exist before it can deploy).

1. **Cloud SQL + schema** — `services/api/DEPLOY.md` §1
2. **GCS buckets + Cloud CDN signed-URL key** — `services/transcoder/DEPLOY.md`
   §1 (buckets) and the header comment in `services/api/lib/cdn-signer.js`
   (CDN backend bucket + key)
3. **Meilisearch** — `services/api/DEPLOY.md` §5 (not a managed GCP product;
   run it yourself or use Meilisearch Cloud)
4. **Transcoder** — `services/transcoder/DEPLOY.md` in full (service +
   Eventarc trigger)
5. **API** — `services/api/DEPLOY.md` §3-7 (secrets, IAM, deploy, domain)
6. **Royalties job** — `services/royalties-job/compute-royalties.js`'s header
   comment has the `gcloud run jobs create` + `gcloud scheduler jobs create`
   commands; it needs the same `DATABASE_URL` secret as the API
7. **web/player** — `web/player/DEPLOY.md` (needs the API's URL from step 5
   for its build, and its own URL feeds back into the API's `APP_BASE_URL`)
8. **web/dashboard** — not buildable yet; see `web/dashboard/DEPLOY.md`

## Cross-cutting things worth knowing before you start

- **One region.** All the docs above use `europe-west1`. Cross-region
  Cloud Run ↔ Cloud SQL ↔ GCS traffic works, but adds latency and egress
  cost for no benefit here — keep everything in one region.
- **CORS is origin-based, not domain-based.** `services/api/index.js` reads
  `APP_BASE_URL` and `ARTIST_DASHBOARD_URL` as exact-match allowed origins.
  Get either wrong (wrong scheme, trailing slash, wrong subdomain) and the
  browser blocks every request from that frontend with no server-side error
  to grep for — check these two env vars first if a deployed web app can
  talk to nothing but the API itself works from `curl`.
- **Signed URLs need `iam.serviceAccountTokenCreator` on Cloud Run.** Covered
  in `services/api/DEPLOY.md` §4 — easy to miss because everything except
  uploads/downloads works fine without it.
- **Nothing here is idempotent-deploy tooling.** These are `gcloud` runbooks,
  not Terraform/Pulumi. Re-running a `create` command fails on a resource
  that already exists; that's expected, not a bug in the docs.
