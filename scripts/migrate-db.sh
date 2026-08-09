#!/bin/bash
# Apply pending Drizzle migrations against the production Postgres instance.
# Runs inside Docker on network `jobless` so DATABASE_URL can use jobless-db-prod.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env.local ]; then
  echo "ERROR: .env.local missing (need DATABASE_URL)" >&2
  exit 1
fi

echo "Applying database migrations..."
docker run --rm \
  --network jobless \
  -v "$ROOT:/app" \
  -w /app \
  --env-file .env.local \
  node:20-alpine \
  sh -c "npm ci --ignore-scripts && npx drizzle-kit migrate"

echo "Database migrations complete."
