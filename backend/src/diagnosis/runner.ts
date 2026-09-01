// 진단 진행 판정. 순수 함수라 저장소도 WS도 모른다 — 호출부(server.ts)가
// 결과를 보고 스토어를 갱신하고 broadcast한다. failsafe.ts / failsafeRunner.ts
// 의 분리와 같은 구조다.

import type { DemoBattery, DemoDiagnosis, DiagnosisProgress } from "../store/types.js";
import { CAPACITY_PHASE, isInAggregationWindow, phaseAt, quickPhases } from "./phases.js";
import type { PhaseSpec } from "./phases.js";
import {
  accumulateWh, baselineWhFrom, capacityResult, COLLAPSE_RATIO, LATCH_OFF_VOLTAGE_V,
  median, quickGrade, regulationKnee, specAttainmentPct, thermalSlopeCPerMin, vLightLoadV,
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
function upsertWindow(windows: PhaseWindow[], spec: PhaseSpec, sample: { voltageV: number; currentA: number; atMs: number; tempIrSurfaceC: number | null }): PhaseWindow[] {
  const next = [...windows];
  let window = next.find((w) => w.phase === spec.phase);
  if (!window) {
    window = {
      phase: spec.phase,
      loadTargetA: spec.loadTargetA,
      voltageMedianV: sample.voltageV,
      voltageSamples: [],
      currentMedianA: sample.currentA,
      tempSamples: [],
      latchOff: false,
    };
    next.push(window);
  }
  // 중앙값을 유지하려면 원자료가 필요하므로 온도 외 값은 누적 평균 대신
  // 관측한 전압을 모아 중앙값을 다시 낸다.
  window.voltageSamples = [...window.voltageSamples, sample.voltageV];
  window.voltageMedianV = median(window.voltageSamples) ?? sample.voltageV;
  window.currentMedianA = sample.currentA;
  window.latchOff = window.latchOff || sample.voltageV < LATCH_OFF_VOLTAGE_V;
  if (sample.tempIrSurfaceC !== null) {
    window.tempSamples = [...window.tempSamples, { atMs: sample.atMs, tempIrSurfaceC: sample.tempIrSurfaceC }];
  }
  return next;
}

export function stepDiagnosis(input: StepInput): RunnerOutcome {
  const { battery, diagnosis, elapsedMs, config } = input;
  const source = input.source ?? defaultSource;
  const progress = diagnosis.progress ?? { loadTargetA: null, loadActualA: null, partialMetrics: null, windows: [], deliveredWh: 0, vLightLoadV: null };

  const isQuick = diagnosis.kind === "QUICK";
  const specs = isQuick ? quickPhases(battery.ratedOutputCurrentA) : [];
  const spec: PhaseSpec | null = isQuick
    ? phaseAt(specs, elapsedMs)
    : { phase: CAPACITY_PHASE, durationMs: Number.MAX_SAFE_INTEGER, loadTargetA: capacityLoadA(diagnosis) };

  // 빠른 진단은 총 시간이 지나면 종료다.
  if (isQuick && spec === null) {
    return { kind: "COMPLETED", result: buildQuickResult(progress, battery, config) };
  }

  const sample = source.sample(battery, diagnosis, elapsedMs, spec!.loadTargetA, progress.deliveredWh);
  const knownVLight = progress.vLightLoadV ?? vLightLoadV(progress.windows);

  const slope = thermalSlopeCPerMin(progress.windows);
  const abortReason = judgeDiagnosisAbort(
    diagnosis.kind,
    { voltageV: sample.voltageV, tempIrSurfaceC: sample.tempIrSurfaceC, gasRaw: sample.gasRaw, tempSlopeCPerMin: slope },
    knownVLight,
    config.thresholds
  );
  if (abortReason) return { kind: "ABORTED", reason: abortReason };

  if (!isQuick) {
    const deliveredWh = accumulateWh(progress.deliveredWh, sample.voltageV, sample.currentA, config.tickMs);
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
      },
      windows,
      deliveredWh: progress.deliveredWh,
      vLightLoadV: vLight,
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
