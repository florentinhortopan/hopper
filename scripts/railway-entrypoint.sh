#!/bin/sh
set -e
# If the Railway volume is empty, seed tokens + empty library layout from the image.
if [ ! -f /app/data/tokens/brand_default_v3.json ] && [ -d /app/data-seed ]; then
  echo "Seeding empty volume from data-seed…"
  mkdir -p /app/data
  cp -a /app/data-seed/. /app/data/
fi
exec pnpm --filter @attatta/orchestrator start
