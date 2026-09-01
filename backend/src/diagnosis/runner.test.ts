import { describe, expect, it, vi } from "vitest";
import { applyAbort, stepDiagnosis } from "./runner.js";
import type { RunnerConfig } from "./runner.js";
import { UNSET_DIAGNOSIS_THRESHOLDS } from "./safety.js";
import type { DemoBattery, DemoDiagnosis } from "../store/types.js";

const config: RunnerConfig = {
  thresholds: UNSET_DIAGNOSIS_THRESHOLDS,
  s1CPerMin: 0,
  assumedEfficiency: 0.88,
  tickMs: 1000,
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
  progress: { loadTargetA: null, loadActualA: null, partialMetrics: null, windows: [], deliveredWh: 0, vLightLoadV: null },
});

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

  it("빠른 진단은 120초에 완료된다", () => {
    const outcome = stepDiagnosis({ battery: battery(), diagnosis: running("QUICK", "P5"), elapsedMs: 120_000, config });
    expect(outcome.kind).toBe("COMPLETED");
  });

  it("완료 결과에 quick 블록과 dataSource가 실린다", () => {
    const outcome = stepDiagnosis({ battery: battery(), diagnosis: running("QUICK", "P5"), elapsedMs: 120_000, config });
    if (outcome.kind !== "COMPLETED") throw new Error("expected COMPLETED");
    expect(outcome.result.dataSource).toBe("SIMULATED");
    expect(outcome.result.quick).toBeTruthy();
    expect(outcome.result.capacity).toBeNull();
  });

  it("안전 문턱이 걸리면 ABORTED와 사유를 낸다", () => {
    const hot: RunnerConfig = { ...config, thresholds: { surfaceCutoffC: 1, tempSlopeCPerMin: 0, gasRaw: 0 } };
    const outcome = stepDiagnosis({ battery: battery(), diagnosis: running("QUICK", "P3"), elapsedMs: 60_000, config: hot });
    expect(outcome.kind).toBe("ABORTED");
    if (outcome.kind === "ABORTED") expect(outcome.reason).toBe("TEMP_ABSOLUTE");
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
