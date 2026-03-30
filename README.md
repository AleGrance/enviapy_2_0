# WhatsApp Platform

A full multi-tenant WhatsApp Web platform built with NestJS, Next.js, and whatsapp-web.js. Supports multiple tenants, multiple WhatsApp numbers per tenant, real-time messaging via Socket.io, and persistent sessions.

---

## Stack

| Layer | Technology |
|---|---|
| Backend | NestJS + TypeScript |
| ORM | Prisma + PostgreSQL |
| Queue | BullMQ + Redis |
| WebSockets | Socket.io |
| Frontend | Next.js 14 + TailwindCSS |
| WhatsApp | whatsapp-web.js 1.34.6 |
| Browser | Puppeteer + Chromium |

---

## Quick Start

### Prerequisites
- Docker & Docker Compose installed
- PostgreSQL running locally (outside Docker)

### 1. Clone and configure

```bash
git clone <your-repo>
cd whatsapp-platform
cp .env.example .env   # edit as needed
```
Set `DATABASE_URL` in `.env` to your local PostgreSQL instance.
If backend runs in Docker, use `host.docker.internal` as host.
For this project setup, backend reads DB credentials from `backend/.env`.

### 2. Start all services

```bash
docker-compose up --build
```

This starts:
- Redis on port 6379
- Backend API on port 3001
- Frontend on port 3000

### 3. Seed the database

After containers are running:

```bash
docker exec whatsapp_backend npx ts-node prisma/seed.ts
```

Default credentials:
- **Email:** `admin@example.com`
- **Password:** `admin123`

### 4. Open the app

