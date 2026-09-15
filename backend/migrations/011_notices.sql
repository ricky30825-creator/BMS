-- 011_notices.sql — persistent notices, per-user view dedupe, and delivery intents.
--
-- Notice text is user-authored and is intentionally stored as text rather than
-- rendered HTML.  The API returns it as text; callers must not interpret it as
-- markup.  Drafts may be incomplete, but a notice must have a non-blank title
-- and body before it can enter PUBLISHED.

create table if not exists notice (
  id text primary key,
  category text not null check (category in ('IMPORTANT', 'MAINTENANCE', 'FEATURE', 'INFO')),
  audience text not null check (audience in ('ALL', 'USER', 'ADMIN')),
  status text not null check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  title text not null default '',
  body text not null default '',
  view_count bigint not null default 0 check (view_count >= 0),
  published_at timestamptz,
  archived_at timestamptz,
  created_by text references "user"(id) on delete set null,
  updated_by text references "user"(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notice_published_at_check check (
    status <> 'PUBLISHED' or published_at is not null
  ),
  constraint notice_archived_at_check check (
    status <> 'ARCHIVED' or archived_at is not null
  )
);

create index if not exists idx_notice_public_order
  on notice (status, audience, published_at desc, id desc);

create index if not exists idx_notice_admin_order
  on notice (status, coalesce(published_at, created_at) desc, id desc);

create table if not exists notice_view (
  notice_id text not null references notice(id) on delete cascade,
  viewer_user_id text not null references "user"(id) on delete cascade,
  last_viewed_at timestamptz not null,
  primary key (notice_id, viewer_user_id)
);

create index if not exists idx_notice_view_last_viewed
  on notice_view (viewer_user_id, last_viewed_at desc);

create table if not exists notice_delivery_intent (
  id bigserial primary key,
  notice_id text not null references notice(id) on delete cascade,
  channel text not null check (channel in ('KAKAO', 'EMAIL', 'SMS', 'WEBPUSH', 'INAPP')),
  status text not null check (status in ('PENDING', 'SENT', 'FAILED', 'BLOCKED')),
  requested_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  unique (notice_id, channel)
);

create index if not exists idx_notice_delivery_status
  on notice_delivery_intent (status, requested_at desc);
