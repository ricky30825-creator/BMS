-- 009_outbox_delivery.sql — leased delivery, retry scheduling, and poison rows.
--
-- 004/008 own the transactional outbox and durable identity.  This migration
-- only adds delivery-worker state; it does not change the version-1 Kafka
-- payload or the domain transaction that creates an outbox row.

alter table outbox
  add column if not exists next_attempt_at timestamptz;

update outbox
set next_attempt_at = coalesce(next_attempt_at, created_at)
where next_attempt_at is null;

alter table outbox
  alter column next_attempt_at set default now(),
  alter column next_attempt_at set not null;

alter table outbox
  add column if not exists claimed_by text,
  add column if not exists claim_token text,
  add column if not exists claimed_at timestamptz,
  add column if not exists lease_until timestamptz,
  add column if not exists dead_at timestamptz;

-- A poison row is retained for audit/recovery, but is excluded from delivery
-- ordering after it is marked dead.  `sent_at` remains null because no Kafka
-- publish succeeded for such a row.
create index if not exists idx_outbox_delivery_ready
  on outbox (next_attempt_at, id)
  where sent_at is null and dead_at is null;

create index if not exists idx_outbox_delivery_partition
  on outbox (partition_key, id)
  where sent_at is null and dead_at is null;
