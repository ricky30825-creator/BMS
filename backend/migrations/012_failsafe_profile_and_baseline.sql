-- 012_failsafe_profile_and_baseline.sql
-- Fail-Safe supports the fully instrumented mode-2 profile and stores the
-- pressure baseline once per mode-1 measurement session. The first finalized
-- baseline is immutable so retries and process restarts cannot reuse a prior
-- session's value or reinterpret an attachment failure.

alter table device drop constraint if exists device_hardware_profile_check;
alter table device
  add constraint device_hardware_profile_check
  check (hardware_profile in (
    'MODE1_EXTERNAL_CELL_V1',
    'MODE2_FULL',
    'COMBINED_EXISTING_PARTS_V1'
  ));

create table if not exists failsafe_pressure_baseline (
  session_id text primary key references measurement_session(id) on delete cascade,
  baseline_raw numeric,
  status text not null check (status in ('VALID', 'ATTACHMENT_INVALID', 'NO_SAMPLES')),
  finalized_at timestamptz not null default clock_timestamp(),
  constraint failsafe_pressure_baseline_value_consistent check (
    (status = 'NO_SAMPLES') = (baseline_raw is null)
  )
);
