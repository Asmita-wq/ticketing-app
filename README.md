# Help Desk / Ticketing System

A full-stack, production-ready Help Desk & Ticket Management application with separate **User** and **Admin/Agent** portals.

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Backend**: Node.js + Express + TypeScript
- **Database**: PostgreSQL + Prisma ORM
- **Auth**: JWT access + refresh tokens (with rotation)
- **File uploads**: images, PDFs, documents
- **Deployment**: Docker & docker-compose

---

## 📦 Developer Handoff / Website Integration

If you are integrating this Help Desk into the Vaishnavi Group website, start here:

- **[docs/INTEGRATION_GUIDE.md](docs/INTEGRATION_GUIDE.md)** — how to run/deploy, the
  auth flow, CORS setup, and copy-paste `fetch` examples for the website.
- **[docs/openapi.yaml](docs/openapi.yaml)** — complete REST API reference. Import into
  [Swagger Editor](https://editor.swagger.io) or Postman.
- **[docs/helpdesk.postman_collection.json](docs/helpdesk.postman_collection.json)** —
  ready-to-run Postman collection (run *Auth → Login* first; it auto-saves the token).

API base URL: `http(s)://<host>/api/v1` · Health check: `GET /health`.

---

## 1. Project Structure

```
ticketing software/
├── backend/                 # Express + TypeScript API
│   ├── prisma/
│   │   ├── schema.prisma    # Database schema
│   │   └── seed/seed.ts     # Seed data script
│   ├── src/
│   │   ├── config/          # env, prisma client
│   │   ├── controllers/      # Route handlers
│   │   ├── middlewares/      # auth, validation, upload, error handling
│   │   ├── routes/            # Express routers
│   │   ├── services/          # Business logic
│   │   ├── validators/        # Zod schemas
│   │   ├── utils/              # logger, jwt, pagination, export helpers
│   │   ├── jobs/                # background jobs (SLA breach checker)
│   │   ├── app.ts
│   │   └── server.ts
│   ├── uploads/               # uploaded attachments (gitignored)
│   ├── Dockerfile
│   └── .env.example
├── frontend/                  # React + Vite + Tailwind SPA
│   ├── src/
│   │   ├── pages/              # auth, tickets, admin, knowledgeBase, ...
│   │   ├── components/         # shared UI components
│   │   ├── layouts/             # AppLayout, AuthLayout
│   │   ├── context/              # Auth & Theme context
│   │   ├── services/             # axios API clients
│   │   └── types/                  # shared TS types
│   ├── docker/nginx.conf
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## 2. Prerequisites

- Node.js 20+ and npm
- PostgreSQL 14+ (or use the bundled Docker container)
- Docker & Docker Compose (for containerized setup)

---

## 3. Local Development (without Docker)

### 3.1 Backend

```bash
cd backend
cp .env.example .env
# edit .env with your local database credentials and secrets

npm install
npx prisma migrate dev --name init
npm run seed          # seeds roles, categories, SLA configs, demo users & tickets
npm run dev           # starts API on http://localhost:5000
```

### 3.2 Frontend

```bash
cd frontend
npm install
npm run dev           # starts Vite dev server on http://localhost:5173
```

The Vite dev server proxies `/api` and `/uploads` requests to `http://localhost:5000`, so no CORS configuration is needed in development.

### 3.3 Demo Accounts (after seeding)

| Role          | Email                  | Password      |
|---------------|------------------------|----------------|
| Admin (top)   | admin@helpdesk.com     | Password@123  |
| Manager       | manager@helpdesk.com   | Password@123  |
| Support Agent | agent1@helpdesk.com    | Password@123  |
| Support Agent | agent2@helpdesk.com    | Password@123  |
| User          | user1@example.com      | Password@123  |
| User          | user2@example.com      | Password@123  |

> Role hierarchy: **Admin** > **Manager** > **Support Agent** > **User**. Change all demo passwords before going live.

---

## 4. Environment Variables (Backend)

See [`backend/.env.example`](backend/.env.example):

| Variable | Description |
|---|---|
| `NODE_ENV` | `development` \| `production` |
| `PORT` | API port (default `5000`) |
| `CLIENT_URL` | Frontend origin, used for CORS fallback + email links |
| `CORS_ORIGINS` | Comma-separated allowed browser origins (the website domain(s)) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | Access-token secret — **production requires a unique random string ≥32 chars** (`openssl rand -base64 48`) |
| `JWT_REFRESH_SECRET` | Refresh-token secret — must differ from the access secret |
| `JWT_ACCESS_EXPIRES_IN` | Access token lifetime (e.g. `15m`) |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token lifetime (e.g. `7d`) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | SMTP credentials for transactional email (password reset, notifications). If left blank, email sending is skipped and logged instead. |
| `UPLOAD_DIR` | Directory for uploaded attachments (default `uploads`) |
| `MAX_FILE_SIZE_MB` | Max upload size in MB |
| `RESET_PASSWORD_URL` | Base URL the frontend uses for password reset links |

---

## 5. Running with Docker

The repository ships with a `docker-compose.yml` that runs PostgreSQL, the backend API, and the frontend (served via Nginx, which also proxies `/api` and `/uploads` to the backend).

```bash
# from the repository root
docker compose up -d --build
```

- Frontend: http://localhost:8080
- Backend API: http://localhost:5000/api/v1
- PostgreSQL: localhost:5432 (user/pass: `postgres` / `postgres`, db: `helpdesk`)

On first start, the backend container automatically runs `prisma migrate deploy`. To seed demo data into the container:

```bash
docker compose exec backend npm run seed
```

### Configuring secrets for Docker

Override the defaults by exporting environment variables (or creating a `.env` file at the repo root, which `docker compose` reads automatically), e.g.:

```bash
JWT_ACCESS_SECRET=super-secret-access
JWT_REFRESH_SECRET=super-secret-refresh
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=587
SMTP_USER=xxxx
SMTP_PASS=xxxx
SMTP_FROM="Help Desk <support@helpdesk.com>"
```

---

## 6. Deployment Guide

1. Provision a PostgreSQL database and obtain its connection string.
2. Build and push the backend and frontend images (or build directly on the host with `docker compose build`).
3. Set production environment variables — at minimum `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CLIENT_URL`, and SMTP credentials.
4. Run database migrations: `npx prisma migrate deploy` (done automatically by the backend Docker image entrypoint).
5. Start the stack: `docker compose up -d`.
6. Point your reverse proxy / load balancer at the frontend container (port 80) for the SPA, which itself proxies `/api` and `/uploads` to the backend.
7. (Optional) Run `npm run seed` once to populate initial categories, SLA configuration, and admin accounts — **change all demo passwords immediately in production**.
8. Configure HTTPS termination (e.g. via a reverse proxy such as Traefik, Caddy, or an ALB) in front of the frontend container.

---

## 7. API Overview

Base URL: `/api/v1`

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/signup` | Register a new user |
| POST | `/auth/login` | Login, returns access & refresh tokens |
| POST | `/auth/refresh` | Rotate refresh token for a new access token |
| POST | `/auth/logout` | Revoke refresh token |
| POST | `/auth/forgot-password` | Request password reset email |
| POST | `/auth/reset-password` | Reset password using token |
| GET | `/auth/profile` | Get current user profile |
| PATCH | `/auth/profile` | Update current user profile |
| PATCH | `/auth/change-password` | Change password |

### Tickets
| Method | Endpoint | Description |
|---|---|---|
| GET | `/tickets` | List tickets (search, filter, paginate; role-scoped) |
| POST | `/tickets` | Create a new ticket |
| GET | `/tickets/:id` | Get ticket details |
| PATCH | `/tickets/:id` | Update ticket fields |
| POST | `/tickets/:id/assign` | Assign ticket to an agent (staff only) |
| PATCH | `/tickets/:id/status` | Change ticket status (workflow-validated) |
| PATCH | `/tickets/:id/priority` | Change ticket priority (recomputes SLA) |
| POST | `/tickets/:id/escalate` | Escalate a ticket (staff only) |
| POST | `/tickets/:id/merge` | Merge tickets (staff only) |
| POST | `/tickets/:id/attachments` | Upload an attachment |

### Comments
| Method | Endpoint | Description |
|---|---|---|
| GET | `/comments/ticket/:ticketId` | List comments (internal notes hidden from end users) |
| POST | `/comments/ticket/:ticketId` | Add a comment (PUBLIC or INTERNAL) |

### Categories
| Method | Endpoint | Description |
|---|---|---|
| GET | `/categories` | List categories with subcategories |
| POST | `/categories` | Create category (admin) |
| POST | `/categories/subcategories` | Create subcategory (admin) |

### Users / Agents
| Method | Endpoint | Description |
|---|---|---|
| GET | `/users` | List all users (admin) |
| GET | `/users/agents` | List active agents (staff) |
| POST | `/users/agents` | Create a new agent/admin (admin) |
| PATCH | `/users/agents/:id` | Update agent role / status (admin) |

### Dashboard
| Method | Endpoint | Description |
|---|---|---|
| GET | `/dashboard` | Role-aware dashboard stats & charts |

### Notifications
| Method | Endpoint | Description |
|---|---|---|
| GET | `/notifications` | List notifications |
| PATCH | `/notifications/:id/read` | Mark one as read |
| PATCH | `/notifications/read-all` | Mark all as read |

### Knowledge Base
| Method | Endpoint | Description |
|---|---|---|
| GET | `/knowledge-base` | List articles (published only for end users) |
| GET | `/knowledge-base/:slug` | Get article by slug (increments views) |
| POST | `/knowledge-base` | Create article (admin) |
| PATCH | `/knowledge-base/:id` | Update article (admin) |
| DELETE | `/knowledge-base/:id` | Delete article (admin) |

### SLA
| Method | Endpoint | Description |
|---|---|---|
| GET | `/sla` | List SLA configurations |
| PUT | `/sla` | Upsert SLA configuration for a priority (admin) |

### Audit Logs
| Method | Endpoint | Description |
|---|---|---|
| GET | `/audit-logs` | List audit logs with filters (admin) |

### Reports
| Method | Endpoint | Description |
|---|---|---|
| GET | `/reports/:type` | Report data (`tickets-by-category`, `tickets-by-agent`, `resolution-time`, `sla-breaches`, `monthly-trends`) |
| GET | `/reports/export?type=&format=` | Export report as `csv`, `excel`, or `pdf` |

All endpoints (except `/auth/signup`, `/auth/login`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password`) require an `Authorization: Bearer <accessToken>` header. Admin-only and staff-only endpoints are enforced via role-based middleware.

