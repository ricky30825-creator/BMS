-- 008_outbox_identity.sql — durable command identity and replay dedupe.
--
-- Existing outbox rows are retained.  The identity is kept in columns rather
-- than changing the version-1 Kafka payload shape so a later producer can
-- attach the durable id as message metadata while forwarding `payload`
-- unchanged to the edge.

alter table outbox
  add column if not exists event_id text;

alter table outbox
  add column if not exists dedupe_key text;

-- Rows created by the schema-only outbox from 004 need an identity before the
-- new NOT NULL constraints can be installed.  The synthetic values are stable
-- for the lifetime of the existing row and cannot collide with new UUID ids.
update outbox
set event_id = 'outbox_legacy_' || id::text
where event_id is null;

update outbox
set dedupe_key = 'outbox_legacy_' || id::text
where dedupe_key is null;

alter table outbox
  alter column event_id set not null,
  alter column dedupe_key set not null;

alter table outbox
  drop constraint if exists outbox_event_id_not_blank,
  drop constraint if exists outbox_dedupe_key_not_blank;

alter table outbox
  add constraint outbox_event_id_not_blank check (length(trim(event_id)) > 0),
  add constraint outbox_dedupe_key_not_blank check (length(trim(dedupe_key)) > 0);

create unique index if not exists uq_outbox_event_id on outbox (event_id);
create unique index if not exists uq_outbox_dedupe_key on outbox (dedupe_key);
