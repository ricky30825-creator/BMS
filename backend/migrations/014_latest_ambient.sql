-- 014_latest_ambient.sql — 대시보드 발열값용 최신 실온. 결정일 2026-09-25.
--
-- 대시보드는 battery_latest 1행으로 현재값을 낸다. 발열값(= 대표 온도 − 실온)을
-- 서버가 계산하려면 대표 온도와 **같은 프레임의** 실온이 필요하다
-- (telemetry_metric.temp_ambient는 013에서 추가됨).
--
-- 새 프레임에 실온이 없으면 null로 덮어쓴다. 이전 프레임의 실온을 남겨 두면
-- 오래된 실온과 새 표면온도가 짝지어져 발열값이 조용히 틀린다.
alter table battery_latest add column if not exists temp_ambient numeric;
