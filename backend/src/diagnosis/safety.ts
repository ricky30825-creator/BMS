// 진단 중 안전 중단 판정. 정본은 스펙 §3-3이다.
//
// ⚠️ 문턱을 하드코딩하지 않는다. H2·H3 실측이 나오면 .env 숫자만 바꾸고
// 이 파일은 건드리지 않는다. 판정 규칙 자체를 바꿔야 하면 이 파일만
// 교체하며, 러너는 영향받지 않는다.
//
// failsafe.ts와 마찬가지로 `0`이 미설정 sentinel이다.

import { COLLAPSE_RATIO } from "./metrics.js";

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
  // ⚠️ 전압 붕괴는 QUICK에서만 중단 사유다. CAPACITY에서 같은 조건은
  // 정상 컷오프(→ COMPLETED)이며, 러너가 그렇게 처리한다.
  if (kind === "QUICK" && vLightLoadV !== null && sample.voltageV < vLightLoadV * COLLAPSE_RATIO) {
    return "VOLTAGE_COLLAPSE";
  }
  return null;
}
