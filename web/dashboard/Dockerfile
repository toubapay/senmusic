# Cloud Run static hosting for the SPA build. Vite bakes VITE_API_BASE_URL
# into the JS bundle at BUILD time, not runtime, so it has to arrive as a
# build arg here — a Cloud Run env var set after deploy would have no effect.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM node:20-slim
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/dist ./dist
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "serve -s dist -l ${PORT}"]
