# Vaishnavi Group Help Desk — Integration Guide

This guide is for the developer integrating the Help Desk into the Vaishnavi Group
website. The Help Desk ships as two deployable pieces plus a database:

| Piece | What it is | Tech |
|-------|------------|------|
| **Backend API** | REST API (this is what the website calls) | Node.js + Express + TypeScript + Prisma |
| **Frontend SPA** | Standalone admin/agent/user web app | React + Vite |
| **Database** | PostgreSQL | — |

You have two integration options:

1. **API-only** — keep the website's own UI and call the Help Desk **REST API** directly
   (recommended for embedding "Raise a ticket" / "My tickets" into the site).
2. **Embed the SPA** — host the bundled React app under a path/subdomain
   (e.g. `helpdesk.vaishnavigroup.in`) and link to it from the website.

Most website integrations use option 1 for the user-facing forms and option 2 for the
staff/admin console.

---

## 1. API basics

- **Base URL:** `https://<API_HOST>/api/v1`  (local dev: `http://localhost:5001/api/v1`)
- **Format:** JSON. Every response uses the envelope:
  ```json
  { "success": true, "data": { ... } }
  { "success": false, "message": "Reason" }
  ```
  List endpoints also return `meta: { page, limit, total, totalPages }`.
- **Auth:** JWT Bearer tokens. Send `Authorization: Bearer <accessToken>` on protected calls.
- **Health check:** `GET https://<API_HOST>/health` → `{ success: true, status: "ok" }`.
- **Full endpoint reference:** see [`openapi.yaml`](./openapi.yaml) — import it into Swagger
  Editor (editor.swagger.io) or Postman for an interactive reference.

---

## 2. CORS — IMPORTANT for browser calls

The API only accepts browser requests from allow-listed origins. Add the website's
domain(s) to `CORS_ORIGINS` (comma-separated) in the backend `.env`:

```
CORS_ORIGINS=https://www.vaishnavigroup.in,https://vaishnavigroup.in,http://localhost:5173
```

Server-to-server calls (no `Origin` header) are always allowed, so you can also proxy
the API from the website's own backend if you prefer to keep tokens off the browser.

---

## 3. Authentication flow

### 3.1 New user signup (with email OTP)
```
POST /auth/signup        { name, email, password, phone? }
  → 201 { data: { email, requiresVerification: true } }     // OTP emailed
POST /auth/verify-otp    { email, otp }
  → 200 { data: { user, accessToken, refreshToken } }        // now logged in
POST /auth/resend-otp    { email }                           // if code expired
```

### 3.2 Login
```
POST /auth/login         { email, password }
  → 200 { data: { user, accessToken, refreshToken } }
  → 403 { message: "EMAIL_NOT_VERIFIED" }   // unverified: send them to verify-otp
```

### 3.3 Token lifecycle
- `accessToken` is short-lived (default 15 min). `refreshToken` lasts ~7 days.
- When an API call returns **401**, call `POST /auth/refresh { refreshToken }` to get a
  new pair, then retry the original request.
- `POST /auth/logout { refreshToken }` revokes the refresh token.

### 3.4 Password reset (all roles)
```
POST /auth/forgot-password  { email }                  // emails a reset link
POST /auth/reset-password   { token, password }        // token comes from the email link
```
The reset link points at `RESET_PASSWORD_URL` (configurable in `.env`). Point it to a page
on the website that captures the `?token=` and calls `reset-password`, or to the SPA.

---

## 4. Calling the API from the website (browser, fetch)

A minimal client with auto token-refresh:

```js
const API = 'https://<API_HOST>/api/v1';
let accessToken = localStorage.getItem('hd_access');
let refreshToken = localStorage.getItem('hd_refresh');

async function api(path, options = {}, retry = true) {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (res.status === 401 && retry && refreshToken) {
    const r = await fetch(API + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (r.ok) {
      const { data } = await r.json();
      accessToken = data.accessToken; refreshToken = data.refreshToken;
      localStorage.setItem('hd_access', accessToken);
      localStorage.setItem('hd_refresh', refreshToken);
      return api(path, options, false); // retry once
    }
  }
  return res.json();
}

// Examples ---------------------------------------------------------
// Login
const login = (email, password) =>
  api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });

// List categories (to build the Raise-Ticket dropdowns)
const categories = () => api('/categories');

// Raise a ticket
const raiseTicket = (payload) =>
  api('/tickets', { method: 'POST', body: JSON.stringify(payload) });
//   payload = { title, description, categoryId, priority, contactName?, contactEmail? }

// My tickets
const myTickets = () => api('/tickets?page=1&limit=10');
```

