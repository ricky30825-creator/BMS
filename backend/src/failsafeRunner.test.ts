import { describe, expect, it, vi } from "vitest";
import { evaluateFailsafe } from "./failsafeRunner.js";
import type { FailsafeSample, FailsafeThresholds } from "./failsafe.js";

const tripping: FailsafeSample = { tempContact: null, tempIrSurface: 70, tempRiseRateCPerMin: null, pressureRaw: null, pressureBaseline: null, gasRaw: null };
const calm: FailsafeSample = { ...tripping, tempIrSurface: 20 };
const thresholds: FailsafeThresholds = { tempContactCapC: 60, tempIrCapC: 60, tempRiseRateCPerMin: 0, pressureRisePct: 0, gasRaw: 0 };

function deps(interlockEngaged = false) {
  return {
    relayByBattery: vi.fn().mockResolvedValue({ batteryId: "B1", state: interlockEngaged ? "OPEN" : "CLOSED", interlockEngaged, interlockCondition: null, reasonCode: null, reason: null, changedAt: "", changedBy: "SYSTEM" }),
    engageFailsafe: vi.fn().mockResolvedValue({
      relay: { batteryId: "B1", state: "OPEN", interlockEngaged: true, interlockCondition: "TEMP_OVER_CAP", reasonCode: "FAILSAFE_TEMP_IR_OVER_CAP", reason: null, changedAt: "", changedBy: "SYSTEM" },
      newlyEngaged: true,
    }),
    relayCut: vi.fn().mockResolvedValue(undefined),
    onAutoCut: vi.fn(),
  };
}

describe("evaluateFailsafe", () => {
  it("조건이 걸리면 인터락을 걸고 에지에 알리고 autoCut을 푸시한다", async () => {
    const d = deps();
    const verdict = await evaluateFailsafe(d, "B1", "MODE1_EXTERNAL_CELL_V1", tripping, thresholds);
    expect(verdict?.triggerCode).toBe("FAILSAFE_TEMP_IR_OVER_CAP");
    expect(d.engageFailsafe).toHaveBeenCalledWith("B1", "FAILSAFE_TEMP_IR_OVER_CAP", "TEMP_OVER_CAP");
    expect(d.relayCut).toHaveBeenCalledWith("B1", "FAILSAFE_TEMP_IR_OVER_CAP");
    expect(d.onAutoCut).toHaveBeenCalledOnce();
  });

  it("조건이 없으면 아무것도 하지 않는다", async () => {
    const d = deps();
    expect(await evaluateFailsafe(d, "B1", "MODE1_EXTERNAL_CELL_V1", calm, thresholds)).toBeNull();
    expect(d.engageFailsafe).not.toHaveBeenCalled();
    expect(d.relayCut).not.toHaveBeenCalled();
    expect(d.onAutoCut).not.toHaveBeenCalled();
  });

  it("이미 인터락이 걸려 있으면 다시 차단하지 않는다 — 감사 로그 폭주 방지", async () => {
    const d = deps(true);
    expect(await evaluateFailsafe(d, "B1", "MODE1_EXTERNAL_CELL_V1", tripping, thresholds)).toBeNull();
    expect(d.engageFailsafe).not.toHaveBeenCalled();
  });

  it("조회와 차단 사이에 다른 worker가 먼저 차단했으면 edge·WS를 반복하지 않는다", async () => {
    const d = deps();
    d.engageFailsafe.mockResolvedValueOnce({
      relay: { batteryId: "B1", state: "OPEN", interlockEngaged: true, interlockCondition: "TEMP_OVER_CAP", reasonCode: "FAILSAFE_TEMP_IR_OVER_CAP", reason: null, changedAt: "", changedBy: "SYSTEM" },
      newlyEngaged: false,
    });

    expect(await evaluateFailsafe(d, "B1", "MODE1_EXTERNAL_CELL_V1", tripping, thresholds)).toBeNull();
    expect(d.relayCut).not.toHaveBeenCalled();
    expect(d.onAutoCut).not.toHaveBeenCalled();
  });

  it("에지 명령이 실패해도 인터락은 유지된다", async () => {
    const d = deps();
    d.relayCut.mockRejectedValue(new Error("broker down"));
    await expect(evaluateFailsafe(d, "B1", "MODE1_EXTERNAL_CELL_V1", tripping, thresholds)).rejects.toThrow("broker down");
    expect(d.engageFailsafe).toHaveBeenCalledOnce();
  });
});
