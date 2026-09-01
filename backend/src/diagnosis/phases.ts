// 모드 2 빠른 진단의 단계 시퀀스. 정본은
// docs/hardware/mode2_powerbank_diagnosis_spec.md §3-1 표다.
//
// 단계를 경과시간에서 계산하는 이유: 러너가 단계 상태를 들고 있지 않으면
// tick이 밀리거나 걸러져도 단계가 어긋나지 않는다. 서버가 바빠도 P3가
// 40초보다 짧아지지 않는다.

export type PhaseSpec = { phase: string; durationMs: number; loadTargetA: number };

// P0·P5는 무부하가 아니다. 보조배터리는 무부하가 10~30초 지속되면 출력을
// 스스로 끊으므로(스펙 §2-6), 진짜 무부하로 두면 기준전압을 0V로 읽는다.
export const MIN_HOLD_LOAD_A = 0.1;

export const CAPACITY_PHASE = "CAPACITY";

// BW150 설정 분해능이 0.01A다.
const LOAD_RESOLUTION_A = 0.01;

// ⚠️ 이 사다리에는 정격 전류 상한이 없다 — 의도적이다. `0.7 × 광고 정격
// 전류` 상한은 스펙 §9-2 "고정 자극 15분"(스크리닝 프로토콜)에만 있는
// 규칙이고, §3-1의 빠른 진단 사다리(이 표)는 0.1/0.5/1.0/1.5/2.0/0.1A로
// 고정이며 상한을 두지 않는다. 예전에 §9의 규칙을 여기로 잘못 들여왔더니
// specAttainmentPct의 분자가 0.7×rated를 못 넘어 HEALTHY가 어떤 자산에도
// 나올 수 없었다(등급 4개 중 1개가 도달 불가능해짐). §3-2는 사다리가
// 이탈점(latch-off 포함)을 찾아내길 기대하므로, 정격 1A짜리 팩에 2.0A를
// 거는 것도 스펙상 맞다.
//
// ⚠️ 미해결 — 지금 측정원은 시뮬레이터라 물리적 위험이 없지만, 실기기에서
// 빠른 진단도 정격 전류로 상한을 걸어야 하는지는 실측이 필요한 열린
// 질문이다(§3-3의 미측정 중단 문턱들과 같은 부류). 정하지 말고 남겨둔다.
const QUICK_TABLE: readonly { phase: string; durationMs: number; baseLoadA: number }[] = [
  { phase: "P0", durationMs: 10_000, baseLoadA: 0.1 },
  { phase: "P1", durationMs: 20_000, baseLoadA: 0.5 },
  { phase: "P2", durationMs: 20_000, baseLoadA: 1.0 },
  // P3만 40초인 이유: 케이스 열시정수가 수십 초 단위라 20초 기울기는
  // 노이즈에 묻힌다. 발열 기울기를 재는 구간만 두 배로 둔다(스펙 §3-1).
  { phase: "P3", durationMs: 40_000, baseLoadA: 1.5 },
  { phase: "P4", durationMs: 20_000, baseLoadA: 2.0 },
  { phase: "P5", durationMs: 10_000, baseLoadA: 0.1 },
  // P6(미세 스윕)은 스윕 알고리즘이 미정이라 시퀀스에 넣지 않는다.
];

function roundLoad(value: number): number {
  // 브리프 원안(`Math.round(value / LOAD_RESOLUTION_A) * LOAD_RESOLUTION_A`)은
  // 부동소수점 오차로 0.7 대신 0.7000000000000001을 낸다(예: quickPhases(1.0)의
  // P2). `toFixed`로 소수 2자리(분해능 자릿수)에서 한 번 더 고정해 오차를 없앤다.
  return Number((Math.round(value / LOAD_RESOLUTION_A) * LOAD_RESOLUTION_A).toFixed(2));
}

// `ratedOutputCurrentA`는 더 이상 사다리 계산에 쓰이지 않는다(위 주석 참조)
// — 그래도 시그니처에 남긴다. `store/memory.ts`·`diagnosis/runner.ts`가
// 이미 자산의 정격 전류를 넘겨 호출하고 있고, 이번 수정의 범위는
// `phases.ts`·`phases.test.ts` 두 파일뿐이라 그 호출부를 고칠 수 없다.
// 파라미터를 지우면 시그니처가 깨져 두 호출부가 컴파일에 실패한다.
export function quickPhases(ratedOutputCurrentA: number | null): PhaseSpec[] {
  void ratedOutputCurrentA;
  return QUICK_TABLE.map(({ phase, durationMs, baseLoadA }) => ({
    phase,
    durationMs,
    loadTargetA: roundLoad(Math.max(MIN_HOLD_LOAD_A, baseLoadA)),
  }));
}

export function totalDurationMs(specs: PhaseSpec[]): number {
  return specs.reduce((sum, spec) => sum + spec.durationMs, 0);
}

export function phaseIndexAt(specs: PhaseSpec[], elapsedMs: number): number {
  if (elapsedMs < 0) return -1;
  let boundary = 0;
  for (let index = 0; index < specs.length; index += 1) {
    boundary += specs[index].durationMs;
    if (elapsedMs < boundary) return index;
  }
  return -1;
}

export function phaseAt(specs: PhaseSpec[], elapsedMs: number): PhaseSpec | null {
  const index = phaseIndexAt(specs, elapsedMs);
  return index === -1 ? null : specs[index];
}

// 후반 절반만 집계한다 — 부하를 바꾼 직후에는 컨버터가 재정착하는
// 과도구간이라 값이 흔들린다(스펙 §3-1).
export function isInAggregationWindow(specs: PhaseSpec[], elapsedMs: number): boolean {
  const index = phaseIndexAt(specs, elapsedMs);
  if (index === -1) return false;
  let start = 0;
  for (let i = 0; i < index; i += 1) start += specs[i].durationMs;
  return elapsedMs >= start + specs[index].durationMs / 2;
}
