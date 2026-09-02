// 모드 2 진단 산식. 정본은
// docs/hardware/mode2_powerbank_diagnosis_spec.md §3-2·§3-4·§4-2다.
//
// ⚠️ 이 파일은 스토어를 import하지 않는다. store/types.ts가 PhaseWindow를
// import하므로 반대 방향은 순환 참조다.

// 사다리를 소유한 쪽이 phases.ts이므로 단계 이름도 거기서 가져온다.
// phases.ts는 아무것도 import하지 않아 순환이 생기지 않는다. (P0·P3·P5는
// 이 파일에 로컬 상수로 남아 있는데, 그건 이 변경보다 앞선 관례라
// 그대로 뒀다 — 등급 산식이 걸려 있어 함께 손대지 않는다.)
import { THERMAL_PROBE_PHASE } from "./phases.js";

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
const RECOVERY_PHASE = "P5";

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
  //
  // ⚠️ P7(발열 탐침)도 뺀다. 두 가지 이유가 있고 둘 다 조용히 틀린다:
  // ① 되먹임 — P7의 부하가 이 함수가 낸 붕괴점의 0.9배라, P7을 후보에
  //    넣으면 다음 tick의 붕괴점이 P7 부하가 되고 그 0.9배가 다시 P7
  //    부하가 되어 매 tick 0.9배씩 줄어든다.
  // ② 등급 불변 — P7은 기존 열화 등급의 입력이 아니다. 후보에 넣으면
  //    등급 산식을 한 줄도 안 고쳤는데 등급이 달라진다.
  const candidates = windows.filter((w) => w.phase !== P0_PHASE && w.phase !== THERMAL_PROBE_PHASE);
  const departed = candidates.find((w) => w.latchOff || w.voltageMedianV < threshold);

  if (departed) {
    return { regulationKneeA: departed.loadTargetA, kneeIsUpperBound: false, latchOff: departed.latchOff };
  }
  const highest = candidates.reduce((max, w) => Math.max(max, w.loadTargetA), 0);
  return { regulationKneeA: highest || null, kneeIsUpperBound: true, latchOff: false };
}

// 최소자승 기울기(°C/ms). 두 함수가 공유하는 계산 — 두 점 차분은 IR
// 노이즈에 취약해 둘 다 최소자승을 쓴다(스펙 §3-2 ②). x분산이 0이면(타임
// 스탬프가 전부 같으면) null — 기울기가 정의되지 않는다.
function leastSquaresSlopePerMs(points: { atMs: number; tempIrSurfaceC: number }[]): number | null {
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
  return numerator / denominator;
}

// 한 단계 창의 온도 기울기(°C/분). 두 점 차분은 IR 노이즈에 취약해
// 최소자승을 쓴다(스펙 §3-2 ②).
function phaseSlopeCPerMin(windows: PhaseWindow[], phase: string): number | null {
  const window = windows.find((w) => w.phase === phase);
  if (!window || window.tempSamples.length < 2) return null;
  const slopePerMs = leastSquaresSlopePerMs(window.tempSamples);
  return slopePerMs === null ? null : slopePerMs * 60_000;
}

// 등급 산식(스펙 §3-2 ②) 전용 — P3 40초 창의 기울기만 본다. 안전 판정에는
// 쓰지 않는다(P3는 t=70s부터 채워지고 t=90s에 멎는다 — rollingTempSlopeCPerMin
// 참조).
export function thermalSlopeCPerMin(windows: PhaseWindow[]): number | null {
  return phaseSlopeCPerMin(windows, THERMAL_PHASE);
}

// P7(발열 탐침) 창에 실제로 걸린 부하 전류. 창이 없으면 null.
export function thermalProbeLoadA(windows: PhaseWindow[]): number | null {
  const window = windows.find((w) => w.phase === THERMAL_PROBE_PHASE);
  return window ? window.loadTargetA : null;
}

