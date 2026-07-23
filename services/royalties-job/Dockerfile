# Royalties computation — Cloud Run JOB (runs to completion, not a server)
FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY compute-royalties.js ./

CMD ["node", "compute-royalties.js"]
