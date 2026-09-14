-- 006_diagnosis_progress_snapshot.sql — 단계 경계 복구용 진단 progress 스냅샷.
--
-- 런타임은 DiagnosisProgress 전체를 메모리에 유지한다. PostgreSQL에는
-- advanceDiagnosis가 phase를 바꾸는 순간의 마지막 progress만 저장한다.
-- 따라서 100ms/1초 tick마다 7KB jsonb를 갱신하지 않으면서도 프로세스가
-- 재시작되면 마지막 단계 경계에서 진단을 복구할 수 있다.

alter table diagnosis
  add column if not exists progress_snapshot jsonb;
