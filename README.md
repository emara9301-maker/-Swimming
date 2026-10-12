# Swimming Academy

A responsive web app (installable PWA) that runs on desktop and mobile browsers to manage a swimming academy: students, coaches, classes and lessons, attendance, evaluations and skills, subscriptions and payments, and notifications.

## Structure

```
server/   API: Node.js + Express + SQLite (node:sqlite)
web/      UI: React + Vite (student / coach / admin dashboards)
```

## Requirements

- Node.js 22.13 or newer (uses the built-in `node:sqlite` module)

## Run locally

```bash
# 1) API server
cd server
npm install
ADMIN_EMAIL=owner@academy.local ADMIN_PASSWORD='change-me-123' npm run dev   # http://localhost:4000

# 2) Web app (in a second terminal)
cd web
npm install
npm run dev                                                                  # http://localhost:5173
```

On first start the server creates the default levels, the Swimming sport with starter skills, and an admin account from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (only if no admin exists yet).

## Production

```bash
cd web && npm run build           # builds web/dist
cd ../server
NODE_ENV=production JWT_SECRET='...' PAYMENT_WEBHOOK_SECRET='...' DB_FILE=/data/academy.db npm start
```

- The server serves `web/dist` and the API under `/api` on the same port.
- `JWT_SECRET` is required in production.
- Backups: `npm run backup` writes a consistent copy of the database to `server/backups` and keeps the 14 most recent.

## Tests

```bash
cd server && npm test     # API integration tests (registration, permissions, attendance, payments, level changes)
cd web && npm run build   # confirms the UI builds
```

## Status

| Area | Status |
|---|---|
| Student sign-up and sign-in, profile, password change | Done |
| Class enrollment, timetable, assigned coach, level | Done |
| Attendance with automatic session deduction | Done |
| Sessions remaining | Done |
| Evaluations, skills, private coach notes, level history | Done |
| Notifications (individual and broadcast) | Done |
| Online payments | Partial: signed webhook and `payments.js` integration point are ready; no real gateway connected yet |
| Invoices, payments, subscription renewal | Done |
| Coach dashboard: timetable, roster, attendance, evaluations, skills, notes, level changes, reports | Done |
| Admin dashboard: users, roles, classes, lessons, plans, payments, content, sports and levels, revenue, activity log | Partial: subscription and evaluation management screens not built yet; the API covers the core operations |
| Native Android / iOS apps | Not started: the PWA can be installed on phones now; Capacitor is the suggested path for store builds |

## Security and operations

- Passwords are hashed with `scrypt` and a per-user salt. Tokens are HMAC-signed and expire after 12 hours. The user is re-checked on every request, so disabling an account takes effect immediately.
- Roles: `admin`, `coach`, `student`. Coaches only see students enrolled in their classes. Coach notes are hidden from students.
- Login rate limiting, `helmet` security headers, a JSON body size limit, and input validation on every endpoint.
- Every write is recorded in the audit log (`GET /api/admin/audit`), and each request is logged to the console.
- Scaling: the API is stateless (signed tokens) and lists are paginated. SQLite suits a single academy; the schema can move to PostgreSQL if usage grows.

## Notes

- `server/src/access.js` holds the ownership rules used by all routes. Add any new permission rule there.
- Schema setup uses `CREATE TABLE IF NOT EXISTS`. A proper migration system is needed before the first breaking schema change.