// 정규화된 발열 — P7의 온도 기울기를 그 구간의 전력으로 나눈다(스펙 §9-3
// 피처 #6 dT_per_W). 발열 기울기는 dT/dt ≈ P/C라 팩의 열용량(무게에 비례)에
// 좌우된다 — 큰 팩과 작은 팩에 같은 부하를 걸면 열화와 무관하게 작은 팩이
// 몇 배 빨리 뜬다. 전력으로 정규화하면 부하 크기 차이가 흡수되고, C와
// 열 결합은 그 팩의 상수라 같은 자산의 세션 간 비교가 성립한다.
// ⚠️ 판정하지 않는다 — 문턱·등급은 이 함수의 범위 밖이다.
export function thermalPerWattCPerMinPerW(windows: PhaseWindow[]): number | null {
  const window = windows.find((w) => w.phase === THERMAL_PROBE_PHASE);
  if (!window) return null;
  const slope = phaseSlopeCPerMin(windows, THERMAL_PROBE_PHASE);
  if (slope === null) return null;
  // 방전이라 currentMedianA는 음수다 — 반드시 abs()로 전력을 낸다
  // (PhaseWindow 주석의 부호 규약).
  const powerW = Math.abs(window.voltageMedianV * window.currentMedianA);
  if (!Number.isFinite(powerW) || powerW <= 0) return null;
  return slope / powerW;
}

// 회복(P5) 구간의 온도 기울기. 부호가 정보다 — 부하를 0.1A로 내렸는데
// 온도가 계속 오르면(양수) 내부 발열이 확정적이라는 뜻이며, 스펙 §9-7이
// 안전 바닥에 올려둔 "최강 적신호"다. ⚠️ 다만 이 함수는 원값만 낸다 —
// 이번 작업에서는 판정에 쓰지 않는다(문턱·승격 여부는 미정).
export function recoverySlopeCPerMin(windows: PhaseWindow[]): number | null {
  return phaseSlopeCPerMin(windows, RECOVERY_PHASE);
}

// 안전 판정 전용 — 단계와 무관하게 최근 창(rollingTempSlopeCPerMin의
// 호출부가 시간으로 트리밍한 표류값)의 기울기를 낸다. thermalSlopeCPerMin과
// 달리 위상(P0~P5)을 모르며, 그래서 CAPACITY(단계가 없는 진단)에서도 동작한다
// — 이게 이 함수가 따로 존재하는 이유다.
export function rollingTempSlopeCPerMin(
  samples: { atMs: number; tempIrSurfaceC: number }[],
  minSamples: number,
): number | null {
  if (samples.length < minSamples) return null;
  const slopePerMs = leastSquaresSlopePerMs(samples);
  return slopePerMs === null ? null : slopePerMs * 60_000;
}

export function specAttainmentPct(windows: PhaseWindow[], ratedOutputCurrentA: number | null): number | null {
  if (ratedOutputCurrentA === null || ratedOutputCurrentA <= 0) return null;
  const vLight = vLightLoadV(windows);
  if (vLight === null) return null;
  const threshold = vLight * REGULATION_RATIO;
  const sustained = windows
    // P7 제외 이유는 regulationKnee와 같다 — 사다리가 아닌 구간이 "지속
    // 도달 전류"의 최댓값을 올려 도달률을, 나아가 등급을 바꾼다.
    .filter((w) => w.phase !== P0_PHASE && w.phase !== THERMAL_PROBE_PHASE && !w.latchOff && w.voltageMedianV >= threshold)
    .reduce((max, w) => Math.max(max, w.loadTargetA), 0);
  return (Math.min(sustained, ratedOutputCurrentA) / ratedOutputCurrentA) * 100;
}

export type QuickGrade = "HEALTHY" | "CAUTION" | "SUSPECT_DEGRADED" | "BASELINE_PENDING";

