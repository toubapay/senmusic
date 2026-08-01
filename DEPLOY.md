# Deploying ProMusic to Google Cloud

Every piece targets GCP already (see `CLAUDE.md`'s Stack section): one
Cloud Run service for the API **and both web apps** (consolidated — see
"One Cloud Run service" below), Cloud SQL for Postgres (also one instance),
GCS + Cloud CDN for storage/delivery, Eventarc for the transcode trigger
(its own Cloud Run service), Cloud Scheduler calling into the API for the
monthly royalty run.

## Fast path: `scripts/deploy-gcp.sh`

Runs everything below in order, on default `*.run.app` URLs (no domain
needed yet), and is safe to re-run if a step fails partway through. Needs
`gcloud` + `docker` already authenticated — Cloud Shell has both.

```bash
PROJECT_ID=your-project-id ./scripts/deploy-gcp.sh
```

It deliberately skips PayDunya keys, the CDN signing key, and Meilisearch
hosting — those need real values/infra decisions it can't make for you (see
§3 and §5 below). Search/streaming/checkout correctly reach the API and
fail there until those exist, same as everywhere else this was verified
locally in this repo's history.

## One Cloud Run service for the API + both web apps

`services/api` is the only *server*; `web/player` and `web/dashboard` are
static SPA builds. Rather than three separate Cloud Run services, the
repo-root `Dockerfile` builds both SPAs and copies their `dist/` output
into the API image, served at `/app` and `/dashboard` respectively
(`services/api/index.js`). One Postgres (Cloud SQL) + one Cloud Run service
covers the whole listener/artist-facing surface; only the transcoder (a
genuinely different compute profile — see its own `DEPLOY.md`) and
Meilisearch (needs persistent disk, doesn't fit Cloud Run's ephemeral model)
stay separate. Deploy with `--source .` from the repo root, not
`--source services/api` — the build needs to see `web/player/` and
`web/dashboard/` too. Local dev is unaffected: `docker-compose.yml` still
builds the API alone, and both web apps still run via their own
`npm run dev` (see CLAUDE.md's build/test commands) — this consolidation is
a production build-time thing only.

The royalty computation moved the same way: `services/api/lib/compute-royalties.js`
(formula unchanged) is called via `POST /internal/royalties/run`
(`services/api/routes/internal.js`, guarded by an `X-Internal-Secret`
header) instead of running as a separate Cloud Run Job.

## Manual path, or to understand what the script does

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
5. **API + web/player + web/dashboard** — `services/api/DEPLOY.md` §3-7
   (secrets including `INTERNAL_SECRET`, IAM, the consolidated `--source .`
   deploy, domain). This one deploy also serves both web apps — see "One
   Cloud Run service" above. `web/player/DEPLOY.md` / `web/dashboard/DEPLOY.md`
   still exist if you'd rather run either as its own standalone Cloud Run
   service or GCS+CDN static site instead (e.g. to scale it independently
   later); the consolidated path is the default.
6. **Royalties** — a Cloud Scheduler HTTP job calling the deployed API's
   `POST /internal/royalties/run` with an `X-Internal-Secret` header; see
   `services/api/DEPLOY.md` §6 for the exact command.

## Cross-cutting things worth knowing before you start

- **One region.** All the docs above use `europe-west1`. Cross-region
  Cloud Run ↔ Cloud SQL ↔ GCS traffic works, but adds latency and egress
  cost for no benefit here — keep everything in one region.
- **CORS is origin-based, not domain-based.** `services/api/index.js` reads
  `APP_BASE_URL` and `ARTIST_DASHBOARD_URL` as exact-match allowed origins.
  In the consolidated deploy both now equal the API's own URL (same-origin,
  since `/app`/`/dashboard` are served from this same service) — CORS is
  mostly moot for them there, but the vars still matter for PayDunya's
  return/cancel redirect (`APP_BASE_URL`, with an `/app` path prefix — see
  `lib/paydunya.js`). If you deploy either web app standalone instead (its
  own `DEPLOY.md`), set these back to that app's own origin — get it wrong
  (wrong scheme, trailing slash, wrong subdomain) and the browser blocks
  every request from that frontend with no server-side error to grep for.
- **Signed URLs need `iam.serviceAccountTokenCreator` on Cloud Run.** Covered
  in `services/api/DEPLOY.md` §4 — easy to miss because everything except
  uploads/downloads works fine without it.
- **Nothing here is idempotent-deploy tooling.** These are `gcloud` runbooks,
  not Terraform/Pulumi. Re-running a `create` command fails on a resource
  that already exists; that's expected, not a bug in the docs.
