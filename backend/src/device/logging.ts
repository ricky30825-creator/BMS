import type { DeviceCommandPort } from "./port.js";

// 인프라 담당자가 Kafka 프로듀서 구현체를 붙이기 전까지 쓰는 스텁.
// 명령을 실제로 보내지 않으므로 물리 릴레이는 움직이지 않는다.
export function createLoggingDeviceCommandPort(
  log: (entry: Record<string, unknown>) => void = (entry) => console.info("[device]", entry)
): DeviceCommandPort {
  return {
    async relayCut(batteryId, reasonCode) { log({ command: "relayCut", batteryId, reasonCode }); },
    async relayRestore(batteryId) { log({ command: "relayRestore", batteryId }); },
    async sessionStarted(sessionId, batteryId, targetMode) { log({ command: "sessionStarted", sessionId, batteryId, targetMode }); },
    async sessionEnded(sessionId, batteryId, endReason) { log({ command: "sessionEnded", sessionId, batteryId, endReason }); },
  };
}
