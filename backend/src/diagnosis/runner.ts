// 진단 진행 판정. 순수 함수라 저장소도 WS도 모른다 — 호출부(server.ts)가
// 결과를 보고 스토어를 갱신하고 broadcast한다. failsafe.ts / failsafeRunner.ts
// 의 분리와 같은 구조다.

import type { DemoBattery, DemoDiagnosis, DiagnosisProgress } from "../store/types.js";
import { CAPACITY_PHASE, isInAggregationWindow, phaseAt, quickPhases } from "./phases.js";
import type { PhaseSpec } from "./phases.js";
import {
  accumulateWh, baselineWhFrom, capacityResult, COLLAPSE_RATIO, LATCH_OFF_VOLTAGE_V,
  median, quickGrade, recoverySlopeCPerMin, regulationKnee, rollingTempSlopeCPerMin, specAttainmentPct,
  thermalPerWattCPerMinPerW, thermalProbeLoadA, thermalSlopeCPerMin, vLightLoadV,
} from "./metrics.js";
import type { PhaseWindow } from "./metrics.js";
import { judgeDiagnosisAbort } from "./safety.js";
import type { DiagnosisAbortReason, DiagnosisSafetyThresholds } from "./safety.js";
import { createSimulatorSource } from "./simulator.js";
import type { DiagnosisSource } from "./ingest.js";

export type RunnerConfig = {
  thresholds: DiagnosisSafetyThresholds;
  s1CPerMin: number;
  assumedEfficiency: number;
  tickMs: number;
  // 안전 판정용 롤링 온도 기울기 창 — 등급용 P3 창(thermalSlopeCPerMin)과는
  // 별도다. QUICK·CAPACITY 둘 다 이 창으로 판정한다(아래 appendTempSample 참조).
  tempSlopeWindowMs: number;
  tempSlopeMinSamples: number;
};

export type StepInput = {
  battery: DemoBattery;
  diagnosis: DemoDiagnosis;
  elapsedMs: number;
  config: RunnerConfig;
  source?: DiagnosisSource;
  previousCapacity?: { deliveredWh: number | null; partial: boolean }[];
};

export type RunnerOutcome =
  | { kind: "RUNNING"; phase: string; phaseChanged: boolean; progress: DiagnosisProgress }
  | { kind: "ABORTED"; reason: DiagnosisAbortReason }
  | { kind: "COMPLETED"; result: Record<string, unknown> };

const defaultSource = createSimulatorSource();

function capacityLoadA(diagnosis: DemoDiagnosis): number {
  const value = diagnosis.input.dischargeCurrentA;
  return typeof value === "number" && value > 0 ? value : 1.0;
}

// 진행 중 창을 갱신한다. 후반 절반 구간의 샘플만 쌓는다.
//
// ⚠️ 기존 원소를 in-place로 바꾸지 않는다. stepDiagnosis는 순수 함수로
// 명시돼 있고, store/memory.ts의 findDiagnosisById가 얕은 복제
// (`{ ...diagnosis }`)만 하므로 progress는 저장된 진단과 참조를 공유한다.
// 여기서 기존 window 객체를 mutate하면 advanceDiagnosis가 호출되기도
// 전에, 심지어 그 tick이 ABORTED로 끝나 advanceDiagnosis가 아예 안
// 불려도, 저장소 상태에 조용히 쓰기가 일어난다.
function upsertWindow(windows: PhaseWindow[], spec: PhaseSpec, sample: { voltageV: number; currentA: number; atMs: number; tempIrSurfaceC: number | null }): PhaseWindow[] {
  const index = windows.findIndex((w) => w.phase === spec.phase);
  const existing = index === -1 ? null : windows[index];

  // 중앙값을 유지하려면 원자료가 필요하므로 온도 외 값은 누적 평균 대신
  // 관측한 전압을 모아 중앙값을 다시 낸다.
  const voltageSamples = [...(existing?.voltageSamples ?? []), sample.voltageV];
  const tempSamples = sample.tempIrSurfaceC !== null
    ? [...(existing?.tempSamples ?? []), { atMs: sample.atMs, tempIrSurfaceC: sample.tempIrSurfaceC }]
    : (existing?.tempSamples ?? []);

  const updated: PhaseWindow = {
    phase: spec.phase,
    loadTargetA: spec.loadTargetA,
    voltageMedianV: median(voltageSamples) ?? sample.voltageV,
    voltageSamples,
    currentMedianA: sample.currentA,
    tempSamples,
    latchOff: (existing?.latchOff ?? false) || sample.voltageV < LATCH_OFF_VOLTAGE_V,
  };

  if (index === -1) return [...windows, updated];
  const next = [...windows];
  next[index] = updated;
  return next;
}

