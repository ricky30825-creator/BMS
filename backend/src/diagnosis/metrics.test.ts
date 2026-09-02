import { describe, expect, it } from "vitest";
import { median, quickGrade, recoverySlopeCPerMin, regulationKnee, rollingTempSlopeCPerMin, specAttainmentPct, thermalPerWattCPerMinPerW, thermalProbeLoadA, thermalSlopeCPerMin, vLightLoadV } from "./metrics.js";
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

describe("P7 제외 — 발열 탐침은 붕괴점·도달률의 입력이 아니다", () => {
  // P7의 부하는 붕괴점의 0.9배다. 후보에 넣으면 다음 tick의 붕괴점이
  // P7 부하가 되고, 그 0.9배가 다시 P7 부하가 되어 매 tick 줄어든다.
  it("이탈한 P7이 붕괴점을 자기 부하로 끌어내리지 않는다", () => {
    const windows = [...healthyWindows(), win("P7", 1.8, 4.5)]; // 4.5 < 4.70 = 이탈
    const knee = regulationKnee(windows);
    expect(knee.regulationKneeA).toBe(2.0);
    expect(knee.kneeIsUpperBound).toBe(true);
  });

  it("래치오프된 P7도 붕괴점 후보가 아니다", () => {
    const windows = [...healthyWindows(), win("P7", 1.8, 0.0, { latchOff: true })];
    const knee = regulationKnee(windows);
    expect(knee.regulationKneeA).toBe(2.0);
    expect(knee.latchOff).toBe(false);
  });

  // P4에서 이탈한 팩: 사다리가 낸 지속 도달 전류는 P3의 1.5A다.
  // P7(1.35A)이 후보에 끼어도 최댓값은 그대로여야 하고, 반대로 P7이
  // 더 높은 값을 들고 오는 경우에도 도달률을 올리면 안 된다.
  it("P7이 지속 도달 전류의 최댓값을 올리지 않는다", () => {
    const departed = [
      win("P0", 0.1, 5.0), win("P1", 0.5, 4.98), win("P2", 1.0, 4.95),
      win("P3", 1.5, 4.92), win("P4", 2.0, 4.5), win("P5", 0.1, 5.0),
    ];
    const withoutProbe = specAttainmentPct(departed, 2.0);
    const withProbe = specAttainmentPct([...departed, win("P7", 1.8, 4.9)], 2.0);
    expect(withoutProbe).toBe(75); // 1.5 / 2.0
    expect(withProbe).toBe(withoutProbe);
  });

  it("P7이 있어도 열화 등급의 세 입력이 전부 그대로다", () => {
    const base = healthyWindows();
    const withProbe = [...base, win("P7", 1.8, 4.4)];
    expect(regulationKnee(withProbe)).toEqual(regulationKnee(base));
    expect(specAttainmentPct(withProbe, 2.0)).toBe(specAttainmentPct(base, 2.0));
    expect(thermalSlopeCPerMin(withProbe)).toBe(thermalSlopeCPerMin(base));
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
    // 두 점 차분이면 15 °C/min, 최소자승은 12 °C/min으로 스파이크에 덜 끌린다
    expect(thermalSlopeCPerMin(windows)!).toBeCloseTo(12, 5);
    expect(thermalSlopeCPerMin(windows)!).toBeLessThan(15);
  });

  it("샘플이 2개 미만이면 null", () => {
    const windows = healthyWindows();
    windows[3] = win("P3", 1.5, 4.92, { tempSamples: [{ atMs: 0, tempIrSurfaceC: 30 }] });
    expect(thermalSlopeCPerMin(windows)).toBeNull();
  });

  it("리팩터링 후에도 P7이 아니라 P3 창만 본다 — P3·P7 둘 다 있고 기울기가 다를 때", () => {
    const windows = healthyWindows();
    // P3: 40초에 2.0°C 상승 → 3.0 °C/min
    windows[3] = win("P3", 1.5, 4.92, {
      tempSamples: [0, 10_000, 20_000, 30_000, 40_000].map((atMs) => ({
        atMs,
        tempIrSurfaceC: 30 + (atMs / 60_000) * 3.0,
      })),
    });
    // P7: 40초에 20.0°C 상승 → 30.0 °C/min (완전히 다른 값)
    windows.push(win("P7", 1.8, 4.7, {
      tempSamples: [0, 10_000, 20_000, 30_000, 40_000].map((atMs) => ({
        atMs,
        tempIrSurfaceC: 30 + (atMs / 60_000) * 30.0,
      })),
    }));
    expect(thermalSlopeCPerMin(windows)).toBeCloseTo(3.0, 5);
  });
});

