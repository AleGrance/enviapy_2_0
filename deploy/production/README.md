# Production Deployment With PM2 On Debian

This folder prepares the project to run on a Debian server with PM2 without changing the existing Docker-based development flow.

## Files included

- `ecosystem.config.js`: PM2 process definitions for backend and frontend.
- `backend.env.example`: backend production variables template.
- `frontend.env.example`: frontend production variables template.
- `nginx/whatsapp-platform.conf.example`: reverse proxy example for a single domain.
- `scripts/bootstrap-debian.sh`: installs Node.js 20, PM2, Redis and Chromium on Debian.
- `scripts/build-production.sh`: installs dependencies, builds frontend/backend and runs Prisma migrations.
- `scripts/deploy-pm2.sh`: builds the app and reloads PM2.
- `scripts/start-backend.sh`: starts the backend from the repository root so runtime paths stay compatible.
- `scripts/start-frontend.sh`: starts the Next.js frontend with production variables loaded.

## Why backend runs from repository root

The backend uses `process.cwd()` for:

- `uploads/`
- `logs/`
- `.wwebjs_auth/`

To keep these paths stable in production, PM2 starts the backend from the repository root and executes `backend/dist/main.js`.

## Recommended directory layout on the server

Example:

```bash
/var/www/whatsapp-platform
```

Inside that directory you should have:

```bash
backend/
frontend/
deploy/production/
uploads/
logs/
sessions/
```

The startup scripts automatically create `uploads`, `logs` and `sessions` if they do not exist. If `.wwebjs_auth` does not exist, it is created as a symlink to `sessions` to stay compatible with the current Docker mapping style.

## First-time setup on Debian

Run as root:

```bash
bash deploy/production/scripts/bootstrap-debian.sh
```

Then as your deploy user:

```bash
cp deploy/production/backend.env.example deploy/production/backend.env
cp deploy/production/frontend.env.example deploy/production/frontend.env
chmod +x deploy/production/scripts/*.sh
```

Edit both env files before building.

## Required backend variables

- `DATABASE_URL`
- `JWT_SECRET`
- `REDIS_HOST`
- `REDIS_PORT`
- `PORT`
- `PUPPETEER_EXECUTABLE_PATH`

## Required frontend variables

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_WS_URL`

These public variables are embedded during `next build`, so set them before running the production build.

## Build and start with PM2

```bash
bash deploy/production/scripts/deploy-pm2.sh
```

Useful PM2 commands:

```bash
pm2 status
pm2 logs
pm2 restart whatsapp-platform-backend
pm2 restart whatsapp-platform-frontend
pm2 save
pm2 startup
```

After `pm2 startup`, run the command PM2 prints so the processes are restored on reboot.

## Nginx

Use `nginx/whatsapp-platform.conf.example` as a base.

That config:

- sends `/socket.io/` to backend port `3002`
- sends API/static backend routes to backend port `3002`
- sends everything else to frontend port `3003`

After adjusting the domain:

```bash
sudo cp deploy/production/nginx/whatsapp-platform.conf.example /etc/nginx/sites-available/whatsapp-platform
sudo ln -s /etc/nginx/sites-available/whatsapp-platform /etc/nginx/sites-enabled/whatsapp-platform
sudo nginx -t
sudo systemctl reload nginx
```

## Seed

If you need seed data after the first deployment:

```bash
cd backend
set -a && source ../deploy/production/backend.env && set +a
npx ts-node prisma/seed.ts
```

## Notes

- This setup does not modify Docker files, compose files or development deployment behavior.
- Redis is assumed to run locally on Debian, but you can point `REDIS_HOST` to a remote instance if needed.
- On a shared server, set a dedicated `REDIS_DB` and/or `BULL_PREFIX` so BullMQ keys stay isolated from other apps.
- PostgreSQL can be local or remote as long as `DATABASE_URL` is correct.
- Chromium is installed at the system level for `whatsapp-web.js`.
