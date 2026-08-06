import { describe, expect, it } from "vitest";
import { buildCapacityDiagnosisBody, buildQuickDiagnosisBody } from "../api/diagnosis";

describe("F21 diagnosis request contracts", () => {
  it("uses a nullable 1..4 SOC hint for quick diagnosis", () => {
    expect(buildQuickDiagnosisBody(3)).toEqual({ socHintLevel: 3, acknowledged: true });
    expect(buildQuickDiagnosisBody(null)).toEqual({ socHintLevel: null, acknowledged: true });
  });

  it("uses fullyChargedConfirmed for capacity diagnosis", () => {
    expect(buildCapacityDiagnosisBody(1, true)).toEqual({ dischargeCurrentA: 1, fullyChargedConfirmed: true, acknowledged: true });
    expect(buildCapacityDiagnosisBody(0.5, false)).toEqual({ dischargeCurrentA: 0.5, fullyChargedConfirmed: false, acknowledged: true });
    expect(buildCapacityDiagnosisBody(1, true)).not.toHaveProperty("fullyCharged");
  });
});