// 안전 판정용 롤링 온도 창을 갱신한다: 이번 tick 샘플을 더하고(온도가
// null이면 더하지 않는다), 창보다 오래된 점을 시간으로 잘라낸다.
//
// ⚠️ 개수가 아니라 시간(ms)으로 트리밍한다. tick은 지금 1초지만 Kafka
// consumer가 100ms 프레임을 넣기 시작하면 같은 포트로 10배 빨리 샘플이
// 들어온다 — "최근 N개"로 트리밍하면 그 순간 안전 계층의 응답 창이
// 조용히 1/10로 줄어든다(문턱 숫자는 하나도 안 바뀌었는데). 시간창은
// tick 주기가 바뀌어도 의미가 그대로 30초·60초를 뜻한다.
function appendTempSample(
  trail: { atMs: number; tempIrSurfaceC: number }[],
  tempIrSurfaceC: number | null,
  atMs: number,
  windowMs: number
): { atMs: number; tempIrSurfaceC: number }[] {
  const withSample = tempIrSurfaceC !== null ? [...trail, { atMs, tempIrSurfaceC }] : trail;
  const cutoff = atMs - windowMs;
  return withSample.filter((point) => point.atMs >= cutoff);
}

export function stepDiagnosis(input: StepInput): RunnerOutcome {
  const { battery, diagnosis, elapsedMs, config } = input;
  const source = input.source ?? defaultSource;
  const progress = diagnosis.progress ?? { loadTargetA: null, loadActualA: null, partialMetrics: null, windows: [], deliveredWh: 0, vLightLoadV: null, lastElapsedMs: null, tempTrail: [] };

  const isQuick = diagnosis.kind === "QUICK";

  // P7(발열 탐침)의 부하는 사다리가 찾아낸 붕괴점의 0.9배다 — 그래서
  // 시퀀스가 여기서 처음으로 동적이 된다. 붕괴점은 직전 tick까지 쌓인
  // 창에서 나오고, P7이 시작되는 t=110s에는 P0~P4 창이 이미 다 차 있다.
  // 아직 못 찾았으면(사다리를 끝까지 버팀) null을 넘겨 사다리 천장을 쓴다.
  //
  // ⚠️ 동적인 것은 loadTargetA 하나뿐이고 지속시간은 여전히 정적이다 —
  // "단계는 경과시간에서만 계산된다"는 phases.ts의 불변이 깨지면 tick이
  // 밀릴 때 단계가 어긋난다.
  const kneeSoFar = isQuick ? regulationKnee(progress.windows) : null;
  const specs = isQuick
    ? quickPhases(
        battery.ratedOutputCurrentA,
        kneeSoFar!.kneeIsUpperBound ? null : kneeSoFar!.regulationKneeA,
      )
    : [];
  const spec: PhaseSpec | null = isQuick
    ? phaseAt(specs, elapsedMs)
    : { phase: CAPACITY_PHASE, durationMs: Number.MAX_SAFE_INTEGER, loadTargetA: capacityLoadA(diagnosis) };

  // 빠른 진단은 총 시간이 지나면 종료다.
  if (isQuick && spec === null) {
    return { kind: "COMPLETED", result: buildQuickResult(progress, battery, config) };
  }

  const sample = source.sample(battery, diagnosis, elapsedMs, spec!.loadTargetA, progress.deliveredWh);
  const knownVLight = progress.vLightLoadV ?? vLightLoadV(progress.windows);

  // 이번 tick 샘플을 안전 판정용 롤링 창에 먼저 반영한 뒤 그 창으로
  // 판정한다 — 판정이 progress.windows(P3 전용, QUICK의 좁은 구간에서만
  // 차고 CAPACITY에서는 아예 안 참)를 보던 옛 코드는 두 가지로 죽어
  // 있었다: CAPACITY는 windows를 절대 안 채워 안전 계층이 통째로
  // 비활성이었고, QUICK은 P4/P5에서 t=90s에 멎은 P3 값을 그대로 재판정해
  // 최대 부하 구간의 실제 발열을 못 봤다. 이 트레일은 QUICK·CAPACITY
  // 둘 다, 매 tick 채운다.
  const tempTrail = appendTempSample(progress.tempTrail, sample.tempIrSurfaceC, elapsedMs, config.tempSlopeWindowMs);
  const rollingSlope = rollingTempSlopeCPerMin(tempTrail, config.tempSlopeMinSamples);
  const abortReason = judgeDiagnosisAbort(
    diagnosis.kind,
    { voltageV: sample.voltageV, tempIrSurfaceC: sample.tempIrSurfaceC, gasRaw: sample.gasRaw, tempSlopeCPerMin: rollingSlope },
    knownVLight,
    config.thresholds
  );
  if (abortReason) return { kind: "ABORTED", reason: abortReason };

  if (!isQuick) {
    // tickMs 고정폭이 아니라 직전 tick 이후 실제 경과시간을 크레딧한다 —
    // 몇 시간짜리 용량 테스트에서는 타이머 드리프트·누락 tick이 쌓여
    // config.tickMs를 그대로 쓰면 체계적으로 틀린다. deliveredWh는 두
    // SOH 산식의 분자이자 이후 모든 테스트가 나누는 기준선의 분자다.
    // lastElapsedMs가 아직 없는 첫 tick은 진단이 t=0에서 시작했다고 보고
    // elapsedMs 전체를 크레딧한다(0을 기준점으로 삼는다) — elapsedMs를
    // 기준점으로 삼으면 첫 tick의 델타가 0이 되어 아무 것도 적산되지 않는다.
    const elapsedDeltaMs = elapsedMs - (progress.lastElapsedMs ?? 0);
    const deliveredWh = accumulateWh(progress.deliveredWh, sample.voltageV, sample.currentA, elapsedDeltaMs);
    const vLight = knownVLight ?? sample.voltageV;
    // ⚠️ CAPACITY에서 전압 붕괴는 중단이 아니라 정상 컷오프다(스펙 §4-1 ⑤).
    if (sample.voltageV < vLight * COLLAPSE_RATIO) {
      return {
        kind: "COMPLETED",
        result: buildCapacityResult(deliveredWh, battery, diagnosis, config, input.previousCapacity ?? [], false),
      };
    }
    return {
      kind: "RUNNING",
      phase: CAPACITY_PHASE,
      phaseChanged: diagnosis.phase !== CAPACITY_PHASE,
      progress: {
        loadTargetA: spec!.loadTargetA,
        loadActualA: Math.abs(sample.currentA),
        partialMetrics: { deliveredWh, specAttainmentPct: null },
        windows: progress.windows,
        deliveredWh,
        vLightLoadV: vLight,
        lastElapsedMs: elapsedMs,
        tempTrail,
      },
    };
  }

  const windows = isInAggregationWindow(specs, elapsedMs)
    ? upsertWindow(progress.windows, spec!, sample)
    : progress.windows;
  const vLight = vLightLoadV(windows);
  const knee = regulationKnee(windows);

  return {
    kind: "RUNNING",
    phase: spec!.phase,
    phaseChanged: diagnosis.phase !== spec!.phase,
    progress: {
      loadTargetA: spec!.loadTargetA,
      loadActualA: Math.abs(sample.currentA),
      partialMetrics: {
        vLightLoadV: vLight,
        regulationKneeA: knee.kneeIsUpperBound ? null : knee.regulationKneeA,
        kneeIsUpperBound: knee.kneeIsUpperBound ? null : false,
        thermalSlopeCPerMin: thermalSlopeCPerMin(windows),
        specAttainmentPct: specAttainmentPct(windows, battery.ratedOutputCurrentA),
        // P7·P5 원값. 판정하지 않는다 — 문턱·등급은 아직 미정이다.
        thermalProbeLoadA: thermalProbeLoadA(windows),
        thermalPerWattCPerMinPerW: thermalPerWattCPerMinPerW(windows),
        recoverySlopeCPerMin: recoverySlopeCPerMin(windows),
      },
      windows,
      deliveredWh: progress.deliveredWh,
      vLightLoadV: vLight,
      lastElapsedMs: progress.lastElapsedMs, // QUICK은 이 필드를 쓰지 않는다 — CAPACITY 전용
      tempTrail,
    },
  };
}

