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
npm run db:migrate   # applies migrations/000..007, records them in schema_migrations
npm run build
npm run dev
```

`db:migrate` needs a reachable `DATABASE_URL`. It is required before
`DATA_MODE=postgres`; the `DATA_MODE=memory` demo path runs without it.
`005_timescale.sql` needs the TimescaleDB extension. Without it the migration
runner stops at `005`, so later migrations are not applied and PostgreSQL mode remains
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
`008_better_auth.sql`). `001_app_auth.sql` is a baseline file and is never
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
fallback. Apply migrations through `007_telemetry_raw_payload.sql`
before starting the server. The PostgreSQL integration contract suite runs
only when `TEST_DATABASE_URL` is set; without it, the suite reports a clear
skip and does not attempt a connection.

WebSocket production authentication is a separate deferred path: the current
upgrade handler still accepts the demo token only when `AUTH_MODE=demo`, while
Better Auth cookie-based streaming remains disabled.

Migrations are applied by `npm run db:migrate` in filename order (`000`..`007`), not by running individual `.sql` files by hand. The earlier instruction to run `001_app_auth.sql` after creating the Better Auth core tables is obsolete: `000_identity.sql` now creates `"user"` itself, and `001` depends on it.

## Raw telemetry Consumer

The PostgreSQL runtime can opt into the embedded `battery-raw-metrics` Consumer:

```dotenv
DATA_MODE=postgres
KAFKA_ENABLED=true
KAFKA_CONSUMER_ENABLED=true
KAFKA_BROKERS=192.168.0.10:9092
KAFKA_GROUP_ID=cellguard-backend
```

The Consumer looks up a registered `device` before resolving the active
session. Only a newly inserted, schema-valid telemetry row advances a
registered device to `ONLINE`. Its `last_seen_at` is the PostgreSQL
`clock_timestamp()` captured by the liveness update, kept monotonic against
the stored value; the untrusted edge timestamp is never used for liveness.
A natural-key duplicate `(device_id, measured_at)` is a successful no-op and
does not revive an `OFFLINE` device or advance `last_seen_at`. Unknown devices
are retained as unassigned telemetry without creating a device row or
updating liveness.

The active session is resolved by `device_id` only when both the session
`target_mode` and the `battery_asset.target_mode` match the frame mode.
Otherwise the frame is kept with null `session_id`/`battery_id` and never
updates `battery_latest`.

The version-1 wire payload is written to `telemetry_metric.raw_payload`, and
`battery_latest` is updated only when the frame timestamp is newer. An
unassigned streak writes one durable `UNASSIGNED_DATA` row to `audit_log` at
the first frame (and again only after an assigned frame or an unassigned
reason transition). Its event `occurredAt` comes from the audit row's
PostgreSQL `created_at`; the edge measurement time is retained separately as
`edgeMeasuredAt`. When an active session can authorize the device, the
embedded server callback broadcasts that transition to the owner stream. This
prevents a 100ms stream from creating an audit row for every frame.

Telemetry insertion, attribution, liveness, `battery_latest`, and the durable
audit row share one PostgreSQL transaction. A failure in any of them rolls
back the liveness mutation as well.

The Consumer uses explicit at-least-once offset commits: a Kafka offset is
committed only after the DB transaction and the per-frame safety hook complete.
A replay is harmless because `(device_id, measured_at)` is the natural key.
This is not a DB/Kafka atomic transaction; a process crash between the DB
commit and Kafka offset commit can replay the frame safely.

Invalid JSON, schema-invalid payloads, and unsupported topics are permanent
poison messages: they are logged and explicitly committed so a partition
cannot wedge forever. DB or safety-hook failures remain uncommitted for
retry. The Consumer is never connected in `DATA_MODE=memory` or
`NODE_ENV=test`; invalid enabled configuration fails startup before HTTP
listen.

## Anomaly score Consumer

The same PostgreSQL-only runtime gate starts the `battery-anomaly-alerts`
Consumer with its own group (`KAFKA_ANOMALY_GROUP_ID`, default
`cellguard-backend-anomaly`). The version-1 AI payload is strict and contains
only the authoritative `device_id`; the Consumer resolves a registered
device's processing-time ACTIVE session and writes both `session_id` and
`battery_id`. If that relationship is absent or the session and asset modes
disagree, both foreign keys remain `null`.

Each result is inserted with the natural key `(device_id, evaluated_at)` and
preserves the AE/Informer scores, XAI contributions, model version, and both
derived temperatures. A newly inserted result updates only the score fields in
`battery_latest`, and only when `evaluated_at` is newer; telemetry fields and a
newer score are never overwritten. Replays use the original persisted
attribution and do not emit another grade transition or alert. The server's
`anomaly.score`, `anomaly.gradeChanged`, and `alert.created` WebSocket events
are derived from the committed row. Invalid JSON/contract messages are
explicitly skipped; database or post-commit notification failures leave the
offset uncommitted for retry. The Task 2 alert list is process-local and is
fed only by committed anomaly transitions; durable alert/outbox delivery is a
later task.