### File uploads (ticket / KB attachments)
Use `multipart/form-data` with field name **`file`** and **no** `Content-Type` header
(let the browser set the boundary):
```js
const form = new FormData();
form.append('file', fileInput.files[0]);
await fetch(`${API}/tickets/${ticketId}/attachments`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${accessToken}` },
  body: form,
});
```
Uploaded files are served from `https://<API_HOST>/uploads/<filename>`. Default max size
is **10 MB** (`MAX_FILE_SIZE_MB`).

---

## 5. Roles & permissions

| Role | Capabilities |
|------|--------------|
| `ADMIN` | Everything, incl. creating/managing other Admins |
| `MANAGER` | Everything except managing Admin accounts |
| `SUPPORT_AGENT` | Work tickets; reports scoped to self |
| `USER` | Raise & track their own tickets, browse KB |

The API enforces these server-side; the website should hide UI it can't use but must not
rely on hiding for security.

---

## 6. Most useful endpoints for website embedding

| Goal | Call |
|------|------|
| Sign up a website visitor | `POST /auth/signup` → `POST /auth/verify-otp` |
| Log in | `POST /auth/login` |
| Build the raise-ticket form | `GET /categories` |
| Raise a ticket | `POST /tickets` |
| Show "My Tickets" | `GET /tickets` |
| Ticket detail + replies | `GET /tickets/{id}`, `GET /comments/ticket/{id}`, `POST /comments/ticket/{id}` |
| Knowledge base list/detail | `GET /knowledge-base`, `GET /knowledge-base/{slug}` |

See `openapi.yaml` for the complete list (assignment, escalation, reports, SLA, audit, etc.).

---

## 7. Running & deploying

### Local
```bash
# Backend
cd backend
cp .env.example .env          # fill DATABASE_URL, JWT secrets, SMTP, CORS_ORIGINS
npm install
npx prisma migrate deploy     # apply schema
npm run seed                  # optional demo data
npm run dev                   # http://localhost:5001  (PORT in .env)

# Frontend (optional, if hosting the SPA)
cd ../frontend
npm install
npm run dev                   # http://localhost:5173
```

### Docker (recommended for handoff)
From the repo root:
```bash
docker compose up -d --build
```
This starts PostgreSQL + backend + frontend (Nginx). See the root `README.md` and
`docker-compose.yml`. Set production secrets via environment variables / a root `.env`.

### Production build (without Docker)
```bash
cd backend && npm run build && npx prisma migrate deploy && npm start
cd frontend && npm run build   # outputs static files in dist/ to host on any CDN/Nginx
```

---

## 8. Environment variables (backend/.env)

| Variable | Purpose |
|----------|---------|
| `PORT` | API port |
| `CLIENT_URL` | Primary SPA URL (used in emails) |
| `CORS_ORIGINS` | Comma-separated allowed browser origins (add the website domain) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Token signing secrets (set strong values) |
| `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | Token lifetimes |
| `SMTP_HOST/PORT/USER/PASS/FROM` | Email (OTP, password reset, notifications) |
| `UPLOAD_DIR`, `MAX_FILE_SIZE_MB` | File upload storage + size cap |
| `RESET_PASSWORD_URL` | Where password-reset emails link to |

> **Email note:** the API currently points at Microsoft 365 SMTP
> (`smtp.office365.com:587`). SMTP client authentication must be enabled on the
> `noreply@vaishnavigroup.in` mailbox for emails to send. If you'd rather use a
> dedicated provider (SendGrid/Brevo/Mailgun), just change the `SMTP_*` values —
> no code changes needed.

---

## 9. Notes & gotchas

- Ticket descriptions and KB content are **HTML** (rich text). Sanitize/escape when
  rendering on the website if you display user-generated content elsewhere.
- Ticket numbers are auto-generated: `TKT-<year>-<6 digits>`.
- New accounts created via **public signup** require OTP verification; accounts created by
  an admin/manager are pre-verified and can log in immediately.
- The API is stateless (JWT) — it scales horizontally behind a load balancer; only the
  `uploads/` directory and PostgreSQL hold state. For multi-instance deploys, put
  `uploads/` on shared storage or object storage.