function buildQuickResult(progress: DiagnosisProgress, battery: DemoBattery, config: RunnerConfig): Record<string, unknown> {
  const windows = progress.windows;
  const knee = regulationKnee(windows);
  const slope = thermalSlopeCPerMin(windows);
  const attainment = specAttainmentPct(windows, battery.ratedOutputCurrentA);
  const { grade, gradeProvisional } = quickGrade({
    regulationKneeA: knee.regulationKneeA,
    kneeIsUpperBound: knee.kneeIsUpperBound,
    ratedOutputCurrentA: battery.ratedOutputCurrentA,
    thermalSlopeCPerMin: slope,
    s1CPerMin: config.s1CPerMin,
    specAttainmentPct: attainment,
  });
  return {
    dataSource: "SIMULATED",
    quick: {
      vLightLoadV: vLightLoadV(windows),
      regulationKneeA: knee.regulationKneeA,
      kneeIsUpperBound: knee.kneeIsUpperBound,
      latchOff: knee.latchOff,
      thermalSlopeCPerMin: slope,
      specAttainmentPct: attainment,
      ratedOutputCurrentA: battery.ratedOutputCurrentA,
      grade,
      gradeProvisional,
      // ── 측정층 원값 (판정 없음) ────────────────────────────────
      // 등급에 들어가지 않는다. thermalSlopeCPerMin이 P3(1.5A 고정) 기준인
      // 반면 아래 둘은 P7(붕괴점의 0.9배) 기준이라 서로 다른 자극의 값이다.
      // 판정 방식(기준선을 어떻게 잡고 무엇을 문턱으로 둘지)은 미정이다.
      thermalProbeLoadA: thermalProbeLoadA(windows),
      thermalPerWattCPerMinPerW: thermalPerWattCPerMinPerW(windows),
      recoverySlopeCPerMin: recoverySlopeCPerMin(windows),
    },
    capacity: null,
  };
}

