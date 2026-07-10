create table if not exists app_user_profile (
  user_id text primary key references "user"(id) on delete cascade,
  role text not null default 'USER' check (role in ('USER', 'ADMIN')),
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_log (
  id bigserial primary key,
  actor_user_id text references "user"(id) on delete set null,
  action text not null,
  resource text not null,
  result text not null check (result in ('SUCCESS', 'DENIED', 'FAILED')),
  reason text,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_actor_created_at
  on audit_log (actor_user_id, created_at desc);

create index if not exists idx_audit_log_action_created_at
  on audit_log (action, created_at desc);