Visit [http://localhost:3000](http://localhost:3000)

---

## How to Use

### Creating a Tenant (Admin only)

```bash
curl -X POST http://localhost:3001/tenants \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "My Company"}'
```

### Creating a User

```bash
curl -X POST http://localhost:3001/users \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@mycompany.com",
    "password": "password123",
    "role": "CLIENT",
    "tenantId": "<tenant-id>"
  }'
```

### Adding a WhatsApp Number

```bash
curl -X POST http://localhost:3001/numbers \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "<tenant-id>",
    "name": "Main Support"
  }'
```

### Connecting a Number via QR

1. Log in to the frontend at http://localhost:3000
2. If no account is linked yet, click **Link WhatsApp session** in the Numbers panel
3. If you already have a number, click **Connect**
4. A QR code modal will appear
5. Open **WhatsApp** on your phone → **Settings** → **Linked Devices** → **Link a Device**
6. Scan the QR code
7. The status will change to **CONNECTED** ✅

Sessions are persisted in `./sessions/` and automatically restored on server restart.

### Sending a Message

Via API:

```bash
curl -X POST http://localhost:3001/messages/send \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "numberId": "<number-id>",
    "to": "595981111111",
    "type": "text",
    "text": "Hello from WhatsApp Platform!"
  }'
```

Via Frontend:
1. Select a number from the sidebar
2. Select a conversation
3. Type in the message input and press Enter or click Send

### Sending Media

Upload first, then send:

```bash
# Upload file
curl -X POST http://localhost:3001/messages/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@/path/to/image.jpg"
# Returns: { "mediaPath": "/uploads/temp/1234567890.jpg" }

# Send
curl -X POST http://localhost:3001/messages/send \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "numberId": "<number-id>",
    "to": "595981111111",
    "type": "image",
    "mediaPath": "/uploads/temp/1234567890.jpg",
    "text": "Optional caption"
  }'
```

---

## API Reference

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/login` | Login, returns JWT |

### Tenants
| Method | Endpoint | Description |
|---|---|---|
| GET | `/tenants` | List all tenants (ADMIN) |
| POST | `/tenants` | Create tenant (ADMIN) |
| PATCH | `/tenants/:id` | Update tenant (ADMIN) |
| DELETE | `/tenants/:id` | Delete tenant (ADMIN) |

### Users
| Method | Endpoint | Description |
|---|---|---|
| GET | `/users` | List users |
| POST | `/users` | Create user (ADMIN) |
| PATCH | `/users/:id` | Update user (ADMIN) |
| PATCH | `/users/:id/deactivate` | Set user as INACTIVE (ADMIN) |

### Numbers
| Method | Endpoint | Description |
|---|---|---|
| GET | `/numbers` | List numbers |
| POST | `/numbers` | Create number (ADMIN) |
| POST | `/numbers/:id/connect` | Start WhatsApp session (same tenant) |
| POST | `/numbers/:id/disconnect` | Stop WhatsApp session (same tenant) |
| POST | `/numbers/:id/reconnect` | Restart session (same tenant) |
| POST | `/numbers/link-session` | Create (if needed) and start session for logged user tenant |
| POST | `/numbers/bootstrap` | Auto-start tenant sessions on login |
| DELETE | `/numbers/:id` | Delete number (ADMIN) |

### Conversations
| Method | Endpoint | Description |
|---|---|---|
| GET | `/conversations` | List conversations |
| GET | `/conversations?numberId=<id>` | Filter by number |
| GET | `/conversations/:id` | Get one conversation |

### Messages
| Method | Endpoint | Description |
|---|---|---|
| POST | `/messages/send` | Send a message |
| POST | `/messages/upload` | Upload a media file |
| GET | `/messages/conversation/:id` | Get messages |

---

## Socket.io Events

Connect with token:
```js
const socket = io('http://localhost:3001', {
  auth: { token: '<jwt>' }
});
```

| Event | Direction | Payload |
|---|---|---|
| `qr` | Server → Client | `{ numberId, qr }` |
| `number:status` | Server → Client | `{ numberId, status }` |
| `message:new` | Server → Client | Message object |
| `conversation:update` | Server → Client | Conversation object |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string (local DB; use `host.docker.internal` if backend is in Docker) |
| `JWT_SECRET` | `supersecretkey` | JWT signing secret |
| `REDIS_HOST` | `redis` | Redis hostname (`localhost` if backend runs outside Docker) |
| `REDIS_PORT` | `6379` | Redis port |
| `PORT` | `3001` | Backend port |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | API URL for frontend |
| `NEXT_PUBLIC_WS_URL` | `http://localhost:3001` | WebSocket URL for frontend |

---

## Architecture

```
┌─────────────┐    HTTP/WS     ┌──────────────────┐
│  Next.js    │◄──────────────►│   NestJS API     │
│  Frontend   │                │                  │
└─────────────┘                │  ┌────────────┐  │
                               │  │ WhatsApp   │  │
                               │  │ Manager    │  │
                               │  │ (per #)    │  │
                               │  └─────┬──────┘  │
                               │        │          │
                               │  ┌─────▼──────┐  │
                               │  │  BullMQ    │  │
                               │  │  Queue     │  │
                               │  └─────┬──────┘  │
                               └────────┼──────────┘
                                        │
                               ┌────────▼──────────┐
                               │   PostgreSQL       │
                               │   Redis            │
                               └───────────────────┘
```

### Session Persistence

Sessions are stored in `./sessions/` using LocalAuth from whatsapp-web.js.  
Each number gets its own session folder: `session-{numberId}`.  
On server restart, all sessions are automatically restored.

### Multi-Tenant Isolation

All database queries are scoped by `tenantId`.  
Socket.io rooms are scoped per tenant: `tenant:{tenantId}`.  
Admins can access all tenants; CLIENT role is restricted to their own tenant.

---

## Troubleshooting

**QR not showing up?**
- Make sure the backend container started correctly: `docker logs whatsapp_backend`
- Check that the browser (Chromium) is installed in the container
- Try reconnecting the number

**Session not restoring?**
- Check `./sessions/` folder exists and has write permissions
- The `docker-compose.yml` mounts `./sessions` as a volume

**Messages not arriving in real-time?**
- Check WebSocket connection in browser DevTools
- Ensure `NEXT_PUBLIC_WS_URL` points to the correct backend URL
