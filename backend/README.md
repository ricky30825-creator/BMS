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
npm run db:migrate   # applies migrations/000..006, records them in schema_migrations
npm run build
npm run dev
```

`db:migrate` needs a reachable `DATABASE_URL`. It is required before
`DATA_MODE=postgres`; the `DATA_MODE=memory` demo path runs without it.
`005_timescale.sql` needs the TimescaleDB extension. Without it the migration
runner stops at `005`, so `006` is not applied and PostgreSQL mode remains
closed until the extension is installed and migrations are rerun.

Do **not** run `npm run auth:generate` here. It is not part of first-run setup
and the CLI it needs is not a repository dependency — see below.

### Better Auth CLI — install per machine, when you need it

`auth:generate` and `auth:migrate` shell out to `@better-auth/cli`, which is
**deliberately not in `package.json`**. Until you install it yourself both
scripts fail with:

```
> auth generate
sh: auth: command not found
```

Install it on your own machine when you actually need it:

```bash
npm i -D @better-auth/cli      # or: npx @better-auth/cli@latest generate
```

You do not need it for the demo path (`AUTH_MODE=demo DATA_MODE=memory`), and
the PostgreSQL store uses the existing application-owned profile tables.

When you do turn Better Auth on: the `"user"` table **already exists**, created
by `000_identity.sql` in Better Auth's core-schema shape precisely so this step
stays small — `001_app_auth.sql` has four foreign keys pointing at it. Only
`session`, `account`, and `verification` are missing.

⚠️ **Generate, don't migrate.** `auth:migrate` writes tables straight to the
database, outside `schema_migrations`, so `npm run db:migrate` loses track of
what is applied and the two disagree from then on. Instead run `auth:generate`,
read the SQL it emits, and add it as a **new numbered migration** (e.g.
`007_better_auth.sql`). `001_app_auth.sql` is a baseline file and is never
edited — changes are stacked in later-numbered files.

For the repository-backed localhost demo, use `AUTH_MODE=demo DATA_MODE=memory`
with the required Better Auth configuration, then run the frontend with
`npm run dev:real`. The frontend keeps the issued demo token in memory, sends
it as `Authorization: Demo <token>` for REST/download requests, and uses the
URL-encoded `access_token` only for the development WebSocket connection.
Better Auth cookie transport remains unchanged for production paths.

The demo provider is intentionally not a production substitute. With
`DATA_MODE=postgres`, startup verifies the required domain schema and the
REST APIs use the PostgreSQL-backed `CellGuardStore`; there is no memory-data
fallback. Apply migrations through `006_diagnosis_progress_snapshot.sql`
before starting the server. The PostgreSQL integration contract suite runs
only when `TEST_DATABASE_URL` is set; without it, the suite reports a clear
skip and does not attempt a connection.

WebSocket production authentication is a separate deferred path: the current
upgrade handler still accepts the demo token only when `AUTH_MODE=demo`, while
Better Auth cookie-based streaming remains disabled.

Migrations are applied by `npm run db:migrate` in filename order (`000`..`006`), not by running individual `.sql` files by hand. The earlier instruction to run `001_app_auth.sql` after creating the Better Auth core tables is obsolete: `000_identity.sql` now creates `"user"` itself, and `001` depends on it.
