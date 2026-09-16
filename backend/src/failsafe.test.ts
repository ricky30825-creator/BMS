import { describe, expect, it } from "vitest";
import { UNSET_THRESHOLDS, judgeFailsafe } from "./failsafe.js";
import type { FailsafeSample, FailsafeThresholds } from "./failsafe.js";

const sample = (overrides: Partial<FailsafeSample> = {}): FailsafeSample => ({
  tempContact: null,
  tempIrSurface: null,
  tempRiseRateCPerMin: null,
  pressureRaw: null,
  pressureBaseline: null,
  gasRaw: null,
  ...overrides,
});

const configured: FailsafeThresholds = {
  tempContactCapC: 60,
  tempIrCapC: 60,
  tempRiseRateCPerMin: 5,
  pressureRisePct: 30,
  gasRaw: 800,
};

describe("judgeFailsafe", () => {
  it("문턱이 전부 0(미설정)이면 무엇을 넣어도 차단하지 않는다", () => {
    expect(judgeFailsafe("MODE1_EXTERNAL_CELL_V1", sample({ tempIrSurface: 200 }), UNSET_THRESHOLDS)).toBeNull();
  });

  it("IR 표면온도가 상한을 넘으면 FAILSAFE_TEMP_IR_OVER_CAP", () => {
    const verdict = judgeFailsafe("MODE1_EXTERNAL_CELL_V1", sample({ tempIrSurface: 61 }), configured);
    expect(verdict?.triggerCode).toBe("FAILSAFE_TEMP_IR_OVER_CAP");
  });

  it("상한과 같으면 차단한다 — 경계는 포함", () => {
    expect(judgeFailsafe("MODE1_EXTERNAL_CELL_V1", sample({ tempIrSurface: 60 }), configured)).not.toBeNull();
  });

  it("상한 미만이면 차단하지 않는다", () => {
    expect(judgeFailsafe("MODE1_EXTERNAL_CELL_V1", sample({ tempIrSurface: 59.9 }), configured)).toBeNull();
  });

  it("접촉온도 상한도 본다", () => {
    const verdict = judgeFailsafe("MODE1_EXTERNAL_CELL_V1", sample({ tempContact: 60 }), configured);
    expect(verdict?.triggerCode).toBe("FAILSAFE_TEMP_CONTACT_OVER_CAP");
  });

  it("모드 2 프로필에는 접촉온도가 없으므로 그 코드를 내지 않는다", () => {
    expect(judgeFailsafe("COMBINED_EXISTING_PARTS_V1", sample({ tempContact: 200 }), configured)).toBeNull();
  });

  it("MODE2_FULL은 IR·기울기·가스만 사용하고 접촉·압력은 무시한다", () => {
    expect(judgeFailsafe("MODE2_FULL", sample({ tempContact: 200, pressureRaw: 10_000, pressureBaseline: 500 }), configured)).toBeNull();
    expect(judgeFailsafe("MODE2_FULL", sample({ tempIrSurface: 60 }), configured)?.triggerCode).toBe("FAILSAFE_TEMP_IR_OVER_CAP");
    expect(judgeFailsafe("MODE2_FULL", sample({ gasRaw: 800 }), configured)?.triggerCode).toBe("FAILSAFE_GAS_OVER_THRESHOLD");
  });

  it("모드 2 프로필에도 IR은 살아 있다", () => {
    const verdict = judgeFailsafe("COMBINED_EXISTING_PARTS_V1", sample({ tempIrSurface: 70 }), configured);
    expect(verdict?.triggerCode).toBe("FAILSAFE_TEMP_IR_OVER_CAP");
  });

  it("모드 1에는 가스 센서가 없으므로 gas 코드를 내지 않는다", () => {
    expect(judgeFailsafe("MODE1_EXTERNAL_CELL_V1", sample({ gasRaw: 5000 }), configured)).toBeNull();
  });

  it("온도 상승률이 문턱을 넘으면 FAILSAFE_TEMP_RISE_RATE", () => {
    const verdict = judgeFailsafe("MODE1_EXTERNAL_CELL_V1", sample({ tempRiseRateCPerMin: 6 }), configured);
    expect(verdict?.triggerCode).toBe("FAILSAFE_TEMP_RISE_RATE");
  });

  it("압력은 baseline 대비 상대 상승률로 판정한다", () => {
    const over = judgeFailsafe("MODE1_EXTERNAL_CELL_V1", sample({ pressureRaw: 1400, pressureBaseline: 1000 }), configured);
    expect(over?.triggerCode).toBe("FAILSAFE_PRESSURE_RISE");
    const under = judgeFailsafe("MODE1_EXTERNAL_CELL_V1", sample({ pressureRaw: 1200, pressureBaseline: 1000 }), configured);
    expect(under).toBeNull();
  });

  it("baseline이 없으면 압력으로 판정하지 않는다 — 절대값은 무의미하다", () => {
    expect(judgeFailsafe("MODE1_EXTERNAL_CELL_V1", sample({ pressureRaw: 99999, pressureBaseline: null }), configured)).toBeNull();
  });

  it("baseline이 0이면 나눗셈을 하지 않는다", () => {
    expect(judgeFailsafe("MODE1_EXTERNAL_CELL_V1", sample({ pressureRaw: 500, pressureBaseline: 0 }), configured)).toBeNull();
  });

  it("500 미만 baseline은 부착 불량으로 압력 계층을 비활성화한다", () => {
    expect(judgeFailsafe("MODE1_EXTERNAL_CELL_V1", sample({ pressureRaw: 9000, pressureBaseline: 499 }), configured)).toBeNull();
    expect(judgeFailsafe("MODE1_EXTERNAL_CELL_V1", sample({ pressureRaw: 650, pressureBaseline: 500 }), configured)?.triggerCode).toBe("FAILSAFE_PRESSURE_RISE");
  });

  it("측정값이 null인 계층은 건너뛴다", () => {
    expect(judgeFailsafe("MODE1_EXTERNAL_CELL_V1", sample(), configured)).toBeNull();
  });

  it("문턱이 0인 계층만 개별로 비활성화된다", () => {
    const cases: Array<["MODE1_EXTERNAL_CELL_V1" | "MODE2_FULL", keyof FailsafeThresholds, FailsafeSample]> = [
      ["MODE1_EXTERNAL_CELL_V1", "tempContactCapC", sample({ tempContact: 90 })],
      ["MODE1_EXTERNAL_CELL_V1", "tempIrCapC", sample({ tempIrSurface: 90 })],
      ["MODE1_EXTERNAL_CELL_V1", "tempRiseRateCPerMin", sample({ tempRiseRateCPerMin: 90 })],
      ["MODE1_EXTERNAL_CELL_V1", "pressureRisePct", sample({ pressureRaw: 1000, pressureBaseline: 500 })],
      ["MODE2_FULL", "gasRaw", sample({ gasRaw: 900 })],
    ];
    expect(judgeFailsafe("MODE1_EXTERNAL_CELL_V1", sample({ tempContact: 200, tempIrSurface: 200 }), UNSET_THRESHOLDS)).toBeNull();
    for (const [profile, key, onlySample] of cases) {
      expect(judgeFailsafe(profile, onlySample, { ...UNSET_THRESHOLDS, [key]: 0 })).toBeNull();
      expect(judgeFailsafe(profile, onlySample, { ...UNSET_THRESHOLDS, [key]: configured[key] })).not.toBeNull();
    }
  });

  it("여러 계층이 동시에 걸리면 절대온도를 우선 보고한다", () => {
    const verdict = judgeFailsafe("MODE1_EXTERNAL_CELL_V1", sample({ tempIrSurface: 70, tempRiseRateCPerMin: 20 }), configured);
    expect(verdict?.triggerCode).toBe("FAILSAFE_TEMP_IR_OVER_CAP");
  });

  it("판정 결과에 인터락 조건 문자열이 함께 온다", () => {
    const verdict = judgeFailsafe("MODE1_EXTERNAL_CELL_V1", sample({ tempIrSurface: 70 }), configured);
    expect(verdict?.condition).toBe("TEMP_OVER_CAP");
  });
});
