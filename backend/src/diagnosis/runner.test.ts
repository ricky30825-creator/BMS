import { describe, expect, it, vi } from "vitest";
import { applyAbort, stepDiagnosis } from "./runner.js";
import type { RunnerConfig } from "./runner.js";
import { accumulateWh, rollingTempSlopeCPerMin } from "./metrics.js";
import { UNSET_DIAGNOSIS_THRESHOLDS } from "./safety.js";
import type { DemoBattery, DemoDiagnosis } from "../store/types.js";
import type { DiagnosisSource } from "./ingest.js";

const config: RunnerConfig = {
  thresholds: UNSET_DIAGNOSIS_THRESHOLDS,
  s1CPerMin: 0,
  assumedEfficiency: 0.88,
  tickMs: 1000,
  tempSlopeWindowMs: 60_000,
  tempSlopeMinSamples: 5,
};

const battery = (): DemoBattery => ({
  id: "PB-A", ownerId: "hong", label: "PB-A", model: "USB", maker: null, chemistry: "LI_PO",
  targetMode: 2, seriesCount: null, capacityWh: 37, ratedOutputCurrentA: 2,
  opsStatus: "NORMAL", version: 0, adminMemo: "", memo: "",
  latest: { voltageV: 5, currentA: -1, powerW: -5, tempContact: null, tempIrSurface: 30, socPct: 90, score: 0.1, measuredAt: "2026-09-01T00:00:00.000Z" },
} as DemoBattery);

const running = (kind: "QUICK" | "CAPACITY", phase: string): DemoDiagnosis => ({
  id: "dg_1", batteryId: "PB-A", sessionId: "s1", kind, status: "RUNNING", phase,
  input: kind === "CAPACITY" ? { dischargeCurrentA: 1 } : {},
  result: null, startedAt: "2026-09-01T00:00:00.000Z", estimatedEndAt: null, completedAt: null,
  progress: { loadTargetA: null, loadActualA: null, partialMetrics: null, windows: [], deliveredWh: 0, vLightLoadV: null, lastElapsedMs: null, tempTrail: [] },
});

// 결정론적 테스트 전용 소스 — flatUntilMs까지는 flatTempC로 평평하다가,
// 그 시점부터 tick마다 rampCPerMs만큼(엄청 가파르게) 오른다. 시뮬레이터의
// 해시 기반 배터리 특성에 기대지 않고 "P3에서는 평평, P4 진입 직후 급등"
// 같은 시나리오를 정확히 만들기 위한 것이다.
function stepTempSource(flatUntilMs: number, flatTempC: number, rampCPerMs: number): DiagnosisSource {
  return {
    sample(_battery, _diagnosis, elapsedMs, loadTargetA) {
      const tempIrSurfaceC = elapsedMs < flatUntilMs
        ? flatTempC
        : flatTempC + (elapsedMs - flatUntilMs) * rampCPerMs;
      return {
        atMs: elapsedMs,
        voltageV: 5,
        currentA: -loadTargetA,
        tempIrSurfaceC,
        gasRaw: null,
        loadTargetA,
      };
    },
  };
}