describe("thermalProbeLoadA", () => {
  it("P7 창의 loadTargetA를 낸다", () => {
    const windows = [...healthyWindows(), win("P7", 1.8, 4.7)];
    expect(thermalProbeLoadA(windows)).toBe(1.8);
  });

  it("P7 창이 없으면 null", () => {
    expect(thermalProbeLoadA(healthyWindows())).toBeNull();
  });
});

describe("thermalPerWattCPerMinPerW", () => {
  it("정상 케이스 — P7 기울기를 그 구간 전력으로 나눈다", () => {
    // 40초에 4.0°C 상승 → 6.0 °C/min, 전력 = |4.7 × -1.8| = 8.46W
    const windows = [...healthyWindows(), win("P7", 1.8, 4.7, {
      currentMedianA: -1.8,
      tempSamples: [0, 10_000, 20_000, 30_000, 40_000].map((atMs) => ({
        atMs,
        tempIrSurfaceC: 30 + (atMs / 60_000) * 6.0,
      })),
    })];
    const powerW = Math.abs(4.7 * -1.8);
    expect(thermalPerWattCPerMinPerW(windows)).toBeCloseTo(6.0 / powerW, 6);
  });

  it("음수 전류에서 부호를 뒤집지 않는다 — abs()로 전력을 낸다", () => {
    const samples = [0, 10_000, 20_000, 30_000, 40_000].map((atMs) => ({
      atMs,
      tempIrSurfaceC: 30 + (atMs / 60_000) * 6.0,
    }));
    const windows = [...healthyWindows(), win("P7", 1.35, 5.0, {
      currentMedianA: -1.35,
      voltageMedianV: 5.0,
      tempSamples: samples,
    })];
    const result = thermalPerWattCPerMinPerW(windows);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
    expect(result!).toBeCloseTo(6.0 / 6.75, 6); // 6.75W = 5.0 × 1.35
  });

  it("P7 창이 없으면 null", () => {
    expect(thermalPerWattCPerMinPerW(healthyWindows())).toBeNull();
  });

  it("tempSamples가 1개면(기울기 정의 불가) null", () => {
    const windows = [...healthyWindows(), win("P7", 1.8, 4.7, {
      tempSamples: [{ atMs: 0, tempIrSurfaceC: 30 }],
    })];
    expect(thermalPerWattCPerMinPerW(windows)).toBeNull();
  });

  it("전압이 0이면(전력 0) null", () => {
    const samples = [0, 10_000].map((atMs) => ({ atMs, tempIrSurfaceC: 30 + atMs / 60_000 }));
    const windows = [...healthyWindows(), win("P7", 1.8, 0, {
      currentMedianA: -1.8,
      tempSamples: samples,
    })];
    expect(thermalPerWattCPerMinPerW(windows)).toBeNull();
  });

  it("전류가 0이면(전력 0) null", () => {
    const samples = [0, 10_000].map((atMs) => ({ atMs, tempIrSurfaceC: 30 + atMs / 60_000 }));
    const windows = [...healthyWindows(), win("P7", 1.8, 4.7, {
      currentMedianA: 0,
      tempSamples: samples,
    })];
    expect(thermalPerWattCPerMinPerW(windows)).toBeNull();
  });

  it("온도 타임스탬프가 전부 같으면(x분산 0) null", () => {
    const windows = [...healthyWindows(), win("P7", 1.8, 4.7, {
      currentMedianA: -1.8,
      tempSamples: [
        { atMs: 5_000, tempIrSurfaceC: 30 },
        { atMs: 5_000, tempIrSurfaceC: 31 },
      ],
    })];
    expect(thermalPerWattCPerMinPerW(windows)).toBeNull();
  });
});

describe("recoverySlopeCPerMin", () => {
  it("양수 기울기 — 부하를 내렸는데 온도가 계속 오르는 경우", () => {
    const windows = healthyWindows();
    windows[5] = win("P5", 0.1, 5.0, {
      tempSamples: [0, 15_000, 30_000].map((atMs) => ({
        atMs,
        tempIrSurfaceC: 40 + (atMs / 60_000) * 2.0,
      })),
    });
    expect(recoverySlopeCPerMin(windows)!).toBeGreaterThan(0);
    expect(recoverySlopeCPerMin(windows)!).toBeCloseTo(2.0, 5);
  });

  it("음수 기울기 — 정상 냉각", () => {
    const windows = healthyWindows();
    windows[5] = win("P5", 0.1, 5.0, {
      tempSamples: [0, 15_000, 30_000].map((atMs) => ({
        atMs,
        tempIrSurfaceC: 40 - (atMs / 60_000) * 1.0,
      })),
    });
    expect(recoverySlopeCPerMin(windows)!).toBeLessThan(0);
    expect(recoverySlopeCPerMin(windows)!).toBeCloseTo(-1.0, 5);
  });

  it("P5 창이 없으면 null", () => {
    const windows = healthyWindows().filter((w) => w.phase !== "P5");
    expect(recoverySlopeCPerMin(windows)).toBeNull();
  });
});

