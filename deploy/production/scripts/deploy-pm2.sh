#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

bash "$ROOT_DIR/deploy/production/scripts/build-production.sh"

pm2 startOrReload "$ROOT_DIR/deploy/production/ecosystem.config.js"
pm2 save

echo "PM2 deployment completed."
