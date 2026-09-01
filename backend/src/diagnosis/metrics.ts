// 모드 2 진단 산식. 정본은
// docs/hardware/mode2_powerbank_diagnosis_spec.md §3-2·§3-4·§4-2다.
//
// ⚠️ 이 파일은 스토어를 import하지 않는다. store/types.ts가 PhaseWindow를
// import하므로 반대 방향은 순환 참조다.

export type PhaseWindow = {
  phase: string;
  loadTargetA: number;
  voltageMedianV: number;               // voltageSamples의 중앙값. 러너가 갱신한다
  voltageSamples: number[];             // 원자료. 중앙값을 다시 낼 수 있어야 한다
  currentMedianA: number;          // 부호 살림(방전 = 음수). 산식은 abs()를 쓴다
  tempSamples: { atMs: number; tempIrSurfaceC: number }[];
  latchOff: boolean;
};

// 출력이 사라졌다고 판정하는 우리 쪽 검출 문턱. IC 내부 차단 조건인
// "<4.4V가 30ms 지속"과는 다른 값이며, 우리는 결과로 나타난 출력 소실만 본다.
export const LATCH_OFF_VOLTAGE_V = 1.0;

// 레귤레이션 이탈 문턱. 5V에서 4.70V이며 USB 2.0 다운스트림 포트 하한
// 4.75V 바로 아래다. 절대값이 아니라 비율이라 9V·12V PD에서도 성립한다.
export const REGULATION_RATIO = 0.94;

// 컨버터가 완전히 무너진 상태.
export const COLLAPSE_RATIO = 0.8;

const P0_PHASE = "P0";
const THERMAL_PHASE = "P3";

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// 기준전압은 무부하 전압이 아니라 경부하 출력전압이다(스펙 §2-6).
export function vLightLoadV(windows: PhaseWindow[]): number | null {
  const p0 = windows.find((w) => w.phase === P0_PHASE);
  return p0 ? p0.voltageMedianV : null;
}

export type KneeResult = {
  regulationKneeA: number | null;
  kneeIsUpperBound: boolean;
  latchOff: boolean;
};

export function regulationKnee(windows: PhaseWindow[]): KneeResult {
  const vLight = vLightLoadV(windows);
  if (vLight === null) return { regulationKneeA: null, kneeIsUpperBound: false, latchOff: false };
  const threshold = vLight * REGULATION_RATIO;

  // P0은 기준을 만드는 단계라 판정 대상에서 뺀다. 부하가 올라가는
  // 순서대로 보므로 저전류→상행이 보장된다(스펙 §3-2 ②).
  const candidates = windows.filter((w) => w.phase !== P0_PHASE);
  const departed = candidates.find((w) => w.latchOff || w.voltageMedianV < threshold);

  if (departed) {
    return { regulationKneeA: departed.loadTargetA, kneeIsUpperBound: false, latchOff: departed.latchOff };
  }
  const highest = candidates.reduce((max, w) => Math.max(max, w.loadTargetA), 0);
  return { regulationKneeA: highest || null, kneeIsUpperBound: true, latchOff: false };
}

// 최소자승을 쓰는 이유: 두 점 차분은 IR 노이즈에 취약하다(스펙 §3-2 ②).
export function thermalSlopeCPerMin(windows: PhaseWindow[]): number | null {
  const window = windows.find((w) => w.phase === THERMAL_PHASE);
  if (!window || window.tempSamples.length < 2) return null;
  const points = window.tempSamples;
  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.atMs, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.tempIrSurfaceC, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.atMs - meanX) * (point.tempIrSurfaceC - meanY);
    denominator += (point.atMs - meanX) ** 2;
  }
  if (denominator === 0) return null;
  const slopePerMs = numerator / denominator;
  return slopePerMs * 60_000;
}

export function specAttainmentPct(windows: PhaseWindow[], ratedOutputCurrentA: number | null): number | null {
  if (ratedOutputCurrentA === null || ratedOutputCurrentA <= 0) return null;
  const vLight = vLightLoadV(windows);
  if (vLight === null) return null;
  const threshold = vLight * REGULATION_RATIO;
  const sustained = windows
    .filter((w) => w.phase !== P0_PHASE && !w.latchOff && w.voltageMedianV >= threshold)
    .reduce((max, w) => Math.max(max, w.loadTargetA), 0);
  return (Math.min(sustained, ratedOutputCurrentA) / ratedOutputCurrentA) * 100;
}

export type QuickGrade = "HEALTHY" | "CAUTION" | "SUSPECT_DEGRADED" | "BASELINE_PENDING";

export type QuickGradeInput = {
  regulationKneeA: number | null;
  ratedOutputCurrentA: number | null;
  thermalSlopeCPerMin: number | null;
  s1CPerMin: number;                 // 0 = 미설정
  specAttainmentPct: number | null;
};

const ATTAINMENT_PASS_PCT = 95;
const SEVERE_KNEE_FRACTION = 0.7;

// ⚠️ 이 등급은 이상점수 4등급과 다른 축이다. 열화는 수명, 이상점수는
// 열폭주 위험이다. 두 값을 합산하거나 같은 enum으로 취급하지 않는다.
export function quickGrade(input: QuickGradeInput): { grade: QuickGrade; gradeProvisional: boolean } {
  const { regulationKneeA, ratedOutputCurrentA, thermalSlopeCPerMin: slope, s1CPerMin, specAttainmentPct: attainment } = input;
  const gradeProvisional = s1CPerMin === 0;

  const kneeObservable = regulationKneeA !== null && ratedOutputCurrentA !== null && ratedOutputCurrentA > 0;
  const slopeObservable = s1CPerMin > 0 && slope !== null;
  const attainObservable = attainment !== null;
  const observable = [kneeObservable, slopeObservable, attainObservable].filter(Boolean).length;

  if (observable < 2) return { grade: "BASELINE_PENDING", gradeProvisional };

  const kneeViolated = kneeObservable && regulationKneeA! < ratedOutputCurrentA!;
  const slopeViolated = slopeObservable && slope! >= s1CPerMin;
  const attainViolated = attainObservable && attainment! < ATTAINMENT_PASS_PCT;
  const violations = [kneeViolated, slopeViolated, attainViolated].filter(Boolean).length;

  const severeKnee = kneeObservable && regulationKneeA! < ratedOutputCurrentA! * SEVERE_KNEE_FRACTION;
  if (severeKnee || violations >= 2) return { grade: "SUSPECT_DEGRADED", gradeProvisional };
  if (violations === 1) return { grade: "CAUTION", gradeProvisional };
  return { grade: "HEALTHY", gradeProvisional };
}
