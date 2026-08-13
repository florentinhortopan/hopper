# Orchestrator API for Railway (Remotion + ffmpeg). Not used by Vercel.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y \
  ffmpeg \
  libnss3 \
  libdbus-1-3 \
  libatk1.0-0 \
  libgbm-dev \
  libasound2 \
  libxrandr2 \
  libxkbcommon-dev \
  libxfixes3 \
  libxcomposite1 \
  libxdamage1 \
  libatk-bridge2.0-0 \
  libpango-1.0-0 \
  libcairo2 \
  libcups2 \
  fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/orchestrator/package.json ./apps/orchestrator/
COPY packages/shared/package.json ./packages/shared/
COPY packages/remotion-template/package.json ./packages/remotion-template/

RUN pnpm install --frozen-lockfile --filter @attatta/orchestrator...

COPY apps/orchestrator ./apps/orchestrator
COPY packages ./packages
COPY comfy ./comfy
COPY tsconfig.base.json ./
COPY scripts/railway-entrypoint.sh ./scripts/railway-entrypoint.sh
RUN chmod +x ./scripts/railway-entrypoint.sh

# Lightweight seed for empty Railway volumes (indexes/tokens; no large media)
COPY data/tokens ./data-seed/tokens
COPY data/libraries ./data-seed/libraries

# Chrome Headless Shell for Remotion (cached in image)
RUN pnpm --filter @attatta/remotion-template exec remotion browser ensure

ENV NODE_ENV=production
ENV COMFY_WORKFLOWS_DIR=./comfy/workflows

EXPOSE 8787

CMD ["./scripts/railway-entrypoint.sh"]