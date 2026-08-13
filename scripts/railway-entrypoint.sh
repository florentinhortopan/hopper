#!/bin/sh
set -e
# Merge image seed into the Railway volume when files are missing.
# Partial volumes (campaigns present, tokens empty) must still get brand packs.
SEED=/app/data-seed
DATA=/app/data

mkdir -p "$DATA/tokens" "$DATA/libraries"

if [ -d "$SEED" ]; then
  if [ -d "$SEED/tokens" ]; then
    for f in "$SEED/tokens"/*.json; do
      [ -f "$f" ] || continue
      base=$(basename "$f")
      if [ ! -f "$DATA/tokens/$base" ]; then
        echo "Seeding token pack $base…"
        cp -a "$f" "$DATA/tokens/$base"
      fi
    done
  fi
  # Library layout only when the volume has never been seeded
  if [ -d "$SEED/libraries" ] && [ ! -f "$DATA/libraries/index.json" ]; then
    echo "Seeding library layout from data-seed…"
    cp -a "$SEED/libraries/." "$DATA/libraries/"
  fi
fi

if [ ! -f "$DATA/tokens/brand_default_v3.json" ]; then
  echo "WARN: brand_default_v3.json still missing after seed — orchestrator will write embedded default"
fi

exec pnpm --filter @attatta/orchestrator start