describe("stepDiagnosis", () => {
  it("경과시간에 맞는 단계를 낸다", () => {
    const outcome = stepDiagnosis({ battery: battery(), diagnosis: running("QUICK", "P0"), elapsedMs: 30_000, config });
    expect(outcome.kind).toBe("RUNNING");
    if (outcome.kind === "RUNNING") expect(outcome.phase).toBe("P2");
  });

  it("단계가 바뀐 tick에만 phaseChanged가 true다 — WS는 전환 시에만 나간다", () => {
    const changed = stepDiagnosis({ battery: battery(), diagnosis: running("QUICK", "P1"), elapsedMs: 30_000, config });
    const same = stepDiagnosis({ battery: battery(), diagnosis: running("QUICK", "P2"), elapsedMs: 30_000, config });
    expect(changed.kind === "RUNNING" && changed.phaseChanged).toBe(true);
    expect(same.kind === "RUNNING" && same.phaseChanged).toBe(false);
  });

  // 빠른 진단을 1초 tick으로 끝까지 돌리고, 단계별 목표 전류와 완료
  // 결과를 함께 돌려준다.
  const runQuick = (batteryId: string) => {
    const target: DemoBattery = { ...battery(), id: batteryId };
    let diagnosis = running("QUICK", "P0");
    const loads = new Map<string, number>();
    let outcome: ReturnType<typeof stepDiagnosis> | undefined;
    for (let elapsedMs = 1_000; elapsedMs <= 180_000; elapsedMs += 1_000) {
      outcome = stepDiagnosis({ battery: target, diagnosis, elapsedMs, config });
      if (outcome.kind !== "RUNNING") break;
      loads.set(outcome.phase, outcome.progress.loadTargetA!);
      diagnosis = { ...diagnosis, phase: outcome.phase, progress: outcome.progress };
    }
    if (outcome?.kind !== "COMPLETED") throw new Error(`expected COMPLETED, got ${outcome?.kind}`);
    return { loads, result: outcome.result.quick as Record<string, unknown> };
  };

  it("빠른 진단은 180초에 완료된다", () => {
    const outcome = stepDiagnosis({ battery: battery(), diagnosis: running("QUICK", "P5"), elapsedMs: 180_000, config });
    expect(outcome.kind).toBe("COMPLETED");
  });

  it("완료 결과에 quick 블록과 dataSource가 실린다", () => {
    const outcome = stepDiagnosis({ battery: battery(), diagnosis: running("QUICK", "P5"), elapsedMs: 180_000, config });
    if (outcome.kind !== "COMPLETED") throw new Error("expected COMPLETED");
    expect(outcome.result.dataSource).toBe("SIMULATED");
    expect(outcome.result.quick).toBeTruthy();
    expect(outcome.result.capacity).toBeNull();
  });

  // P7(발열 탐침)은 사다리가 확정한 붕괴점의 0.9배로 돈다 — 시퀀스가
  // 여기서 처음으로 동적이 되므로, 배선이 맞는지는 러너를 실제로 끝까지
  // 돌려봐야만 확인된다.
  it("P7의 부하는 확정된 붕괴점의 0.9배다 — 이탈이 관측된 팩", () => {
    // PB-HONG-001은 P4(2.0A)에서 래치오프한다 → 붕괴점 2.0A → P7 1.8A.
    const { loads, result } = runQuick("PB-HONG-001");
    expect(loads.get("P7")).toBe(1.8);
    expect(result.regulationKneeA).toBe(2.0);
    expect(result.kneeIsUpperBound).toBe(false);
  });

  it("붕괴점을 못 찾으면 P7은 사다리 천장(2.0A)을 쓴다", () => {
    // PB-002는 사다리를 끝까지 버틴다 → kneeIsUpperBound → 천장.
    const { loads, result } = runQuick("PB-002");
    expect(loads.get("P7")).toBe(2.0);
    expect(result.kneeIsUpperBound).toBe(true);
  });

  it("완료 결과에 측정층 원값 3개가 실린다 — 판정은 없다", () => {
    const { result } = runQuick("PB-HONG-001");
    expect(result.thermalProbeLoadA).toBe(1.8);
    expect(typeof result.thermalPerWattCPerMinPerW).toBe("number");
    expect(typeof result.recoverySlopeCPerMin).toBe("number");
    // 원값이지 등급이 아니다 — 새 판정 필드를 늘리지 않았다.
    expect(result).not.toHaveProperty("thermalFinding");
  });

  it("회귀: P7이 생겨도 열화 등급의 세 입력이 달라지지 않는다", () => {
    // P7은 붕괴점(0.9배 되먹임)과 도달률(최댓값)의 후보에서 빠져 있어야
    // 한다. 빠지지 않으면 등급 산식을 한 줄도 안 고쳤는데 등급이 바뀐다.
    const hong = runQuick("PB-HONG-001").result;
    expect(hong.regulationKneeA).toBe(2.0);      // 1.8(=P7 부하)이면 되먹임이다
    expect(hong.specAttainmentPct).toBe(75);     // P3의 1.5A / 정격 2.0A
    const healthy = runQuick("PB-002").result;
    expect(healthy.specAttainmentPct).toBe(100);
  });

  it("안전 문턱이 걸리면 ABORTED와 사유를 낸다", () => {
    const hot: RunnerConfig = { ...config, thresholds: { surfaceCutoffC: 1, tempSlopeCPerMin: 0, gasRaw: 0 } };
    const outcome = stepDiagnosis({ battery: battery(), diagnosis: running("QUICK", "P3"), elapsedMs: 60_000, config: hot });
    expect(outcome.kind).toBe("ABORTED");
    if (outcome.kind === "ABORTED") expect(outcome.reason).toBe("TEMP_ABSOLUTE");
  });

  it("회귀: 래더 도중 래치오프(출력 소실)로 붕괴해도 빠른 진단은 ABORTED가 아니라 COMPLETED와 등급을 낸다 — 스펙 §3-2 ②, 열화된 팩을 못 재던 결함", () => {
    // PB-HONG-001은 시뮬레이터 해시상 collapseCurrentA≈1.28A라 P4(2.0A)에서
    // 0.1V로 래치오프한다 — 열화가 실제로 있는 팩이 이 진단의 존재 이유다.
    const hongBattery: DemoBattery = { ...battery(), id: "PB-HONG-001" };
    let diagnosis = running("QUICK", "P0");
    let outcome: ReturnType<typeof stepDiagnosis> | undefined;
    for (let elapsedMs = 1_000; elapsedMs <= 180_000; elapsedMs += 1_000) {
      outcome = stepDiagnosis({ battery: hongBattery, diagnosis, elapsedMs, config });
      if (outcome.kind !== "RUNNING") break;
      diagnosis = { ...diagnosis, phase: outcome.phase, progress: outcome.progress };
    }
    if (!outcome) throw new Error("no outcome produced");
    expect(outcome.kind).toBe("COMPLETED");
    if (outcome.kind !== "COMPLETED") throw new Error("expected COMPLETED");
    const quick = outcome.result.quick as { grade: unknown; latchOff: unknown } | null;
    expect(quick).toBeTruthy();
    expect(quick?.latchOff).toBe(true);
    expect(quick?.grade).toBeTruthy();
  });

  it("CAPACITY는 용량을 다 뽑으면 COMPLETED다 — 중단이 아니다", () => {
    const diagnosis = running("CAPACITY", "CAPACITY");
    diagnosis.progress!.deliveredWh = 999;
    diagnosis.progress!.vLightLoadV = 5.05;
    const outcome = stepDiagnosis({ battery: battery(), diagnosis, elapsedMs: 3_600_000, config });
    expect(outcome.kind).toBe("COMPLETED");
  });

  it("CAPACITY 진행 중에는 deliveredWh가 누적된다", () => {
    const outcome = stepDiagnosis({ battery: battery(), diagnosis: running("CAPACITY", "CAPACITY"), elapsedMs: 1000, config });
    if (outcome.kind !== "RUNNING") throw new Error("expected RUNNING");
    expect(outcome.progress.deliveredWh).toBeGreaterThan(0);
  });

  it("회귀: tick 고정폭이 아니라 실제 경과시간 델타를 크레딧한다 — 3초 간격 두 tick은 3초치를 적산해야지 tickMs(1초) 두 번치가 아니다", () => {
    const first = stepDiagnosis({ battery: battery(), diagnosis: running("CAPACITY", "CAPACITY"), elapsedMs: 3000, config });
    if (first.kind !== "RUNNING") throw new Error("expected RUNNING");
    // 첫 tick은 이전 tick이 없어 elapsedMs 그대로(3초)를 크레딧해야 한다.
    const oneStepAt3s = accumulateWh(0, first.progress.vLightLoadV ?? battery().latest.voltageV!, battery().latest.currentA!, 3000);
    expect(first.progress.deliveredWh).toBeCloseTo(oneStepAt3s, 6);
    expect(first.progress.lastElapsedMs).toBe(3000);

    const nextDiagnosis = { ...running("CAPACITY", "CAPACITY"), phase: first.phase, progress: first.progress };
    const second = stepDiagnosis({ battery: battery(), diagnosis: nextDiagnosis, elapsedMs: 6000, config });
    if (second.kind !== "RUNNING") throw new Error("expected RUNNING");

    // 델타 3초분만 추가로 크레딧돼야 한다 — tickMs(1초) 두 번치(≈2초분)가 아니다.
    const deltaWh = second.progress.deliveredWh - first.progress.deliveredWh;
    const expectedDeltaWh = accumulateWh(0, second.progress.vLightLoadV ?? battery().latest.voltageV!, battery().latest.currentA!, 3000);
    expect(deltaWh).toBeCloseTo(expectedDeltaWh, 6);
    expect(second.progress.lastElapsedMs).toBe(6000);
  });

  it("진행 상태를 제자리에서 변형하지 않는다 — 호출부가 이전 스냅샷을 그대로 들고 있을 수 있다", () => {
    const diagnosis = running("QUICK", "P0");
    // P0 후반(집계 창)에서 한 틱
    const first = stepDiagnosis({ battery: battery(), diagnosis, elapsedMs: 6_000, config });
    if (first.kind !== "RUNNING") throw new Error("expected RUNNING");
    const snapshot = first.progress.windows;
    const beforeCounts = snapshot.map((w) => w.voltageSamples.length);

    // 같은 windows를 들고 다음 틱
    const next = { ...diagnosis, phase: first.phase, progress: first.progress };
    const second = stepDiagnosis({ battery: battery(), diagnosis: next, elapsedMs: 7_000, config });
    if (second.kind !== "RUNNING") throw new Error("expected RUNNING");

    expect(snapshot.map((w) => w.voltageSamples.length)).toEqual(beforeCounts);
    expect(second.progress.windows).not.toBe(snapshot);
  });

  it("회귀: CAPACITY도 롤링 온도 트레일을 채운다 — 이전에는 CAPACITY 브랜치가 windows를 절대 갱신하지 않아 온도가 진단 내내 전혀 기록되지 않았다", () => {
    let diagnosis = running("CAPACITY", "CAPACITY");
    let outcome: ReturnType<typeof stepDiagnosis> | undefined;
    for (let elapsedMs = 1000; elapsedMs <= 5000; elapsedMs += 1000) {
      outcome = stepDiagnosis({ battery: battery(), diagnosis, elapsedMs, config });
      if (outcome.kind !== "RUNNING") throw new Error("expected RUNNING");
      diagnosis = { ...diagnosis, phase: outcome.phase, progress: outcome.progress };
    }
    if (!outcome || outcome.kind !== "RUNNING") throw new Error("expected RUNNING");
    expect(outcome.progress.tempTrail.length).toBe(5);
    const slope = rollingTempSlopeCPerMin(outcome.progress.tempTrail, config.tempSlopeMinSamples);
    // 데모 배터리는 부하 중 계속 발열하는 시뮬레이터 모델을 쓴다 — 5틱 뒤엔
    // null이 아니라 실제 상승 기울기가 나와야 한다(헤드라인 회귀의 전제조건).
    expect(slope).not.toBeNull();
    expect(slope!).toBeGreaterThan(0);
  });

  it("헤드라인 회귀: CAPACITY 진단이 TEMP_SLOPE로 중단된다 — 이전에는 CAPACITY의 안전 계층이 통째로 죽어 있어 이 중단 자체가 코드상 불가능했다", () => {
    const hot: RunnerConfig = { ...config, thresholds: { surfaceCutoffC: 0, tempSlopeCPerMin: 0.001, gasRaw: 0 } };
    let diagnosis = running("CAPACITY", "CAPACITY");
    let outcome: ReturnType<typeof stepDiagnosis> | undefined;
    for (let elapsedMs = 1000; elapsedMs <= 20_000; elapsedMs += 1000) {
      outcome = stepDiagnosis({ battery: battery(), diagnosis, elapsedMs, config: hot });
      if (outcome.kind === "ABORTED") break;
      if (outcome.kind !== "RUNNING") throw new Error("expected RUNNING or ABORTED, got " + outcome.kind);
      diagnosis = { ...diagnosis, phase: outcome.phase, progress: outcome.progress };
    }
    if (!outcome) throw new Error("no outcome produced");
    expect(outcome.kind).toBe("ABORTED");
    if (outcome.kind === "ABORTED") expect(outcome.reason).toBe("TEMP_SLOPE");
  });

  it("빠른 진단 P4는 얼어붙은 P3 창이 아니라 최근 샘플로 판정한다 — P3까지는 평평하다가 P4 진입 직후 온도가 급등하는 배터리도 P4 안에서 잡아야 한다", () => {
    // P3 집계 창(70s~90s)은 계속 평평(30°C) → 옛 코드(frozen P3 slope)라면
    // 기울기가 계속 0으로 얼어붙어 P4·P5에서 무슨 일이 나도 절대 못 잡는다.
    const source = stepTempSource(90_000, 30, 1); // P4(t=90s) 진입 즉시 ms당 1°C 급등
    const hot: RunnerConfig = { ...config, thresholds: { surfaceCutoffC: 0, tempSlopeCPerMin: 100, gasRaw: 0 } };
    let diagnosis = running("QUICK", "P0");
    let outcome: ReturnType<typeof stepDiagnosis> | undefined;
    let abortedAtMs: number | null = null;
    for (let elapsedMs = 1000; elapsedMs <= 180_000; elapsedMs += 1000) {
      outcome = stepDiagnosis({ battery: battery(), diagnosis, elapsedMs, config: hot, source });
      if (outcome.kind === "ABORTED") { abortedAtMs = elapsedMs; break; }
      if (outcome.kind !== "RUNNING") throw new Error("expected RUNNING or ABORTED, got " + outcome.kind);
      diagnosis = { ...diagnosis, phase: outcome.phase, progress: outcome.progress };
    }
    expect(outcome?.kind).toBe("ABORTED");
    if (outcome?.kind === "ABORTED") expect(outcome.reason).toBe("TEMP_SLOPE");
    expect(abortedAtMs).not.toBeNull();
    // P4 진입(90s) 전에는 온도가 전혀 안 올랐으니 그 전엔 abort가 나올 수 없다.
    expect(abortedAtMs!).toBeGreaterThanOrEqual(90_000);
    // P5(110s~)까지 안 가고 P4 안에서 잡혀야 "최근 샘플로 판정한다"는 주장이 선다.
    expect(abortedAtMs!).toBeLessThan(110_000);
  });

  it("회귀: 문턱 0(미설정 sentinel)이면 온도가 치솟아도 TEMP_SLOPE로 중단하지 않는다 — 기존 sentinel 동작은 그대로 유지돼야 한다", () => {
    const source = stepTempSource(0, 30, 1); // 처음부터 급등
    let diagnosis = running("CAPACITY", "CAPACITY");
    let outcome: ReturnType<typeof stepDiagnosis> | undefined;
    for (let elapsedMs = 1000; elapsedMs <= 10_000; elapsedMs += 1000) {
      outcome = stepDiagnosis({ battery: battery(), diagnosis, elapsedMs, config, source }); // config.thresholds는 UNSET(0)
      if (outcome.kind !== "RUNNING") break;
      diagnosis = { ...diagnosis, phase: outcome.phase, progress: outcome.progress };
    }
    expect(outcome?.kind).toBe("RUNNING");
  });
});

describe("applyAbort", () => {
  it("⚠️ 부하를 0A로 내린 다음 릴레이를 차단한다 — 순서가 뒤바뀌면 아크가 생긴다", async () => {
    const calls: string[] = [];
    await applyAbort({
      setLoadA: async (a) => { calls.push(`setLoad:${a}`); },
      relayCut: async (reason) => { calls.push(`relayCut:${reason}`); },
    }, "TEMP_ABSOLUTE");
    expect(calls).toEqual(["setLoad:0", "relayCut:TEMP_ABSOLUTE"]);
  });

  it("부하 내리기가 실패해도 릴레이는 차단한다 — 안전이 우선이다", async () => {
    const relayCut = vi.fn(async () => {});
    await applyAbort({
      setLoadA: async () => { throw new Error("load controller offline"); },
      relayCut,
    }, "GAS");
    expect(relayCut).toHaveBeenCalledWith("GAS");
  });
});
