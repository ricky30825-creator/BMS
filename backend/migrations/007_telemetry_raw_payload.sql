-- 007_telemetry_raw_payload.sql — 보존 가능한 edge wire payload.
--
-- 새 Consumer 적재 행은 항상 version-1 raw frame 전체를 보존한다. 기존
-- telemetry_metric 행이 이미 있는 환경에서도 migration을 적용할 수 있도록
-- nullable로 추가한다. 기존 행의 원본을 복원할 수 없으므로 빈 값을 채우지
-- 않는다.

alter table telemetry_metric
  add column if not exists raw_payload jsonb;
