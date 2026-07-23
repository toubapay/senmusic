# Deploying web/dashboard

Not deployable yet — `ArtistUpload.jsx` is a loose component with no app
shell around it (no `package.json`, no build tool, no routing, no way to
get a session token in). `web/player` was in exactly this state before it
became a real Vite app; use it as the template (`../player/package.json`,
`vite.config.js`, `src/main.jsx`) to build this one out, then its own
GCS + Cloud CDN + load balancer setup is the same shape as
`../player/DEPLOY.md`, just:

- a different bucket/backend-bucket/domain (e.g. `dashboard.yourdomain.sn`)
- the API's `ARTIST_DASHBOARD_URL` (not `APP_BASE_URL`) set to that origin
  for CORS — see `services/api/index.js` and `.env.example`
