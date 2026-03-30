#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root on Debian."
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl gnupg build-essential git redis-server chromium

install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list

apt-get update
apt-get install -y nodejs

npm install -g pm2

systemctl enable redis-server
systemctl restart redis-server

echo "Debian bootstrap complete."
node -v
npm -v
pm2 -v
