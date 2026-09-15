-- 010_domain_events.sql — durable domain events and acknowledgement state.
--
-- `anomaly_score` remains the raw AI result.  This table stores domain-level
-- transitions derived from it (and independent system events such as a
-- fail-safe auto-cut), so event history and trend aggregation survive a
-- process restart.  The natural dedupe key is supplied by the transaction
-- that produced the event; replaying the same Kafka record is a no-op.

create table if not exists domain_event (
  id text primary key,
  event_type text not null,
  severity text not null check (severity in ('NORMAL', 'CAUTION', 'WARNING', 'DANGER', 'CUT')),
  source text not null check (source in ('SYSTEM', 'AI', 'INGEST', 'USER')),
  device_id text,
  battery_id text references battery_asset(id) on delete set null,
  session_id text references measurement_session(id) on delete set null,
  occurred_at timestamptz not null,
  score numeric check (score is null or (score >= 0 and score <= 1)),
  params jsonb not null default '{}'::jsonb,
  acknowledged_at timestamptz,
  acknowledged_by text references "user"(id) on delete set null,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  constraint domain_event_dedupe_key_not_blank check (length(trim(dedupe_key)) > 0),
  constraint domain_event_id_not_blank check (length(trim(id)) > 0)
);

-- A replay may arrive after the source row is already committed.  Keep the
-- natural key unique independently of the generated/display event id.
create unique index if not exists uq_domain_event_dedupe_key
  on domain_event (dedupe_key);

-- Grade transitions use the anomaly natural key as their event identity.  Keep
-- the source tuple unique too, so a caller cannot accidentally create two
-- events for one device/evaluation timestamp under different dedupe strings.
create unique index if not exists uq_domain_event_source_time
  on domain_event (event_type, device_id, occurred_at);

-- F20 reads only anomaly grade transitions and buckets occurred_at.  The
-- leading event_type/severity columns keep that query selective while the
-- occurred_at suffix supports the range scan.
create index if not exists idx_domain_event_trend
  on domain_event (event_type, severity, occurred_at);

create index if not exists idx_domain_event_battery_time
  on domain_event (battery_id, occurred_at desc, id desc);

create index if not exists idx_domain_event_device_time
  on domain_event (device_id, occurred_at desc, id desc);

create index if not exists idx_domain_event_acknowledged
  on domain_event (acknowledged_at, occurred_at desc)
  where acknowledged_at is null;
