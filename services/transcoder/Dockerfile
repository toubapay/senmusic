# HLS Transcoding Worker — Cloud Run
FROM node:20-slim

# FFmpeg + ffprobe (the only system deps we need)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY index.js ./

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "index.js"]
