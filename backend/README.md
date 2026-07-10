# CellGuard Backend

Node.js + TypeScript + Express backend for the CellGuard dashboard.

## Auth Direction

- Better Auth is mounted at `/api/auth/*`.
- PostgreSQL stores Better Auth users/sessions plus app-owned role/profile tables.
- Application APIs validate the Better Auth session server-side.
- Admin APIs must check `ADMIN` role on the server and record access failures in `audit_log`.

## Local Setup

```bash
npm install
cp .env.example .env
npm run auth:generate
npm run build
npm run dev
```

Run `migrations/001_app_auth.sql` after creating the Better Auth core tables. The Better Auth schema should be generated from the configured version with `npm run auth:generate` so it stays aligned with the library.
