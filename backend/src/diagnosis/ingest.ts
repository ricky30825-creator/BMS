// 진단 계측 소스의 포트. 백엔드는 "샘플이 들어온다"만 알고 그게 어디서
// 오는지 모른다.
//
//   오늘  : simulator.ts 가 구현
//   나중  : Kafka consumer 가 같은 인터페이스를 구현
//
// 러너와 산식은 이 인터페이스만 보므로, 실물이 붙어도 metrics.ts·runner.ts는
// 바뀌지 않는다.

import type { DemoBattery, DemoDiagnosis } from "../store/types.js";

export type DiagnosisSample = {
  atMs: number;                     // 진단 시작 기준 경과 ms
  voltageV: number;
  currentA: number;                 // 부호 살림. 방전 = 음수
  tempIrSurfaceC: number | null;
  gasRaw: number | null;
  loadTargetA: number;              // 그 프레임에서 지시한 목표 전류
};

export interface DiagnosisSource {
  sample(
    battery: DemoBattery,
    diagnosis: DemoDiagnosis,
    elapsedMs: number,
    loadTargetA: number,
    deliveredWh: number
  ): DiagnosisSample;
}
