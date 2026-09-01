// 서버는 사용자에게 보일 문구를 만들지 않는다(계약 §1.10). code만 내려주고
// 문장은 여기서 조립한다. 한/영 토글이 붙으면 이 파일이 사전 자리가 된다.

const GRADE: Record<string, string> = {
  HEALTHY: "양호",
  CAUTION: "주의",
  SUSPECT_DEGRADED: "열화 의심",
  BASELINE_PENDING: "기준 없음",
};

const ABORT_REASON: Record<string, string> = {
  USER: "사용자 중단",
  TEMP_ABSOLUTE: "표면온도 상한 초과",
  TEMP_SLOPE: "온도 상승률 초과",
  GAS: "가스 임계 초과",
  VOLTAGE_COLLAPSE: "출력전압 붕괴",
  SESSION_ENDED: "세션 종료",
  RELAY_CUT: "릴레이 차단",
  DEVICE_OFFLINE: "진단기 오프라인",
};

const STATUS: Record<string, string> = {
  RUNNING: "진행 중",
  COMPLETED: "완료",
  ABORTED: "중단됨",
  FAILED: "실패",
};

function lookup(table: Record<string, string>, code: string | null | undefined): string {
  if (!code) return "—";
  return table[code] ?? code;
}

export function gradeLabel(code: string | null | undefined): string { return lookup(GRADE, code); }
export function abortReasonLabel(code: string | null | undefined): string { return lookup(ABORT_REASON, code); }
export function statusLabel(code: string | null | undefined): string { return lookup(STATUS, code); }

export function progressPct(startedAt: string, estimatedEndAt: string | null | undefined, now = Date.now()): number | null {
  if (!estimatedEndAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(estimatedEndAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100));
}

const CAPABILITY_LOCK: Record<string, { title: string; body: string }> = {
  RELAY_CUT: {
    title: "릴레이 차단 상태",
    body: "릴레이가 열려 있어 부하 경로가 없습니다. 진단을 시작하려면 먼저 릴레이를 복구하세요.",
  },
  DEVICE_OFFLINE: {
    title: "진단기 오프라인",
    body: "진단기와 연결이 끊겼습니다. 장비 상태를 확인한 뒤 다시 시도하세요.",
  },
  SAFETY_PROFILE_NOT_READY: {
    title: "안전 프로필 준비 필요",
    body: "확정 안전 문턱과 부하 제어가 검증되지 않은 프로필입니다.",
  },
};

export function capabilityLock(code: string | null | undefined): { title: string; body: string } {
  return CAPABILITY_LOCK[code ?? ""] ?? { title: "진단을 실행할 수 없음", body: "현재 이 자산에서는 진단을 시작할 수 없습니다." };
}
