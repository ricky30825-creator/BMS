import { describe, expect, it } from "vitest";
import {
  CAPACITY_PHASE,
  MIN_HOLD_LOAD_A,
  THERMAL_PROBE_PHASE,
  isInAggregationWindow,
  phaseAt,
  phaseIndexAt,
  quickPhases,
  totalDurationMs,
} from "./phases.js";
import { specAttainmentPct } from "./metrics.js";

describe("quickPhases", () => {
  it("정격 전류가 없으면 스펙 §3-1의 7단계를 그대로 낸다(P7 발열 탐침 포함)", () => {
    const specs = quickPhases(null);
    expect(specs.map((s) => s.phase)).toEqual(["P0", "P1", "P2", "P3", "P4", "P7", "P5"]);
    expect(specs.map((s) => s.loadTargetA)).toEqual([0.1, 0.5, 1.0, 1.5, 2.0, 2.0, 0.1]);
  });

  it("P3은 40초, P5는 30초, P7은 40초이고 합계는 180초다", () => {
    const specs = quickPhases(null);
    expect(specs.find((s) => s.phase === "P3")?.durationMs).toBe(40_000);
    expect(specs.find((s) => s.phase === "P5")?.durationMs).toBe(30_000);
    expect(specs.find((s) => s.phase === THERMAL_PROBE_PHASE)?.durationMs).toBe(40_000);
    expect(totalDurationMs(specs)).toBe(180_000);
  });

  it("P6는 시퀀스에 넣지 않는다 — 스윕 알고리즘이 미정이다", () => {
    expect(quickPhases(null).some((s) => s.phase === "P6")).toBe(false);
  });

  it("정격 전류가 있어도 P0~P4 사다리는 그대로다 — §9의 0.7× 상한은 여기 없다", () => {
    // 정격 1.0A라도 P3(1.5)·P4(2.0)는 깎이지 않는다. §3-1 사다리는 §9-2
    // "고정 자극 15분"(스크리닝) 상한과 무관하다.
    const withRated = quickPhases(1.0);
    const withoutRated = quickPhases(null);
    const ladderPhases = ["P0", "P1", "P2", "P3", "P4"];
    const pick = (specs: ReturnType<typeof quickPhases>) =>
      specs.filter((s) => ladderPhases.includes(s.phase)).map((s) => s.loadTargetA);
    expect(pick(withRated)).toEqual(pick(withoutRated));
    expect(pick(withRated)).toEqual([0.1, 0.5, 1.0, 1.5, 2.0]);
  });

  it("정격이 아주 작아도(0.05A) P0~P4 사다리는 안 깎인다 — 최소 유지 부하만 P0·P5에 적용된다", () => {
    const specs = quickPhases(0.05);
    const ladder = specs.filter((s) => ["P0", "P1", "P2", "P3", "P4"].includes(s.phase));
    expect(ladder.map((s) => s.loadTargetA)).toEqual([0.1, 0.5, 1.0, 1.5, 2.0]);
  });

  it("MIN_HOLD_LOAD_A(0.1A)는 P0·P5의 바닥이다 — 무부하로 두면 보조배터리가 출력을 스스로 끊는다(스펙 §2-6)", () => {
    const specs = quickPhases(null);
    expect(specs.find((s) => s.phase === "P0")?.loadTargetA).toBe(0.1);
    expect(specs.find((s) => s.phase === "P5")?.loadTargetA).toBe(0.1);
  });

  it("P0~P4는 두 번째 인자(regulationKneeA)와 무관하게 불변이다 — 회귀 방어", () => {
    const ladderPhases = ["P0", "P1", "P2", "P3", "P4"];
    const pick = (specs: ReturnType<typeof quickPhases>) =>
      specs
        .filter((s) => ladderPhases.includes(s.phase))
        .map((s) => ({ phase: s.phase, durationMs: s.durationMs, loadTargetA: s.loadTargetA }));

    const a = pick(quickPhases(1.0, 0.5));
    const b = pick(quickPhases(null, null));
    const c = pick(quickPhases(3.0));

    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a).toEqual([
      { phase: "P0", durationMs: 10_000, loadTargetA: 0.1 },
      { phase: "P1", durationMs: 20_000, loadTargetA: 0.5 },
      { phase: "P2", durationMs: 20_000, loadTargetA: 1.0 },
      { phase: "P3", durationMs: 40_000, loadTargetA: 1.5 },
      { phase: "P4", durationMs: 20_000, loadTargetA: 2.0 },
    ]);
  });

  describe("P7 발열 탐침 — 붕괴점의 0.9배로 40초", () => {
    it("붕괴점이 확정되면 그 0.9배를 쓴다", () => {
      expect(quickPhases(null, 1.5).find((s) => s.phase === "P7")?.loadTargetA).toBe(1.35);
      expect(quickPhases(null, 0.5).find((s) => s.phase === "P7")?.loadTargetA).toBe(0.45);
    });

    it("붕괴점을 못 찾았으면(null) 사다리 천장(2.0A)을 쓴다", () => {
      expect(quickPhases(null, null).find((s) => s.phase === "P7")?.loadTargetA).toBe(2.0);
    });

    it("두 번째 인자를 생략해도(기본값 null) 사다리 천장을 쓴다 — store/memory.ts가 인자 1개로 호출한다", () => {
      expect(quickPhases(2.0).find((s) => s.phase === "P7")?.loadTargetA).toBe(2.0);
    });

    it("붕괴점의 0.9배가 최소 유지 부하 아래면 MIN_HOLD_LOAD_A로 바닥을 친다", () => {
      expect(quickPhases(null, 0.05).find((s) => s.phase === "P7")?.loadTargetA).toBe(MIN_HOLD_LOAD_A);
    });

    it("부동소수점 오차 없이 소수 2자리로 고정된다", () => {
      const value = quickPhases(null, 1.5).find((s) => s.phase === "P7")?.loadTargetA;
      expect(value).toBe(1.35);
      expect(String(value)).toBe("1.35");
    });
  });
});