export type QuickGradeInput = {
  regulationKneeA: number | null;
  kneeIsUpperBound: boolean;         // true = 사다리를 다 버텨서 이탈점을 못 찾음("이 이상")
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
  const { regulationKneeA, kneeIsUpperBound, ratedOutputCurrentA, thermalSlopeCPerMin: slope, s1CPerMin, specAttainmentPct: attainment } = input;
  const gradeProvisional = s1CPerMin === 0;

  // 사다리 천장은 2.0A로 고정이다(phases.ts). kneeIsUpperBound가 true라는 건
  // "이탈점을 못 찾았다"가 아니라 "정격까지 걸어보지 못했을 수 있다"는
  // 뜻이다 — regulationKneeA는 그때 사다리가 실제로 낸 최고 전류(상한)일
  // 뿐이다. 그 상한이 정격보다 낮으면 사다리가 정격 구간을 아예 시험하지
  // 못한 것이므로, knee도 attainment(같은 사다리 데이터로 낸 값)도
  // "관측 불가"다 — "실패"로 세면 2.4A·3A처럼 흔한 정격의 멀쩡한 팩이
  // 전부 SUSPECT_DEGRADED로 나온다(2026-09-01 회귀). 상한이 정격 이상이면
  // (예: 정격 2.0A 이하 팩이 사다리를 끝까지 버팀) 이건 진짜 "정격 충족
  // 확인됨"이므로 관측 가능하고 위반도 아니다.
  const ratingUntested = kneeIsUpperBound
    && regulationKneeA !== null && ratedOutputCurrentA !== null
    && regulationKneeA < ratedOutputCurrentA;

  const kneeObservable = !ratingUntested && regulationKneeA !== null && ratedOutputCurrentA !== null && ratedOutputCurrentA > 0;
  const slopeObservable = s1CPerMin > 0 && slope !== null;
  const attainObservable = !ratingUntested && attainment !== null;
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

// ── 정밀 용량 테스트 (스펙 §4) ──────────────────────────────────────

// 부스트 효율. 데이터시트 최대치는 91~96%지만 중부하(2A) + 저잔량 조합에서
// 80% 초반까지 떨어진다. 실측 전이라 `정의 필요`다(스펙 §8 H4).
export const DEFAULT_ASSUMED_EFFICIENCY = 0.88;

const MS_PER_HOUR = 3_600_000;

// ⚠️ Δt를 상수로 박지 않는다. 지금은 1초 tick이지만 Kafka consumer가
// 100ms 프레임을 넣기 시작하면 같은 코드가 그대로 맞아야 한다.
export function accumulateWh(currentWh: number, voltageV: number, currentA: number, tickMs: number): number {
  return currentWh + Math.abs(voltageV * currentA) * (tickMs / MS_PER_HOUR);
}

// 중단된 결과는 기준선 후보가 아니다(스펙 §4-3).
export function baselineWhFrom(previous: { deliveredWh: number | null; partial: boolean }[]): number | null {
  const first = previous.find((item) => !item.partial && item.deliveredWh !== null);
  return first ? first.deliveredWh : null;
}

export type CapacityResultInput = {
  deliveredWh: number;
  ratedWh: number | null;
  baselineWh: number | null;
  assumedEfficiency: number;
  dischargeCurrentA: number;
  partial: boolean;
};

export type CapacityResult = {
  deliveredWh: number;
  ratedWh: number | null;
  baselineWh: number | null;
  sohRelPct: number | null;
  sohAbsPct: number | null;
  assumedEfficiency: number | null;
  dischargeCurrentA: number;
  isBaseline: boolean;
  partial: boolean;
};

export function capacityResult(input: CapacityResultInput): CapacityResult {
  const { deliveredWh, ratedWh, baselineWh, assumedEfficiency, dischargeCurrentA, partial } = input;

  // 첫 테스트에서 sohRelPct를 100%로 내면 "열화 없음"으로 오독된다.
  // 기준선 자신이므로 null + isBaseline: true다(스펙 §4-2).
  const isBaseline = !partial && baselineWh === null;

  const sohRelPct = partial || baselineWh === null || baselineWh <= 0
    ? null
    : (deliveredWh / baselineWh) * 100;

  // 정격 Wh는 셀 기준(3.7V × mAh)이고 측정은 출력단(5V) 기준이라,
  // η로 보정하지 않으면 방금 산 배터리가 SOH 85%로 나온다(스펙 §4-2).
  const sohAbsPct = partial || ratedWh === null || ratedWh <= 0 || assumedEfficiency <= 0
    ? null
    : (deliveredWh / (ratedWh * assumedEfficiency)) * 100;

  return {
    deliveredWh,
    ratedWh,
    baselineWh,
    sohRelPct,
    sohAbsPct,
    assumedEfficiency: partial ? null : assumedEfficiency,
    dischargeCurrentA,
    isBaseline,
    partial,
  };
}
