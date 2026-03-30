#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-$ROOT_DIR/deploy/production/backend.env}"
FRONTEND_ENV_FILE="${FRONTEND_ENV_FILE:-$ROOT_DIR/deploy/production/frontend.env}"

require_file() {
  local file_path="$1"
  if [[ ! -f "$file_path" ]]; then
    echo "Missing required file: $file_path"
    exit 1
  fi
}

load_env() {
  local file_path="$1"
  set -a
  # shellcheck disable=SC1090
  source "$file_path"
  set +a
}

require_file "$BACKEND_ENV_FILE"
require_file "$FRONTEND_ENV_FILE"

mkdir -p "$ROOT_DIR/logs" "$ROOT_DIR/uploads" "$ROOT_DIR/sessions"

if [[ ! -e "$ROOT_DIR/.wwebjs_auth" ]]; then
  ln -s "$ROOT_DIR/sessions" "$ROOT_DIR/.wwebjs_auth"
fi

pushd "$ROOT_DIR/backend" >/dev/null
npm ci --include=dev
npx prisma generate
npm run build
popd >/dev/null

pushd "$ROOT_DIR/frontend" >/dev/null
npm ci --include=dev
load_env "$FRONTEND_ENV_FILE"
npm run build
popd >/dev/null

load_env "$BACKEND_ENV_FILE"
pushd "$ROOT_DIR/backend" >/dev/null
npx prisma migrate deploy
popd >/dev/null

echo "Production build completed successfully."