---

## 8. Key Features

- **Auto-generated ticket numbers** (`TKT-2026-000123`)
- **Status workflow**: Open → Assigned → In Progress → Pending User → Resolved → Closed, with Reopen support and role-based transition rules
- **SLA management**: configurable response/resolution targets per priority, automatic due-date computation, and a background job that flags breaches and notifies assigned agents
- **Role-based access**: `ADMIN` > `MANAGER` > `SUPPORT_AGENT` > `USER` (only Admins can create/manage other Admins)
- **Email OTP** verification on signup; admin-created accounts are emailed their credentials
- **Bulk + load-balanced ticket assignment**, raise-on-behalf-of-user, 15-day user escalation
- **Internal vs public comments** on tickets
- **Email + in-app notifications**
- **Knowledge Base** with admin CRUD and view tracking
- **Audit logging** of authentication, ticket, and user management actions
- **Reporting** with CSV / Excel / PDF export
- **Dark/light mode**, responsive layout, loading & empty states, toast notifications

---

## 9. Tech Stack Summary

| Layer | Technology |
|---|---|
| Frontend framework | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| Routing | React Router v6 |
| Charts | Recharts |
| Rich text editor | React Quill |
| HTTP client | Axios (with auth-refresh interceptor) |
| Backend framework | Express + TypeScript |
| ORM | Prisma |
| Database | PostgreSQL |
| Auth | JWT (access + refresh, rotation) |
| File uploads | Multer |
| Email | Nodemailer |
| Exports | ExcelJS, PDFKit |
| Logging | Winston |
| Containerization | Docker, docker-compose, Nginx |

