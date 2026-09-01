import { describe, expect, it } from "vitest";
import { judgeDiagnosisAbort, UNSET_DIAGNOSIS_THRESHOLDS } from "./safety.js";
import type { DiagnosisSafetyThresholds, SafetySample } from "./safety.js";

const sample = (overrides: Partial<SafetySample> = {}): SafetySample => ({
  voltageV: 5.0,
  tempIrSurfaceC: null,
  gasRaw: null,
  tempSlopeCPerMin: null,
  ...overrides,
});

// 스펙 §3-3의 잠정값. H2 실측 전이다.
const configured: DiagnosisSafetyThresholds = {
  surfaceCutoffC: 50,
  tempSlopeCPerMin: 5,
  gasRaw: 800,
};

describe("judgeDiagnosisAbort", () => {
  it("문턱이 전부 0(미설정)이면 무엇을 넣어도 중단하지 않는다", () => {
    const hot = sample({ tempIrSurfaceC: 200, gasRaw: 9999, tempSlopeCPerMin: 99 });
    expect(judgeDiagnosisAbort("QUICK", hot, 5.0, UNSET_DIAGNOSIS_THRESHOLDS)).toBeNull();
  });

  it("표면온도가 상한에 닿으면 TEMP_ABSOLUTE — 경계는 포함", () => {
    expect(judgeDiagnosisAbort("QUICK", sample({ tempIrSurfaceC: 50 }), 5.0, configured)).toBe("TEMP_ABSOLUTE");
    expect(judgeDiagnosisAbort("QUICK", sample({ tempIrSurfaceC: 49.9 }), 5.0, configured)).toBeNull();
  });

  it("상승률 초과면 TEMP_SLOPE — 케이스 표면온도는 셀 온도가 아니라 상승률이 주 근거다", () => {
    expect(judgeDiagnosisAbort("QUICK", sample({ tempSlopeCPerMin: 5.1 }), 5.0, configured)).toBe("TEMP_SLOPE");
  });

  it("가스 임계 초과면 GAS", () => {
    expect(judgeDiagnosisAbort("QUICK", sample({ gasRaw: 800 }), 5.0, configured)).toBe("GAS");
  });

  it("QUICK에서 V_light의 80% 미만으로 무너지면 VOLTAGE_COLLAPSE", () => {
    expect(judgeDiagnosisAbort("QUICK", sample({ voltageV: 3.9 }), 5.0, configured)).toBe("VOLTAGE_COLLAPSE");
  });

  it("⚠️ CAPACITY에서 같은 전압 붕괴는 중단이 아니다 — 정상 컷오프다", () => {
    expect(judgeDiagnosisAbort("CAPACITY", sample({ voltageV: 3.9 }), 5.0, configured)).toBeNull();
  });

  it("전압 붕괴 판정은 V_light를 모르면 하지 않는다", () => {
    expect(judgeDiagnosisAbort("QUICK", sample({ voltageV: 0.1 }), null, configured)).toBeNull();
  });

  it("절대 온도를 상승률보다 먼저 본다 — 근거가 더 확실한 쪽이 앞이다", () => {
    const both = sample({ tempIrSurfaceC: 60, tempSlopeCPerMin: 99 });
    expect(judgeDiagnosisAbort("QUICK", both, 5.0, configured)).toBe("TEMP_ABSOLUTE");
  });
});
