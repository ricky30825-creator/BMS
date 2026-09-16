import { judgeFailsafe } from "./failsafe.js";
import type { FailsafeSample, FailsafeThresholds, FailsafeVerdict, HardwareProfile } from "./failsafe.js";
import type { DemoRelay } from "./store.js";

export type FailsafeDeps = {
  relayByBattery(batteryId: string): Promise<DemoRelay>;
  engageFailsafe(batteryId: string, triggerCode: string, condition: string): Promise<{ relay: DemoRelay; newlyEngaged: boolean }>;
  relayCut(batteryId: string, reasonCode: string | null): Promise<void>;
  onAutoCut(relay: DemoRelay, verdict: NonNullable<FailsafeVerdict>): void;
};

// RawMetricsConsumer가 전달한 시간순 sample을 판정한다. PostgreSQL edge
// command는 outbox에 저장하며, relay.autoCut WS는 신규 interlock commit 뒤에만 보낸다.
export async function evaluateFailsafe(
  deps: FailsafeDeps,
  batteryId: string,
  profile: HardwareProfile,
  sample: FailsafeSample,
  thresholds: FailsafeThresholds
): Promise<FailsafeVerdict> {
  const verdict = judgeFailsafe(profile, sample, thresholds);
  if (!verdict) return null;
  // 빠른 경로로 이미 걸린 인터락을 건너뛴다. 다음 transaction 판정은
  // 다른 worker가 먼저 차단한 경합까지 막는다.
  const current = await deps.relayByBattery(batteryId);
  if (current.interlockEngaged) return null;
  const engagement = await deps.engageFailsafe(batteryId, verdict.triggerCode, verdict.condition);
  // A concurrent process may have latched the interlock after relayByBattery.
  // The transaction result is authoritative for both edge work and WS output.
  if (!engagement.newlyEngaged) return null;
  // 인터락을 먼저 세운 뒤 에지에 알린다. 순서가 뒤바뀌면 에지 명령이 실패했을 때
  // 서버는 안전하다고 믿는데 실제로는 차단되지 않은 상태가 된다.
  await deps.relayCut(batteryId, verdict.triggerCode);
  deps.onAutoCut(engagement.relay, verdict);
  return verdict;
}