describe("rollingTempSlopeCPerMin", () => {
  it("합성 선형 램프의 기울기를 낸다 — 60초 동안 1.0°C 상승 → 1.0 °C/min", () => {
    const samples = [0, 15_000, 30_000, 45_000, 60_000].map((atMs) => ({
      atMs,
      tempIrSurfaceC: 30 + (atMs / 60_000) * 1.0,
    }));
    expect(rollingTempSlopeCPerMin(samples, 5)).toBeCloseTo(1.0, 5);
  });

  it("minSamples 미만이면 null", () => {
    const samples = [
      { atMs: 0, tempIrSurfaceC: 30 },
      { atMs: 10_000, tempIrSurfaceC: 31 },
    ];
    expect(rollingTempSlopeCPerMin(samples, 5)).toBeNull();
  });

  it("타임스탬프가 전부 같으면(x분산 0) null", () => {
    const samples = [
      { atMs: 5_000, tempIrSurfaceC: 30 },
      { atMs: 5_000, tempIrSurfaceC: 31 },
      { atMs: 5_000, tempIrSurfaceC: 32 },
    ];
    expect(rollingTempSlopeCPerMin(samples, 2)).toBeNull();
  });

  it("위상(P0~P5)을 모른다 — thermalSlopeCPerMin과 달리 PhaseWindow가 아니라 평평한 샘플 배열을 받는다", () => {
    const samples = [
      { atMs: 0, tempIrSurfaceC: 30 },
      { atMs: 1_000, tempIrSurfaceC: 30.5 },
    ];
    expect(rollingTempSlopeCPerMin(samples, 2)).toBeCloseTo(30, 3); // 0.5°C/1s = 30°C/min
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
  const base = { regulationKneeA: 2.0, kneeIsUpperBound: false, ratedOutputCurrentA: 2.0, thermalSlopeCPerMin: 1.0, s1CPerMin: 5, specAttainmentPct: 100 };

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
    const result = quickGrade({ regulationKneeA: 2.0, kneeIsUpperBound: false, ratedOutputCurrentA: null, thermalSlopeCPerMin: null, s1CPerMin: 0, specAttainmentPct: null });
    expect(result.grade).toBe("BASELINE_PENDING");
  });

  it("회귀: 사다리 상한(2.0A)이 정격보다 낮으면 knee·attainment는 위반이 아니라 관측 불가다 — 2.4A·3A 정격의 멀쩡한 팩이 SUSPECT_DEGRADED로 잘못 나오던 결함", () => {
    // 정격 2.0A 이하는 오늘도 그대로 HEALTHY다 — 사다리 천장이 정격 이상이라 관측된다.
    const rated2 = quickGrade({ regulationKneeA: 2.0, kneeIsUpperBound: true, ratedOutputCurrentA: 2.0, thermalSlopeCPerMin: null, s1CPerMin: 0, specAttainmentPct: 100 });
    expect(rated2.grade).toBe("HEALTHY");

    // 정격 3.0A: 사다리가 2.0A까지밖에 못 걸었으므로 knee·attainment 둘 다
    // 관측 불가 — SUSPECT_DEGRADED가 아니라 BASELINE_PENDING이어야 한다.
    const rated3 = quickGrade({ regulationKneeA: 2.0, kneeIsUpperBound: true, ratedOutputCurrentA: 3.0, thermalSlopeCPerMin: null, s1CPerMin: 0, specAttainmentPct: (2.0 / 3.0) * 100 });
    expect(rated3.grade).toBe("BASELINE_PENDING");

    // 정격 2.4A도 마찬가지.
    const rated24 = quickGrade({ regulationKneeA: 2.0, kneeIsUpperBound: true, ratedOutputCurrentA: 2.4, thermalSlopeCPerMin: null, s1CPerMin: 0, specAttainmentPct: (2.0 / 2.4) * 100 });
    expect(rated24.grade).toBe("BASELINE_PENDING");

    // 진짜 이탈(사다리 안에서 규정 이탈점을 실제로 찾음)은 여전히 위반으로 잡는다 —
    // 이 수정이 진짜 열화 탐지를 무디게 하지 않는다.
    const realDeparture = quickGrade({ regulationKneeA: 1.2, kneeIsUpperBound: false, ratedOutputCurrentA: 3.0, thermalSlopeCPerMin: null, s1CPerMin: 0, specAttainmentPct: 40 });
    expect(realDeparture.grade).toBe("SUSPECT_DEGRADED");
  });
});

