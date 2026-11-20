# Multi-stage build voor de TraderJourney web-app (standalone Next.js server).
# Bouwen:  docker build -t traderjourney:<versie> .
# Draaien: docker run -p 3000:3000 -v "$(pwd)/data:/data" traderjourney:<versie>

FROM node:22-slim AS build
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter web build

FROM node:22-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3-opencv python3-pil python3-tesserocr tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
COPY apps/web/scripts/read-position-levels.py ./apps/web/scripts/read-position-levels.py
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    JOURNAL_DATA_DIR=/data \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
VOLUME /data
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
