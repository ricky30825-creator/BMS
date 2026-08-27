import { judgeFailsafe } from "./failsafe.js";
import type { FailsafeSample, FailsafeThresholds, FailsafeVerdict, HardwareProfile } from "./failsafe.js";
import type { DemoRelay } from "./store.js";

export type FailsafeDeps = {
  relayByBattery(batteryId: string): Promise<DemoRelay>;
  engageFailsafe(batteryId: string, triggerCode: string, condition: string): Promise<DemoRelay>;
  relayCut(batteryId: string, reasonCode: string | null): Promise<void>;
  onAutoCut(relay: DemoRelay, verdict: NonNullable<FailsafeVerdict>): void;
};

// 판정 → 차단 → 에지 통보 → WS 푸시. 텔레메트리 프레임마다 불릴 자리이며,
// 지금은 Consumer가 없어 호출부가 없다(2026-08-27 결정 — 순수 로직만 만들고
// 구독 배선은 Kafka Consumer가 생긴 뒤).
export async function evaluateFailsafe(
  deps: FailsafeDeps,
  batteryId: string,
  profile: HardwareProfile,
  sample: FailsafeSample,
  thresholds: FailsafeThresholds
): Promise<FailsafeVerdict> {
  const verdict = judgeFailsafe(profile, sample, thresholds);
  if (!verdict) return null;
  // 이미 걸려 있으면 재차단하지 않는다. engageFailsafe는 멱등이 아니라서
  // 매 프레임 부르면 감사 로그가 초당 10건씩 쌓인다.
  const current = await deps.relayByBattery(batteryId);
  if (current.interlockEngaged) return null;
  const relay = await deps.engageFailsafe(batteryId, verdict.triggerCode, verdict.condition);
  // 인터락을 먼저 세운 뒤 에지에 알린다. 순서가 뒤바뀌면 에지 명령이 실패했을 때
  // 서버는 안전하다고 믿는데 실제로는 차단되지 않은 상태가 된다.
  await deps.relayCut(batteryId, verdict.triggerCode);
  deps.onAutoCut(relay, verdict);
  return verdict;
}
