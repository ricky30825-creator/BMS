-- 002_domain_gaps.sql — 001의 도메인 스키마에서 비어 있던 자리를 메운다.
-- 결정일 2026-08-28. 근거: docs/handover/schema-open-questions.md Q6 · Q4, 그리고
-- "활성 세션 범위" 결정(아래 §3).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. 데모 사용자 프로필 seed (000_identity.sql의 4명과 한 쌍)
--    role/status/phone은 backend/src/store/memory.ts:29-33과 같아야 한다.
--    DemoUser는 "user"(name·email) ⋈ app_user_profile(role·status·phone)이다.
-- ─────────────────────────────────────────────────────────────────────────────
insert into app_user_profile (user_id, role, status, phone, created_at, updated_at) values
  ('hong',     'USER',  'ACTIVE',    '010-1234-5678', timestamptz '2025-03-12 00:00:00+00', now()),
  ('kimeng',   'USER',  'ACTIVE',    '010-2345-6789', timestamptz '2024-11-02 00:00:00+00', now()),
  ('leelab',   'ADMIN', 'ACTIVE',    '010-3456-7890', timestamptz '2024-08-19 00:00:00+00', now()),
  ('parktest', 'USER',  'SUSPENDED', '010-4567-8901', timestamptz '2025-06-10 00:00:00+00', now())
on conflict (user_id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Q6 — battery_asset.memo (사용자 메모)
--    store/types.ts에는 memo(소유자)·adminMemo(관리자) 둘 다 있는데 DDL에는
--    admin_memo만 있었다. 둘은 권한이 다르다 — saveMemo(관리자, 감사 로그 동반) vs
--    updateBattery(소유자). 합치면 소유자가 관리자 메모를 덮어쓰므로 별도 컬럼이다.
--    store/types.ts는 바뀌지 않는다.
-- ─────────────────────────────────────────────────────────────────────────────
alter table battery_asset add column if not exists memo text not null default '';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. 활성 세션은 **설비 전체에 1개**다 (결정 2026-08-28)
--
--    001의 uq_active_session_device는 device_id당 1개(per-device)였다. 전역으로
--    확정했으므로 교체한다. 하드웨어 제약과도 맞는다 — BQ27441(0x55)은 I2C 주소가
--    고정이라 한 번에 배터리 1개만 측정할 수 있다(CLAUDE.md).
--
--    ⚠️ docs/backend_contract.md의 "device_id당 ACTIVE 세션 최대 1개" 서술은
--       이 결정에 맞춰 고쳤다. 계약 테스트 20건은 이 차이를 검출하지 못하므로
--       (같은 사용자·같은 진단기로만 startSession을 두 번 부른다) DB 제약이
--       유일한 방어선이다.
--
--    구현 노트: status 컬럼에 partial unique를 건다. 인덱스에 들어오는 행은 전부
--    status='ACTIVE'라, status에 유니크를 걸면 그런 행이 최대 1개가 된다.
-- ─────────────────────────────────────────────────────────────────────────────
drop index if exists uq_active_session_device;

create unique index if not exists uq_active_session_global
  on measurement_session (status) where status = 'ACTIVE';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Q4 — 진단기(device) 테이블
--    Consumer의 battery_id 태깅이 전부 device_id로 measurement_session을 조회하는데
--    그 device_id의 출처 테이블이 없었다. 관리자 화면의 진단기 ONLINE/OFFLINE 판정도
--    근거가 없었다.
--
--    hardware_profile은 backend/src/failsafe.ts:9의 HardwareProfile 타입과 한 쌍이다.
--    CLAUDE.md가 언급하는 MODE2_FULL은 아직 그 타입에 없으므로 여기에도 넣지 않는다 —
--    failsafe.ts가 배우는 시점에 함께 추가한다.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists device (
  id text primary key,
  owner_user_id text references "user"(id) on delete set null,
  label text not null default '',
  hardware_profile text not null default 'MODE1_EXTERNAL_CELL_V1'
    check (hardware_profile in ('MODE1_EXTERNAL_CELL_V1', 'COMBINED_EXISTING_PARTS_V1')),
  last_seen_at timestamptz,
  status text not null default 'OFFLINE' check (status in ('ONLINE', 'OFFLINE', 'UNKNOWN')),
  created_at timestamptz not null default now()
);

create index if not exists idx_device_owner on device (owner_user_id);

-- 데모 진단기. id는 memory.ts:154 · server.ts:794 · types.ts:115의 상수와 같아야 한다.
insert into device (id, owner_user_id, label, hardware_profile) values
  ('demo-device-01', 'hong', '진단기 A', 'MODE1_EXTERNAL_CELL_V1')
on conflict (id) do nothing;

-- 세션은 반드시 등록된 진단기의 것이어야 한다.
-- (telemetry_metric.device_id에는 FK를 걸지 않는다 — 초당 10행이 들어오는
--  하이퍼테이블이고, 미등록 진단기의 프레임도 버리지 않고 적재해야 한다.)
alter table measurement_session drop constraint if exists fk_session_device;
alter table measurement_session
  add constraint fk_session_device foreign key (device_id) references device(id) on delete restrict;
