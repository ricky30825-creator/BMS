create table if not exists app_user_profile (
  user_id text primary key references "user"(id) on delete cascade,
  role text not null default 'USER' check (role in ('USER', 'ADMIN')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table app_user_profile
  add column if not exists status text not null default 'ACTIVE';

alter table app_user_profile
  drop constraint if exists app_user_profile_status_check;

alter table app_user_profile
  add constraint app_user_profile_status_check check (status in ('ACTIVE', 'SUSPENDED'));

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

create table if not exists battery_asset (
  id text primary key,
  owner_user_id text not null references "user"(id) on delete restrict,
  label text not null,
  chemistry text not null check (chemistry in ('LI_ION', 'LI_PO')),
  target_mode smallint not null check (target_mode in (1, 2)),
  series_count integer,
  maker text,
  model text,
  capacity_wh numeric,
  capacity_mah numeric,
  rated_output_current_a numeric,
  ops_status text not null default 'NORMAL' check (ops_status in ('NORMAL', 'WATCH', 'BLOCKED')),
  admin_memo text not null default '',
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_mode <> 2 or capacity_wh is not null or capacity_mah is not null),
  check (rated_output_current_a is null or rated_output_current_a > 0)
);

create index if not exists idx_battery_asset_owner on battery_asset (owner_user_id);
create index if not exists idx_battery_asset_ops_status on battery_asset (ops_status);

create table if not exists measurement_session (
  id text primary key,
  battery_id text not null references battery_asset(id) on delete restrict,
  owner_user_id text not null references "user"(id) on delete restrict,
  device_id text not null,
  target_mode smallint not null check (target_mode in (1, 2)),
  status text not null check (status in ('ACTIVE', 'ENDED')),
  end_reason text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create unique index if not exists uq_active_session_device
  on measurement_session (device_id) where status = 'ACTIVE';

create table if not exists relay_state (
  battery_id text primary key references battery_asset(id) on delete cascade,
  state text not null default 'CLOSED' check (state in ('CLOSED', 'OPEN')),
  interlock_engaged boolean not null default false,
  interlock_condition text,
  reason_code text,
  reason_params jsonb,
  changed_at timestamptz not null default now(),
  changed_by text
);

create table if not exists telemetry_metric (
  id bigserial primary key,
  session_id text references measurement_session(id) on delete set null,
  battery_id text references battery_asset(id) on delete set null,
  device_id text not null,
  measured_at timestamptz not null,
  voltage_v numeric,
  current_a numeric,
  power_w numeric,
  temp_contact numeric,
  temp_ir_surface numeric,
  gas_raw numeric,
  pressure_raw numeric,
  acoustic_raw numeric,
  soc_pct numeric,
  diag_phase text,
  load_target_a numeric
);

create index if not exists idx_telemetry_battery_time
  on telemetry_metric (battery_id, measured_at desc);

create table if not exists diagnosis (
  id text primary key,
  battery_id text not null references battery_asset(id) on delete restrict,
  session_id text not null references measurement_session(id) on delete restrict,
  kind text not null check (kind in ('QUICK', 'CAPACITY')),
  status text not null check (status in ('RUNNING', 'COMPLETED', 'ABORTED', 'FAILED')),
  phase text,
  input jsonb not null default '{}'::jsonb,
  result jsonb,
  started_at timestamptz not null default now(),
  estimated_end_at timestamptz,
  completed_at timestamptz
);

create unique index if not exists uq_active_diagnosis_battery
  on diagnosis (battery_id) where status = 'RUNNING';

create table if not exists idempotency_key (
  actor_user_id text not null,
  key text not null,
  request_hash text not null,
  status integer not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_user_id, key)
);
