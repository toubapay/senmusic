# Consolidated production image: the API plus both web SPAs, served from
# one Cloud Run service (see the "one Postgres + one Cloud Run" discussion
# in CLAUDE.md). Build context must be the repo root, e.g.:
#   gcloud run deploy promusic-api --source .
# Local dev is unaffected — it still runs services/api/Dockerfile alone via
# docker-compose, and both web apps via their own `npm run dev`.

# --- web/player, served at /app ---
FROM node:20-slim AS player-build
WORKDIR /web/player
COPY web/player/package.json web/player/package-lock.json* ./
RUN npm install
COPY web/player/. .
# No VITE_API_BASE_URL build-arg: unset means same-origin relative requests
# (see web/player/src/api/client.js) — correct once served from this image.
RUN npm run build -- --base=/app/

# --- web/dashboard, served at /dashboard ---
FROM node:20-slim AS dashboard-build
WORKDIR /web/dashboard
COPY web/dashboard/package.json web/dashboard/package-lock.json* ./
RUN npm install
COPY web/dashboard/. .
RUN npm run build -- --base=/dashboard/

# --- the API, serving both SPA builds as static files ---
FROM node:20-slim
WORKDIR /app
COPY services/api/package.json ./
RUN npm install --omit=dev
COPY services/api/. .
COPY --from=player-build /web/player/dist ./public/app
COPY --from=dashboard-build /web/dashboard/dist ./public/dashboard
ENV PORT=8080
EXPOSE 8080
CMD ["node", "index.js"]
