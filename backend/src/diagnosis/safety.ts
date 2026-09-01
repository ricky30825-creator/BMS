// 진단 중 안전 중단 판정. 정본은 스펙 §3-3이다.
//
// ⚠️ 문턱을 하드코딩하지 않는다. H2·H3 실측이 나오면 .env 숫자만 바꾸고
// 이 파일은 건드리지 않는다. 판정 규칙 자체를 바꿔야 하면 이 파일만
// 교체하며, 러너는 영향받지 않는다.
//
// failsafe.ts와 마찬가지로 `0`이 미설정 sentinel이다.

export type DiagnosisAbortReason =
  | "USER"
  | "TEMP_ABSOLUTE"
  | "TEMP_SLOPE"
  | "GAS"
  | "VOLTAGE_COLLAPSE"
  | "SESSION_ENDED"
  | "RELAY_CUT"
  | "DEVICE_OFFLINE";

export type DiagnosisSafetyThresholds = {
  surfaceCutoffC: number;      // 스펙 잠정 50°C — `정의 필요`(§8 H2)
  tempSlopeCPerMin: number;    // 스펙 잠정 5°C/min — 주 판단 근거
  gasRaw: number;
};

export const UNSET_DIAGNOSIS_THRESHOLDS: DiagnosisSafetyThresholds = Object.freeze({
  surfaceCutoffC: 0,
  tempSlopeCPerMin: 0,
  gasRaw: 0,
});

export type SafetySample = {
  voltageV: number;
  tempIrSurfaceC: number | null;
  gasRaw: number | null;
  tempSlopeCPerMin: number | null;
};

// 절대 온도 → 가스 → 상승률 → 전압 순으로 본다. 어느 것이든 중단하지만
// 보고되는 사유는 하나이므로 근거가 가장 확실한 것을 앞에 둔다.
export function judgeDiagnosisAbort(
  kind: "QUICK" | "CAPACITY",
  sample: SafetySample,
  vLightLoadV: number | null,
  thresholds: DiagnosisSafetyThresholds
): DiagnosisAbortReason | null {
  if (thresholds.surfaceCutoffC > 0 && sample.tempIrSurfaceC !== null && sample.tempIrSurfaceC >= thresholds.surfaceCutoffC) {
    return "TEMP_ABSOLUTE";
  }
  if (thresholds.gasRaw > 0 && sample.gasRaw !== null && sample.gasRaw >= thresholds.gasRaw) {
    return "GAS";
  }
  if (thresholds.tempSlopeCPerMin > 0 && sample.tempSlopeCPerMin !== null && sample.tempSlopeCPerMin > thresholds.tempSlopeCPerMin) {
    return "TEMP_SLOPE";
  }
  // ⚠️ 전압 붕괴(래치오프 포함)는 중단 사유가 아니다 — 스펙 §3-2 ②.
  // "이탈은 점진적 처짐만이 아니라 래치오프(출력 소실, 5V→0V)로도
  // 나타난다 … 소실도 정상적인 이탈 관측으로 기록하고, 부하 0A → 팩
  // 재기동 대기 절차를 밟는다." 붕괴 전류를 찾는 것 자체가 빠른 진단의
  // 목적이라, 여기서 중단하면 열화된 팩(이 기능이 존재하는 이유)은
  // 영원히 등급을 받지 못하고 건강한 팩만 결과가 나오는 역전이 생긴다.
  // QUICK은 러너가 남은 래더를 마저 돌아 COMPLETED로 등급을 낸다.
  // CAPACITY는 이미 러너 자신이 같은 조건을 정상 컷오프로 처리한다
  // (runner.ts의 COLLAPSE_RATIO 사용처 참조). `VOLTAGE_COLLAPSE`는
  // 공개 API 계약의 `abortReason` enum 멤버로만 남겨 둔다 — 다시
  // 추가하지 말 것.
  return null;
}