function buildCapacityResult(
  deliveredWh: number,
  battery: DemoBattery,
  diagnosis: DemoDiagnosis,
  config: RunnerConfig,
  previous: { deliveredWh: number | null; partial: boolean }[],
  partial: boolean
): Record<string, unknown> {
  return {
    dataSource: "SIMULATED",
    quick: null,
    capacity: capacityResult({
      deliveredWh,
      ratedWh: battery.capacityWh,
      baselineWh: baselineWhFrom(previous),
      assumedEfficiency: config.assumedEfficiency,
      dischargeCurrentA: capacityLoadA(diagnosis),
      partial,
    }),
  };
}

export type AbortDeps = {
  setLoadA(amps: number): Promise<void>;
  relayCut(reason: string): Promise<void>;
};

// ⚠️ 부하를 먼저 0A로 내린 다음 릴레이를 차단한다. 순서가 뒤바뀌면
// 인덕티브 킥과 아크가 생긴다(스펙 §3-3). 부하 내리기가 실패해도
// 차단은 반드시 수행한다 — 안전이 우선이다.
export async function applyAbort(deps: AbortDeps, reason: string): Promise<void> {
  try {
    await deps.setLoadA(0);
  } catch {
    // 부하 제어 실패를 이유로 차단을 건너뛰지 않는다.
  }
  await deps.relayCut(reason);
}
