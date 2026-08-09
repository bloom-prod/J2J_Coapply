#!/bin/bash
# Apply pending Drizzle migrations to production and (optionally) dev Postgres.
#
# - Production (.env.local): runs in Docker on network `jobless` so DATABASE_URL
#   can use the jobless-db-prod hostname.
# - Dev Neon (.env.development.local): runs on the host with npx — Neon is
#   reachable over the public internet, no Docker network needed.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -s "${HOME}/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "${HOME}/.nvm/nvm.sh"
fi

run_bare_metal_migrate() {
  local env_file=$1
  local label=$2

  if [ ! -f "$env_file" ]; then
    echo "Skipping ${label} migrations (${env_file} not found)."
    return 0
  fi

  echo "Applying ${label} database migrations..."
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a

  if [ -z "${DATABASE_URL:-}" ]; then
    echo "WARNING: DATABASE_URL not set in ${env_file} — skipping ${label} migrations." >&2
    return 0
  fi

  npx drizzle-kit migrate
  echo "${label} database migrations complete."
}

if [ ! -f .env.local ]; then
  echo "ERROR: .env.local missing (need DATABASE_URL)" >&2
  exit 1
fi

echo "Applying production database migrations..."
docker run --rm \
  --network jobless \
  -v "$ROOT:/app" \
  -w /app \
  --env-file .env.local \
  node:20-alpine \
  sh -c "npm ci --ignore-scripts && npx drizzle-kit migrate"
echo "Production database migrations complete."

run_bare_metal_migrate .env.development.local "dev (Neon)"

echo "All database migrations complete."
