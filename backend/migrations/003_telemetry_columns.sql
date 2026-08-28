-- 003_telemetry_columns.sql — Q2. 에지 프레임에는 있는데 telemetry_metric에 자리가
-- 없던 4개 값을 만든다. 결정일 2026-08-28.
--
-- ⚠️ 이 마이그레이션은 **데이터를 모으기 시작하기 전에** 적용해야 한다.
--    나중에 붙이면 그때까지 쌓인 프레임에는 이 값이 영영 없다.

-- age_ms · temp_points는 jsonb다. 컬럼으로 펼치지 않는 이유:
--   · age_ms는 희소 맵이다 — "키가 없으면 이번 프레임 실측"이라 필드 개수가
--     프레임마다 다르고, 컬럼으로 펼치면 대부분 null이 된다.
--   · temp_points.ir의 길이는 고정이 아니다. CLAUDE.md가 "길이 2를 코드에 상수로
--     박지 마라"고 명시했다 — IR 어레이(MLX90640 등)로 바꾸면 ROI 존 개수로 바뀌고,
--     컬럼으로 박아두면 그때 마이그레이션이 필요해진다. contact는 3 고정이지만
--     같은 컬럼에 두는 편이 다루기 쉽다.
--   · Timescale 압축과도 잘 맞는다(반복이 많은 값이다).
alter table telemetry_metric add column if not exists age_ms jsonb;
alter table telemetry_metric add column if not exists temp_points jsonb;

-- mode는 조인으로 복구할 수 없는 경우가 있어서 반드시 프레임에서 받아 적재한다.
-- 활성 세션이 없는 프레임은 battery_id = null로 적재하는 것이 규칙이므로
-- (docs/handover/b2-session-tagging.md §3) 그 프레임들의 모드는 battery_asset을
-- 조인해도 알 수 없다. 에지는 프레임에 mode를 싣는다.
alter table telemetry_metric add column if not exists mode smallint;
alter table telemetry_metric drop constraint if exists telemetry_metric_mode_check;
alter table telemetry_metric
  add constraint telemetry_metric_mode_check check (mode is null or mode in (1, 2));

-- soc_basis는 모드 1의 절대 SOC와 모드 2의 상대 SOC를 구분한다. 같은 값으로
-- 취급하면 조용히 틀린다(CLAUDE.md). 기준을 만들 수 없으면 soc_pct도 null이다.
alter table telemetry_metric add column if not exists soc_basis text;
alter table telemetry_metric drop constraint if exists telemetry_metric_soc_basis_check;
alter table telemetry_metric
  add constraint telemetry_metric_soc_basis_check
  check (soc_basis is null or soc_basis in ('ABSOLUTE_GAUGE', 'RELATIVE_SESSION_START'));

-- 이 4개가 채워지면 CSV_HEADER(store/types.ts:110)의 mode·soc_basis·age_ms 열이
-- 비어 있지 않게 된다.
