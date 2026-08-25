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

For the repository-backed localhost demo, use `AUTH_MODE=demo DATA_MODE=memory`
with the required Better Auth configuration, then run the frontend with
`npm run dev:real`. The frontend keeps the issued demo token in memory, sends
it as `Authorization: Demo <token>` for REST/download requests, and uses the
URL-encoded `access_token` only for the development WebSocket connection.
Better Auth cookie transport remains unchanged for production paths.

The demo provider is intentionally not a production substitute. With
`DATA_MODE=postgres`, domain APIs and WebSocket streams fail closed until the
PostgreSQL-backed provider (B1) is implemented.

Run `migrations/001_app_auth.sql` after creating the Better Auth core tables. The Better Auth schema should be generated from the configured version with `npm run auth:generate` so it stays aligned with the library.
