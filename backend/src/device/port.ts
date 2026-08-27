// 백엔드 → 에지(라즈베리파이) 아웃바운드 명령. 계약상 `battery-events` 토픽으로
// 나가지만(CLAUDE.md §Kafka 토픽 규약), **이 인터페이스는 전송 수단을 모른다.**
// 무엇을 언제 보낼지는 도메인 판단이라 백엔드가 정하고, 실제 발행은 인프라
// 담당자가 같은 인터페이스로 구현한다.
//
// 음성 안내도 같은 경로다 — `docs/backend_contract.md:697`:
//   "세션 시작/종료는 battery-events 토픽으로 발행되어 라즈베리파이가 로컬
//    음성파일을 재생한다. 이 발행은 백엔드 책임이며 프론트는 관여하지 않는다."
//
// 문구를 만들지 않는다. code + params만 보낸다(mode1_backend_spec.md §787).
export interface DeviceCommandPort {
  relayCut(batteryId: string, reasonCode: string | null): Promise<void>;
  relayRestore(batteryId: string): Promise<void>;
  sessionStarted(sessionId: string, batteryId: string, targetMode: 1 | 2): Promise<void>;
  sessionEnded(sessionId: string, endReason: string): Promise<void>;
}
