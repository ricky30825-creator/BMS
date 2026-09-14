import { describe, expect, it, vi } from "vitest";
import { createLoggingDeviceCommandPort } from "./logging.js";

describe("logging device command port", () => {
  it("릴레이 차단을 구조화된 한 줄로 남긴다", async () => {
    const log = vi.fn();
    const port = createLoggingDeviceCommandPort(log);
    await port.relayCut("DEMO-PACK-001", "FAILSAFE_TEMP_IR_OVER_CAP");
    expect(log).toHaveBeenCalledWith({
      command: "relayCut",
      batteryId: "DEMO-PACK-001",
      reasonCode: "FAILSAFE_TEMP_IR_OVER_CAP",
    });
  });

  it("세션 시작·종료도 남긴다", async () => {
    const log = vi.fn();
    const port = createLoggingDeviceCommandPort(log);
    await port.sessionStarted("ses_1", "DEMO-PACK-001", 1);
    await port.sessionEnded("ses_1", "DEMO-PACK-001", "SUPERSEDED");
    expect(log).toHaveBeenNthCalledWith(1, { command: "sessionStarted", sessionId: "ses_1", batteryId: "DEMO-PACK-001", targetMode: 1 });
    expect(log).toHaveBeenNthCalledWith(2, { command: "sessionEnded", sessionId: "ses_1", batteryId: "DEMO-PACK-001", endReason: "SUPERSEDED" });
  });
});
