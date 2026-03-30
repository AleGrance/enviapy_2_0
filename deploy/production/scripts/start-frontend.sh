#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
FRONTEND_ENV_FILE="${FRONTEND_ENV_FILE:-$ROOT_DIR/deploy/production/frontend.env}"

if [[ ! -f "$FRONTEND_ENV_FILE" ]]; then
  echo "Missing frontend env file: $FRONTEND_ENV_FILE"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$FRONTEND_ENV_FILE"
set +a

cd "$ROOT_DIR/frontend"
exec npm run start