import { accumulateWh, baselineWhFrom, capacityResult, DEFAULT_ASSUMED_EFFICIENCY } from "./metrics.js";

describe("accumulateWh", () => {
  it("tick 간격에서 시간 단위를 환산해 누적한다", () => {
    // 5V × 1A = 5W를 1초 → 5 / 3600 Wh
    expect(accumulateWh(0, 5, -1, 1000)).toBeCloseTo(5 / 3600, 9);
  });

  it("방전 부호(음수)를 절대값으로 다룬다", () => {
    expect(accumulateWh(0, 5, -1, 1000)).toBe(accumulateWh(0, 5, 1, 1000));
  });

  it("Δt를 상수로 박지 않는다 — 100ms 프레임이 들어와도 같은 코드가 맞는다", () => {
    const oneSecond = accumulateWh(0, 5, -1, 1000);
    const tenFrames = Array.from({ length: 10 }).reduce<number>((wh) => accumulateWh(wh, 5, -1, 100), 0);
    expect(tenFrames).toBeCloseTo(oneSecond, 9);
  });
});

describe("baselineWhFrom", () => {
  it("첫 완료 테스트의 deliveredWh를 기준선으로 삼는다", () => {
    expect(baselineWhFrom([{ deliveredWh: 34.8, partial: false }, { deliveredWh: 31.2, partial: false }])).toBe(34.8);
  });

  it("중단된 결과는 기준선 후보가 아니다", () => {
    expect(baselineWhFrom([{ deliveredWh: 12.0, partial: true }, { deliveredWh: 34.8, partial: false }])).toBe(34.8);
  });

  it("완료 이력이 없으면 null", () => {
    expect(baselineWhFrom([{ deliveredWh: 12.0, partial: true }])).toBeNull();
  });
});

describe("capacityResult", () => {
  const base = { deliveredWh: 31.2, ratedWh: 37.0, baselineWh: 34.8, assumedEfficiency: 0.88, dischargeCurrentA: 1.0, partial: false };

  it("상대 SOH는 기준선 대비다 — η가 분자·분모에서 약분된다", () => {
    expect(capacityResult(base).sohRelPct).toBeCloseTo(89.66, 2);
  });

  it("절대 SOH는 η 가정에 의존하며 assumedEfficiency를 반드시 동봉한다", () => {
    const result = capacityResult(base);
    expect(result.sohAbsPct).toBeCloseTo(95.82, 2);
    expect(result.assumedEfficiency).toBe(0.88);
  });

  it("첫 테스트는 sohRelPct가 null이고 isBaseline이 true다 — 100%로 내면 '열화 없음'으로 오독된다", () => {
    const result = capacityResult({ ...base, baselineWh: null });
    expect(result.sohRelPct).toBeNull();
    expect(result.isBaseline).toBe(true);
  });

  it("중단된 결과는 SOH를 내지 않는다", () => {
    const result = capacityResult({ ...base, partial: true });
    expect(result.sohRelPct).toBeNull();
    expect(result.sohAbsPct).toBeNull();
    expect(result.partial).toBe(true);
  });

  it("중단된 결과는 기준선도 되지 않는다", () => {
    expect(capacityResult({ ...base, baselineWh: null, partial: true }).isBaseline).toBe(false);
  });

  it("η로 보정하지 않으면 새 배터리가 SOH 85%로 나온다 — 회귀 방지", () => {
    // 10000mAh(37Wh) 신품에서 실제로 뽑히는 31.5Wh
    const fresh = capacityResult({ ...base, deliveredWh: 31.5, baselineWh: null });
    expect(31.5 / 37.0 * 100).toBeCloseTo(85.1, 1);   // 보정 안 하면 이 값
    expect(fresh.sohAbsPct).toBeGreaterThan(95);       // 보정하면 정상 범위
  });

  it("정격 용량이 없으면 절대 SOH는 null", () => {
    expect(capacityResult({ ...base, ratedWh: null }).sohAbsPct).toBeNull();
  });

  it("기본 효율은 0.88이다 (스펙 §8 H4, 정의 필요)", () => {
    expect(DEFAULT_ASSUMED_EFFICIENCY).toBe(0.88);
  });
});