---

## 10. Security & Production Checklist

Built-in protections (already in the code):
- **Passwords** hashed with bcrypt; **JWT** access + refresh with rotation & revocation.
- **Prisma ORM** (parameterized queries — no SQL injection).
- **Helmet** security headers, **CORS allow-list** (`CORS_ORIGINS`), **rate limiting** (global + stricter on `/auth` to resist brute force).
- **Zod** validation on every request body/query; uploads restricted by MIME type + size.
- **Role-based authorization** on every protected route; errors never leak stack traces in production.
- **Startup guard**: in production the server refuses to boot with weak/default/identical JWT secrets.
- `.env` is git-ignored — **no secrets are committed**.

Before going live, the hosting developer must:
1. Set `NODE_ENV=production`.
2. Generate strong unique secrets: `JWT_ACCESS_SECRET` & `JWT_REFRESH_SECRET` (`openssl rand -base64 48`).
3. Set `CORS_ORIGINS` to the real website domain(s) only.
4. Use a strong `DATABASE_URL` password; don't expose Postgres publicly.
5. Configure SMTP (SendGrid recommended) and verify the sender/domain.
6. Run `npm run seed` once, then **change/disable all demo accounts and passwords**.
7. Serve over **HTTPS** (terminate TLS at the reverse proxy / load balancer).
8. Keep the SendGrid API key and DB credentials in the server's environment, never in git.