describe("정격까지 계단이 올라간다 — 상한을 걸면 HEALTHY가 영원히 안 나온다", () => {
  it("건강한 팩을 시뮬레이션하면 100% 도달률이 나온다", () => {
    const rated = 2.0;
    const specs = quickPhases(rated);
    const sustained = Math.max(...specs.map((s) => s.loadTargetA));
    expect(sustained).toBeGreaterThanOrEqual(rated);

    const p0Voltage = 5.0;
    const windows = specs.map((s) => ({
      phase: s.phase,
      loadTargetA: s.loadTargetA,
      voltageMedianV: p0Voltage,
      voltageSamples: [p0Voltage],
      currentMedianA: -s.loadTargetA,
      tempSamples: [],
      latchOff: false,
    }));

    expect(specAttainmentPct(windows, rated)).toBe(100);
  });
});

describe("phaseAt", () => {
  const specs = quickPhases(null);
  // 경계(누적): P0 0-10s, P1 10-30s, P2 30-50s, P3 50-90s, P4 90-110s,
  // P7 110-150s, P5 150-180s.

  it("경과시간으로 단계를 정한다 — 러너가 상태를 들고 있지 않게 하려는 것이다", () => {
    expect(phaseAt(specs, 0)?.phase).toBe("P0");
    expect(phaseAt(specs, 9_999)?.phase).toBe("P0");
    expect(phaseAt(specs, 10_000)?.phase).toBe("P1");
    expect(phaseAt(specs, 89_999)?.phase).toBe("P3");
    expect(phaseAt(specs, 90_000)?.phase).toBe("P4");
    expect(phaseAt(specs, 109_999)?.phase).toBe("P4");
    expect(phaseAt(specs, 110_000)?.phase).toBe(THERMAL_PROBE_PHASE);
    expect(phaseAt(specs, 149_999)?.phase).toBe(THERMAL_PROBE_PHASE);
    expect(phaseAt(specs, 150_000)?.phase).toBe("P5");
    expect(phaseAt(specs, 179_999)?.phase).toBe("P5");
  });

  it("총 시간을 넘으면 null — 종료 신호다", () => {
    expect(phaseAt(specs, 180_000)).toBeNull();
    expect(phaseIndexAt(specs, 180_000)).toBe(-1);
  });
});

describe("isInAggregationWindow", () => {
  const specs = quickPhases(null);

  it("각 단계의 후반 절반만 집계한다 — 부하 변경 직후는 컨버터 재정착 과도구간이다", () => {
    expect(isInAggregationWindow(specs, 4_999)).toBe(false); // P0 전반
    expect(isInAggregationWindow(specs, 5_000)).toBe(true);  // P0 후반
    expect(isInAggregationWindow(specs, 60_000)).toBe(false); // P3 시작(50s~90s) 전반
    expect(isInAggregationWindow(specs, 70_000)).toBe(true);  // P3 후반 20초
  });

  it("P7(110s~150s) 후반 집계창은 t>=130s에서 열린다", () => {
    expect(isInAggregationWindow(specs, 129_999)).toBe(false);
    expect(isInAggregationWindow(specs, 130_000)).toBe(true);
    expect(isInAggregationWindow(specs, 149_999)).toBe(true);
  });

  it("종료 후에는 false", () => {
    expect(isInAggregationWindow(specs, 180_000)).toBe(false);
  });
});

describe("CAPACITY_PHASE", () => {
  it("정밀 용량은 단일 단계다", () => {
    expect(CAPACITY_PHASE).toBe("CAPACITY");
  });
});
