#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-$ROOT_DIR/deploy/production/backend.env}"

if [[ ! -f "$BACKEND_ENV_FILE" ]]; then
  echo "Missing backend env file: $BACKEND_ENV_FILE"
  exit 1
fi

mkdir -p "$ROOT_DIR/logs" "$ROOT_DIR/uploads" "$ROOT_DIR/sessions"

if [[ ! -e "$ROOT_DIR/.wwebjs_auth" ]]; then
  ln -s "$ROOT_DIR/sessions" "$ROOT_DIR/.wwebjs_auth"
fi

set -a
# shellcheck disable=SC1090
source "$BACKEND_ENV_FILE"
set +a

cd "$ROOT_DIR"
exec node backend/dist/main.js
