import { describe, expect, it } from "vitest";
import { median, quickGrade, regulationKnee, specAttainmentPct, thermalSlopeCPerMin, vLightLoadV } from "./metrics.js";
import type { PhaseWindow } from "./metrics.js";

const win = (phase: string, loadTargetA: number, voltageMedianV: number, overrides: Partial<PhaseWindow> = {}): PhaseWindow => ({
  phase,
  loadTargetA,
  voltageMedianV,
  currentMedianA: -loadTargetA,
  voltageSamples: [],
  tempSamples: [],
  latchOff: false,
  ...overrides,
});

// V_light 5.00V → 이탈 문턱 4.70V, 붕괴 문턱 4.00V
const healthyWindows = (): PhaseWindow[] => [
  win("P0", 0.1, 5.0),
  win("P1", 0.5, 4.98),
  win("P2", 1.0, 4.95),
  win("P3", 1.5, 4.92),
  win("P4", 2.0, 4.9),
  win("P5", 0.1, 5.0),
];

describe("median", () => {
  it("홀수 개는 가운데 값", () => { expect(median([3, 1, 2])).toBe(2); });
  it("짝수 개는 가운데 두 값의 평균", () => { expect(median([1, 2, 3, 4])).toBe(2.5); });
  it("빈 배열은 null", () => { expect(median([])).toBeNull(); });
});

describe("vLightLoadV", () => {
  it("P0 창의 전압 중앙값이다 — 무부하 전압이 아니라 경부하 출력전압이다", () => {
    expect(vLightLoadV(healthyWindows())).toBe(5.0);
  });

  it("P0 창이 없으면 null", () => {
    expect(vLightLoadV([win("P1", 0.5, 4.98)])).toBeNull();
  });
});

describe("regulationKnee", () => {
  it("2.0A까지 버티면 상한 표시를 단다 — '2.0A 이상'이지 '정확히 2.0A'가 아니다", () => {
    const result = regulationKnee(healthyWindows());
    expect(result).toEqual({ regulationKneeA: 2.0, kneeIsUpperBound: true, latchOff: false });
  });

  it("V_light의 94% 아래로 떨어지는 최소 전류가 이탈점이다", () => {
    const windows = healthyWindows();
    windows[4] = win("P4", 2.0, 4.6); // 4.6 < 4.70
    const result = regulationKnee(windows);
    expect(result.regulationKneeA).toBe(2.0);
    expect(result.kneeIsUpperBound).toBe(false);
  });

  it("94% 경계는 미만일 때만 이탈이다 — 정확히 94%는 이탈 아님", () => {
    const windows = healthyWindows();
    windows[3] = win("P3", 1.5, 4.7); // 정확히 0.94 × 5.0
    expect(regulationKnee(windows).kneeIsUpperBound).toBe(true);
  });

  it("절대값 4.7V가 아니라 V_light 비율로 판정한다 — 9V·12V PD에서도 성립해야 한다", () => {
    const windows: PhaseWindow[] = [
      win("P0", 0.1, 9.0),
      win("P1", 0.5, 8.9),
      win("P2", 1.0, 8.3), // 8.3 < 0.94 × 9.0 = 8.46
    ];
    expect(regulationKnee(windows).regulationKneeA).toBe(1.0);
  });

  it("래치오프(출력 소실)도 정상적인 이탈 관측이다", () => {
    const windows = healthyWindows();
    windows[3] = win("P3", 1.5, 0.2, { latchOff: true });
    const result = regulationKnee(windows);
    expect(result.regulationKneeA).toBe(1.5);
    expect(result.latchOff).toBe(true);
  });

  it("V_light를 못 구하면 null", () => {
    expect(regulationKnee([win("P1", 0.5, 4.9)]).regulationKneeA).toBeNull();
  });
});

