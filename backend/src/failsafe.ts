// 서버 Fail-Safe 판정. AI 점수와 무관하게 동작한다 — 계약 §3.3:
//   "가스·압력·음향 임계 초과 또는 온도 상한/상승률 초과 시, AI 판정과
//    무관하게 즉시 릴레이 차단한다."
//
// ⚠️ 문턱값은 아직 실측 전이다(mode1 §13 H8, mode2 §8 H2). `0`을 미설정
// sentinel로 두고 그 계층을 비활성화한다 — F21의 Q36 확정 방식과 같다.
// backend_contract.md:746의 55/60°C는 지표 배지 표시용이지 차단 문턱이 아니다.

export type HardwareProfile = "MODE1_EXTERNAL_CELL_V1" | "MODE2_FULL" | "COMBINED_EXISTING_PARTS_V1";

export type FailsafeTriggerCode =
  | "FAILSAFE_TEMP_CONTACT_OVER_CAP"
  | "FAILSAFE_TEMP_IR_OVER_CAP"
  | "FAILSAFE_TEMP_RISE_RATE"
  | "FAILSAFE_GAS_OVER_THRESHOLD"
  | "FAILSAFE_PRESSURE_RISE";

export type FailsafeThresholds = {
  tempContactCapC: number;
  tempIrCapC: number;
  tempRiseRateCPerMin: number;
  pressureRisePct: number;
  gasRaw: number;
};

export type FailsafeSample = {
  tempContact: number | null;
  tempIrSurface: number | null;
  tempRiseRateCPerMin: number | null;
  pressureRaw: number | null;
  pressureBaseline: number | null;
  gasRaw: number | null;
};

export type FailsafeVerdict = { triggerCode: FailsafeTriggerCode; condition: string } | null;

// 실측 전 기본값. 전부 0이므로 어떤 계층도 차단하지 않는다.
export const UNSET_THRESHOLDS: FailsafeThresholds = Object.freeze({
  tempContactCapC: 0,
  tempIrCapC: 0,
  tempRiseRateCPerMin: 0,
  pressureRisePct: 0,
  gasRaw: 0,
});

// 하드웨어 프로필별로 실제 존재하는 센서. 없는 센서의 코드는 발생시키지
// 않는다(계약 §3.3). 모드 1에 MQ-2를 안 단 이유는 CLAUDE.md 참조 —
// 히터가 상시 발열해 같은 셀의 온도 센서 4개와 실온 센서를 오염시킨다.
const AVAILABLE: Record<HardwareProfile, ReadonlySet<FailsafeTriggerCode>> = {
  MODE1_EXTERNAL_CELL_V1: new Set([
    "FAILSAFE_TEMP_CONTACT_OVER_CAP",
    "FAILSAFE_TEMP_IR_OVER_CAP",
    "FAILSAFE_TEMP_RISE_RATE",
    "FAILSAFE_PRESSURE_RISE",
  ]),
  MODE2_FULL: new Set([
    "FAILSAFE_TEMP_IR_OVER_CAP",
    "FAILSAFE_TEMP_RISE_RATE",
    "FAILSAFE_GAS_OVER_THRESHOLD",
  ]),
  COMBINED_EXISTING_PARTS_V1: new Set([
    "FAILSAFE_TEMP_IR_OVER_CAP",
    "FAILSAFE_TEMP_RISE_RATE",
  ]),
};

// 절대 온도 → 가스 → 압력 → 상승률 순으로 본다. 어느 것이든 차단하지만
// 보고되는 코드는 하나이므로, 근거가 가장 확실한 것을 앞에 둔다.
export function judgeFailsafe(profile: HardwareProfile, sample: FailsafeSample, thresholds: FailsafeThresholds): FailsafeVerdict {
  const available = AVAILABLE[profile];
  const active = (code: FailsafeTriggerCode, threshold: number) => available.has(code) && threshold > 0;

  if (active("FAILSAFE_TEMP_IR_OVER_CAP", thresholds.tempIrCapC) && sample.tempIrSurface !== null && sample.tempIrSurface >= thresholds.tempIrCapC) {
    return { triggerCode: "FAILSAFE_TEMP_IR_OVER_CAP", condition: "TEMP_OVER_CAP" };
  }
  if (active("FAILSAFE_TEMP_CONTACT_OVER_CAP", thresholds.tempContactCapC) && sample.tempContact !== null && sample.tempContact >= thresholds.tempContactCapC) {
    return { triggerCode: "FAILSAFE_TEMP_CONTACT_OVER_CAP", condition: "TEMP_OVER_CAP" };
  }
  if (active("FAILSAFE_GAS_OVER_THRESHOLD", thresholds.gasRaw) && sample.gasRaw !== null && sample.gasRaw >= thresholds.gasRaw) {
    return { triggerCode: "FAILSAFE_GAS_OVER_THRESHOLD", condition: "GAS_OVER_THRESHOLD" };
  }
  // 압력은 절대값이 무의미하다 — FSR은 예압에 따라 baseline이 매번 달라진다.
  // baseline은 세션마다 시작 10초 중앙값으로 새로 잡는다(CLAUDE.md).
  if (active("FAILSAFE_PRESSURE_RISE", thresholds.pressureRisePct)
    && sample.pressureRaw !== null && sample.pressureBaseline !== null && sample.pressureBaseline >= 500) {
    const risePct = ((sample.pressureRaw - sample.pressureBaseline) / sample.pressureBaseline) * 100;
    if (risePct >= thresholds.pressureRisePct) return { triggerCode: "FAILSAFE_PRESSURE_RISE", condition: "PRESSURE_RISE" };
  }
  if (active("FAILSAFE_TEMP_RISE_RATE", thresholds.tempRiseRateCPerMin) && sample.tempRiseRateCPerMin !== null && sample.tempRiseRateCPerMin >= thresholds.tempRiseRateCPerMin) {
    return { triggerCode: "FAILSAFE_TEMP_RISE_RATE", condition: "TEMP_RISE_RATE" };
  }
  return null;
}