describe("thermalSlopeCPerMin", () => {
  it("P3 구간의 최소자승 기울기를 분당으로 낸다", () => {
    // 40초 동안 2.0°C 상승 → 3.0 °C/min
    const samples = [0, 10_000, 20_000, 30_000, 40_000].map((atMs) => ({
      atMs,
      tempIrSurfaceC: 30 + (atMs / 60_000) * 3.0,
    }));
    const windows = healthyWindows();
    windows[3] = win("P3", 1.5, 4.92, { tempSamples: samples });
    expect(thermalSlopeCPerMin(windows)).toBeCloseTo(3.0, 5);
  });

  it("두 점 차분이 아니라 최소자승이다 — 마지막 점만 튀어도 기울기가 끌려가지 않는다", () => {
    const samples = [
      { atMs: 0, tempIrSurfaceC: 30 },
      { atMs: 10_000, tempIrSurfaceC: 30 },
      { atMs: 20_000, tempIrSurfaceC: 30 },
      { atMs: 30_000, tempIrSurfaceC: 30 },
      { atMs: 40_000, tempIrSurfaceC: 40 }, // IR 노이즈 스파이크
    ];
    const windows = healthyWindows();
    windows[3] = win("P3", 1.5, 4.92, { tempSamples: samples });
    // 두 점 차분이면 15 °C/min. 최소자승은 그보다 훨씬 작다
    expect(thermalSlopeCPerMin(windows)!).toBeLessThan(10);
  });

  it("샘플이 2개 미만이면 null", () => {
    const windows = healthyWindows();
    windows[3] = win("P3", 1.5, 4.92, { tempSamples: [{ atMs: 0, tempIrSurfaceC: 30 }] });
    expect(thermalSlopeCPerMin(windows)).toBeNull();
  });
});

describe("specAttainmentPct", () => {
  it("이탈 없이 버틴 최대 전류를 정격으로 나눈다", () => {
    const windows = healthyWindows();
    windows[4] = win("P4", 2.0, 4.5); // 이탈
    expect(specAttainmentPct(windows, 2.0)).toBe(75); // 1.5 / 2.0
  });

  it("정격을 넘겨 버텨도 100%를 넘지 않는다", () => {
    expect(specAttainmentPct(healthyWindows(), 1.0)).toBe(100);
  });

  it("정격이 없으면 null — 등급 판정에서 제외된다", () => {
    expect(specAttainmentPct(healthyWindows(), null)).toBeNull();
  });
});

describe("quickGrade", () => {
  const base = { regulationKneeA: 2.0, ratedOutputCurrentA: 2.0, thermalSlopeCPerMin: 1.0, s1CPerMin: 5, specAttainmentPct: 100 };

  it("세 조건을 다 만족하면 HEALTHY", () => {
    expect(quickGrade(base)).toEqual({ grade: "HEALTHY", gradeProvisional: false });
  });

  it("하나만 벗어나면 CAUTION", () => {
    expect(quickGrade({ ...base, specAttainmentPct: 90 }).grade).toBe("CAUTION");
  });

  it("둘 이상 벗어나면 SUSPECT_DEGRADED", () => {
    expect(quickGrade({ ...base, specAttainmentPct: 90, thermalSlopeCPerMin: 9 }).grade).toBe("SUSPECT_DEGRADED");
  });

  it("이탈점이 정격의 70% 미만이면 하나만 벗어나도 SUSPECT_DEGRADED", () => {
    expect(quickGrade({ ...base, regulationKneeA: 1.2, specAttainmentPct: 100 }).grade).toBe("SUSPECT_DEGRADED");
  });

  it("도달률 95%가 경계다 — 95는 통과", () => {
    expect(quickGrade({ ...base, specAttainmentPct: 95 }).grade).toBe("HEALTHY");
    expect(quickGrade({ ...base, specAttainmentPct: 94.9 }).grade).toBe("CAUTION");
  });

  it("S1이 0(미설정)이면 기울기 조건을 위반으로 보지 않고 gradeProvisional을 단다", () => {
    const result = quickGrade({ ...base, s1CPerMin: 0, thermalSlopeCPerMin: 999 });
    expect(result.grade).toBe("HEALTHY");
    expect(result.gradeProvisional).toBe(true);
  });

  it("관측 가능한 조건이 2개 미만이면 BASELINE_PENDING — 비교 기준이 없다", () => {
    const result = quickGrade({ regulationKneeA: 2.0, ratedOutputCurrentA: null, thermalSlopeCPerMin: null, s1CPerMin: 0, specAttainmentPct: null });
    expect(result.grade).toBe("BASELINE_PENDING");
  });
});
