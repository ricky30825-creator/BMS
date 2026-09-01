# F21 보조배터리 진단 러너 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모드 2 보조배터리 진단의 실행 잠금을 열고, 백엔드가 단계를 진행시켜 WS를 발행하고 실제 결과를 산출하게 만든다.

**Architecture:** 순수 계산 모듈(`phases`/`metrics`/`safety`)을 ingest 포트 뒤에 두고, 오늘은 시뮬레이터가 그 포트를 호출한다. 나중에 Kafka consumer가 같은 포트를 구현하면 산식과 러너는 그대로 둔 채 `simulator.ts`만 지운다. 기존 `failsafe.ts`(순수) / `failsafeRunner.ts`(부수효과) 분리를 그대로 따른다.

**Tech Stack:** TypeScript (ESM, `"type": "module"`), Express 4, vitest 4, React 19 + TanStack Query 5, MSW 2

**Spec:** `docs/superpowers/specs/2026-09-01-f21-diagnosis-runner-design.md`

## Global Constraints

- **ESM import는 반드시 `.js` 확장자로 쓴다** — `import { x } from "./phases.js"`. 소스가 `.ts`여도 그렇다. 빼면 런타임에 깨진다.
- **테스트 파일은 소스 옆에 둔다** — `src/diagnosis/metrics.test.ts`. `vitest.config.ts`의 `include`가 `src/**/*.test.ts`다.
- **`0`은 미설정 sentinel이다.** 안전 문턱·`S1`이 `0`이면 그 계층을 비활성화한다. `failsafe.ts:37`의 `UNSET_THRESHOLDS` 규약과 같다.
- **`currentA`는 부호를 살린다** — 양수 = 충전, 음수 = 방전. 산식에서는 `Math.abs()`를 쓰고, 절대값으로 저장하지 않는다.
- **`metrics.ts`·`phases.ts`·`safety.ts`는 스토어를 import하지 않는다.** `store/types.ts`가 `PhaseWindow`를 import하므로 반대 방향은 순환 참조다.
- **열화 등급(`HEALTHY`/`CAUTION`/`SUSPECT_DEGRADED`/`BASELINE_PENDING`)과 이상등급(`NORMAL`/`CAUTION`/`WARNING`/`DANGER`)은 다른 축이다.** 합산하거나 같은 타입으로 취급하지 않는다. `CAUTION`이 양쪽에 다 있다.
- **서버는 사용자에게 보일 문구를 만들지 않는다.** code만 내려주고 문장은 프론트 사전이 조립한다.
- **커밋 메시지는 한 줄 요약 + 필요 시 본문.** 작업 단위마다 커밋한다.
- 백엔드 검증 명령: `cd backend && npm test`, `npm run typecheck`
- 프론트 검증 명령: `cd frontend && npm test`, `npm run typecheck`

---

## Group A — 순수 계산 모듈 (Task 1-4)

스토어도 서버도 건드리지 않는다. 픽스처만으로 검증된다.

---

### Task 1: 단계 시퀀스 (`phases.ts`)

**Files:**
- Create: `backend/src/diagnosis/phases.ts`
- Test: `backend/src/diagnosis/phases.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `type PhaseSpec = { phase: string; durationMs: number; loadTargetA: number }`
  - `const MIN_HOLD_LOAD_A = 0.1`
  - `const CAPACITY_PHASE = "CAPACITY"`
  - `function quickPhases(ratedOutputCurrentA: number | null): PhaseSpec[]`
  - `function totalDurationMs(specs: PhaseSpec[]): number`
  - `function phaseIndexAt(specs: PhaseSpec[], elapsedMs: number): number` (종료면 `-1`)
  - `function phaseAt(specs: PhaseSpec[], elapsedMs: number): PhaseSpec | null`
  - `function isInAggregationWindow(specs: PhaseSpec[], elapsedMs: number): boolean`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`backend/src/diagnosis/phases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CAPACITY_PHASE, isInAggregationWindow, phaseAt, phaseIndexAt, quickPhases, totalDurationMs } from "./phases.js";

describe("quickPhases", () => {
  it("정격 전류가 없으면 스펙 §3-1의 6단계를 그대로 낸다", () => {
    const specs = quickPhases(null);
    expect(specs.map((s) => s.phase)).toEqual(["P0", "P1", "P2", "P3", "P4", "P5"]);
    expect(specs.map((s) => s.loadTargetA)).toEqual([0.1, 0.5, 1.0, 1.5, 2.0, 0.1]);
  });

  it("P3만 40초이고 합계는 120초다", () => {
    const specs = quickPhases(null);
    expect(specs.find((s) => s.phase === "P3")?.durationMs).toBe(40_000);
    expect(totalDurationMs(specs)).toBe(120_000);
  });

  it("P6는 시퀀스에 넣지 않는다 — 스윕 알고리즘이 미정이다", () => {
    expect(quickPhases(null).some((s) => s.phase === "P6")).toBe(false);
  });

  it("목표 전류에 0.7 × 정격 상한을 건다", () => {
    // 정격 1.0A → 상한 0.7A. P3(1.5)·P4(2.0)가 깎인다
    const specs = quickPhases(1.0);
    expect(specs.find((s) => s.phase === "P2")?.loadTargetA).toBe(0.7);
    expect(specs.find((s) => s.phase === "P3")?.loadTargetA).toBe(0.7);
    expect(specs.find((s) => s.phase === "P4")?.loadTargetA).toBe(0.7);
  });

  it("상한이 걸려도 P0·P5의 최소 유지 부하 0.1A 아래로는 내려가지 않는다", () => {
    // 무부하로 두면 보조배터리가 출력을 스스로 끊는다(스펙 §2-6)
    const specs = quickPhases(0.05);
    expect(specs.find((s) => s.phase === "P0")?.loadTargetA).toBe(0.1);
    expect(specs.find((s) => s.phase === "P5")?.loadTargetA).toBe(0.1);
  });

  it("BW150 설정 분해능에 맞춰 0.01A 단위로 반올림한다", () => {
    const specs = quickPhases(1.3); // 0.7 × 1.3 = 0.91
    expect(specs.find((s) => s.phase === "P4")?.loadTargetA).toBe(0.91);
  });
});

describe("phaseAt", () => {
  const specs = quickPhases(null);

  it("경과시간으로 단계를 정한다 — 러너가 상태를 들고 있지 않게 하려는 것이다", () => {
    expect(phaseAt(specs, 0)?.phase).toBe("P0");
    expect(phaseAt(specs, 9_999)?.phase).toBe("P0");
    expect(phaseAt(specs, 10_000)?.phase).toBe("P1");
    expect(phaseAt(specs, 89_999)?.phase).toBe("P3");
    expect(phaseAt(specs, 90_000)?.phase).toBe("P4");
    expect(phaseAt(specs, 119_999)?.phase).toBe("P5");
  });

  it("총 시간을 넘으면 null — 종료 신호다", () => {
    expect(phaseAt(specs, 120_000)).toBeNull();
    expect(phaseIndexAt(specs, 120_000)).toBe(-1);
  });
});

describe("isInAggregationWindow", () => {
  const specs = quickPhases(null);

  it("각 단계의 후반 절반만 집계한다 — 부하 변경 직후는 컨버터 재정착 과도구간이다", () => {
    expect(isInAggregationWindow(specs, 4_999)).toBe(false); // P0 전반
    expect(isInAggregationWindow(specs, 5_000)).toBe(true);  // P0 후반
    expect(isInAggregationWindow(specs, 60_000)).toBe(false); // P3 시작(50s~90s) 전반
    expect(isInAggregationWindow(specs, 70_000)).toBe(true);  // P3 후반 20초
  });

  it("종료 후에는 false", () => {
    expect(isInAggregationWindow(specs, 130_000)).toBe(false);
  });
});

describe("CAPACITY_PHASE", () => {
  it("정밀 용량은 단일 단계다", () => {
    expect(CAPACITY_PHASE).toBe("CAPACITY");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `cd backend && npx vitest run src/diagnosis/phases.test.ts`
Expected: FAIL — `Failed to resolve import "./phases.js"`

- [ ] **Step 3: 최소 구현을 쓴다**

`backend/src/diagnosis/phases.ts`:

```ts
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

// 0.7 × 광고 정격 전류 상한(스펙 §9). 정격 1A짜리 팩에 1.5A를 걸면
// "위험"이 아니라 "정격 초과"를 재게 된다.
const RATED_LOAD_FRACTION = 0.7;

// BW150 설정 분해능이 0.01A다.
const LOAD_RESOLUTION_A = 0.01;

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
  return Math.round(value / LOAD_RESOLUTION_A) * LOAD_RESOLUTION_A;
}

export function quickPhases(ratedOutputCurrentA: number | null): PhaseSpec[] {
  const cap = ratedOutputCurrentA !== null && ratedOutputCurrentA > 0
    ? ratedOutputCurrentA * RATED_LOAD_FRACTION
    : Number.POSITIVE_INFINITY;
  return QUICK_TABLE.map(({ phase, durationMs, baseLoadA }) => ({
    phase,
    durationMs,
    loadTargetA: roundLoad(Math.max(MIN_HOLD_LOAD_A, Math.min(baseLoadA, cap))),
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
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `cd backend && npx vitest run src/diagnosis/phases.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: 커밋**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add backend/src/diagnosis/phases.ts backend/src/diagnosis/phases.test.ts
git commit -m "feat(diagnosis): define the mode 2 quick-diagnosis phase sequence"
```

---

### Task 2: 빠른 진단 산식 (`metrics.ts` 1/2)

**Files:**
- Create: `backend/src/diagnosis/metrics.ts`
- Test: `backend/src/diagnosis/metrics.test.ts`

**Interfaces:**
- Consumes: 없음 (`phases.ts`도 import하지 않는다 — 산식은 단계 정의를 몰라도 된다)
- Produces:
  - `type PhaseWindow = { phase: string; loadTargetA: number; voltageMedianV: number; currentMedianA: number; tempSamples: { atMs: number; tempIrSurfaceC: number }[]; latchOff: boolean }`
  - `const LATCH_OFF_VOLTAGE_V = 1.0`, `REGULATION_RATIO = 0.94`, `COLLAPSE_RATIO = 0.8`
  - `function median(values: number[]): number | null`
  - `function vLightLoadV(windows: PhaseWindow[]): number | null`
  - `type KneeResult = { regulationKneeA: number | null; kneeIsUpperBound: boolean; latchOff: boolean }`
  - `function regulationKnee(windows: PhaseWindow[]): KneeResult`
  - `function thermalSlopeCPerMin(windows: PhaseWindow[]): number | null`
  - `function specAttainmentPct(windows, ratedOutputCurrentA): number | null`
  - `type QuickGrade = "HEALTHY" | "CAUTION" | "SUSPECT_DEGRADED" | "BASELINE_PENDING"`
  - `function quickGrade(input: QuickGradeInput): { grade: QuickGrade; gradeProvisional: boolean }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`backend/src/diagnosis/metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { median, quickGrade, regulationKnee, specAttainmentPct, thermalSlopeCPerMin, vLightLoadV } from "./metrics.js";
import type { PhaseWindow } from "./metrics.js";

const win = (phase: string, loadTargetA: number, voltageMedianV: number, overrides: Partial<PhaseWindow> = {}): PhaseWindow => ({
  phase,
  loadTargetA,
  voltageMedianV,
  currentMedianA: -loadTargetA,
  tempSamples: [],
  latchOff: false,
  ...overrides,
});

// V_light 5.00V → 이탈 문턱 4.70V, 붕괴 문턱 4.00V
const healthyWindows = (): PhaseWindow[] => [
  win("P0", 0.1, 5.0),
  win("P1", 0.5, 4.98),
  win("P2", 1.0, 4.95),
  win("P3", 1.5, 4.92),
  win("P4", 2.0, 4.9),
  win("P5", 0.1, 5.0),
];

describe("median", () => {
  it("홀수 개는 가운데 값", () => { expect(median([3, 1, 2])).toBe(2); });
  it("짝수 개는 가운데 두 값의 평균", () => { expect(median([1, 2, 3, 4])).toBe(2.5); });
  it("빈 배열은 null", () => { expect(median([])).toBeNull(); });
});

describe("vLightLoadV", () => {
  it("P0 창의 전압 중앙값이다 — 무부하 전압이 아니라 경부하 출력전압이다", () => {
    expect(vLightLoadV(healthyWindows())).toBe(5.0);
  });

  it("P0 창이 없으면 null", () => {
    expect(vLightLoadV([win("P1", 0.5, 4.98)])).toBeNull();
  });
});

describe("regulationKnee", () => {
  it("2.0A까지 버티면 상한 표시를 단다 — '2.0A 이상'이지 '정확히 2.0A'가 아니다", () => {
    const result = regulationKnee(healthyWindows());
    expect(result).toEqual({ regulationKneeA: 2.0, kneeIsUpperBound: true, latchOff: false });
  });

  it("V_light의 94% 아래로 떨어지는 최소 전류가 이탈점이다", () => {
    const windows = healthyWindows();
    windows[4] = win("P4", 2.0, 4.6); // 4.6 < 4.70
    const result = regulationKnee(windows);
    expect(result.regulationKneeA).toBe(2.0);
    expect(result.kneeIsUpperBound).toBe(false);
  });

  it("94% 경계는 미만일 때만 이탈이다 — 정확히 94%는 이탈 아님", () => {
    const windows = healthyWindows();
    windows[3] = win("P3", 1.5, 4.7); // 정확히 0.94 × 5.0
    expect(regulationKnee(windows).kneeIsUpperBound).toBe(true);
  });

  it("절대값 4.7V가 아니라 V_light 비율로 판정한다 — 9V·12V PD에서도 성립해야 한다", () => {
    const windows: PhaseWindow[] = [
      win("P0", 0.1, 9.0),
      win("P1", 0.5, 8.9),
      win("P2", 1.0, 8.3), // 8.3 < 0.94 × 9.0 = 8.46
    ];
    expect(regulationKnee(windows).regulationKneeA).toBe(1.0);
  });

  it("래치오프(출력 소실)도 정상적인 이탈 관측이다", () => {
    const windows = healthyWindows();
    windows[3] = win("P3", 1.5, 0.2, { latchOff: true });
    const result = regulationKnee(windows);
    expect(result.regulationKneeA).toBe(1.5);
    expect(result.latchOff).toBe(true);
  });

  it("V_light를 못 구하면 null", () => {
    expect(regulationKnee([win("P1", 0.5, 4.9)]).regulationKneeA).toBeNull();
  });
});

describe("thermalSlopeCPerMin", () => {
  it("P3 구간의 최소자승 기울기를 분당으로 낸다", () => {
    // 40초 동안 2.0°C 상승 → 3.0 °C/min
    const samples = [0, 10_000, 20_000, 30_000, 40_000].map((atMs) => ({
      atMs,
      tempIrSurfaceC: 30 + (atMs / 60_000) * 3.0,
    }));
    const windows = healthyWindows();
    windows[3] = win("P3", 1.5, 4.92, { tempSamples: samples });
    expect(thermalSlopeCPerMin(windows)).toBeCloseTo(3.0, 5);
  });

  it("두 점 차분이 아니라 최소자승이다 — 마지막 점만 튀어도 기울기가 끌려가지 않는다", () => {
    const samples = [
      { atMs: 0, tempIrSurfaceC: 30 },
      { atMs: 10_000, tempIrSurfaceC: 30 },
      { atMs: 20_000, tempIrSurfaceC: 30 },
      { atMs: 30_000, tempIrSurfaceC: 30 },
      { atMs: 40_000, tempIrSurfaceC: 40 }, // IR 노이즈 스파이크
    ];
    const windows = healthyWindows();
    windows[3] = win("P3", 1.5, 4.92, { tempSamples: samples });
    // 두 점 차분이면 15 °C/min. 최소자승은 그보다 훨씬 작다
    expect(thermalSlopeCPerMin(windows)!).toBeLessThan(10);
  });

  it("샘플이 2개 미만이면 null", () => {
    const windows = healthyWindows();
    windows[3] = win("P3", 1.5, 4.92, { tempSamples: [{ atMs: 0, tempIrSurfaceC: 30 }] });
    expect(thermalSlopeCPerMin(windows)).toBeNull();
  });
});

describe("specAttainmentPct", () => {
  it("이탈 없이 버틴 최대 전류를 정격으로 나눈다", () => {
    const windows = healthyWindows();
    windows[4] = win("P4", 2.0, 4.5); // 이탈
    expect(specAttainmentPct(windows, 2.0)).toBe(75); // 1.5 / 2.0
  });

  it("정격을 넘겨 버텨도 100%를 넘지 않는다", () => {
    expect(specAttainmentPct(healthyWindows(), 1.0)).toBe(100);
  });

  it("정격이 없으면 null — 등급 판정에서 제외된다", () => {
    expect(specAttainmentPct(healthyWindows(), null)).toBeNull();
  });
});

describe("quickGrade", () => {
  const base = { regulationKneeA: 2.0, ratedOutputCurrentA: 2.0, thermalSlopeCPerMin: 1.0, s1CPerMin: 5, specAttainmentPct: 100 };

  it("세 조건을 다 만족하면 HEALTHY", () => {
    expect(quickGrade(base)).toEqual({ grade: "HEALTHY", gradeProvisional: false });
  });

  it("하나만 벗어나면 CAUTION", () => {
    expect(quickGrade({ ...base, specAttainmentPct: 90 }).grade).toBe("CAUTION");
  });

  it("둘 이상 벗어나면 SUSPECT_DEGRADED", () => {
    expect(quickGrade({ ...base, specAttainmentPct: 90, thermalSlopeCPerMin: 9 }).grade).toBe("SUSPECT_DEGRADED");
  });

  it("이탈점이 정격의 70% 미만이면 하나만 벗어나도 SUSPECT_DEGRADED", () => {
    expect(quickGrade({ ...base, regulationKneeA: 1.2, specAttainmentPct: 100 }).grade).toBe("SUSPECT_DEGRADED");
  });

  it("도달률 95%가 경계다 — 95는 통과", () => {
    expect(quickGrade({ ...base, specAttainmentPct: 95 }).grade).toBe("HEALTHY");
    expect(quickGrade({ ...base, specAttainmentPct: 94.9 }).grade).toBe("CAUTION");
  });

  it("S1이 0(미설정)이면 기울기 조건을 위반으로 보지 않고 gradeProvisional을 단다", () => {
    const result = quickGrade({ ...base, s1CPerMin: 0, thermalSlopeCPerMin: 999 });
    expect(result.grade).toBe("HEALTHY");
    expect(result.gradeProvisional).toBe(true);
  });

  it("관측 가능한 조건이 2개 미만이면 BASELINE_PENDING — 비교 기준이 없다", () => {
    const result = quickGrade({ regulationKneeA: 2.0, ratedOutputCurrentA: null, thermalSlopeCPerMin: null, s1CPerMin: 0, specAttainmentPct: null });
    expect(result.grade).toBe("BASELINE_PENDING");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `cd backend && npx vitest run src/diagnosis/metrics.test.ts`
Expected: FAIL — `Failed to resolve import "./metrics.js"`

- [ ] **Step 3: 최소 구현을 쓴다**

`backend/src/diagnosis/metrics.ts`:

```ts
// 모드 2 진단 산식. 정본은
// docs/hardware/mode2_powerbank_diagnosis_spec.md §3-2·§3-4·§4-2다.
//
// ⚠️ 이 파일은 스토어를 import하지 않는다. store/types.ts가 PhaseWindow를
// import하므로 반대 방향은 순환 참조다.

export type PhaseWindow = {
  phase: string;
  loadTargetA: number;
  voltageMedianV: number;
  currentMedianA: number;          // 부호 살림(방전 = 음수). 산식은 abs()를 쓴다
  tempSamples: { atMs: number; tempIrSurfaceC: number }[];
  latchOff: boolean;
};

// 출력이 사라졌다고 판정하는 우리 쪽 검출 문턱. IC 내부 차단 조건인
// "<4.4V가 30ms 지속"과는 다른 값이며, 우리는 결과로 나타난 출력 소실만 본다.
export const LATCH_OFF_VOLTAGE_V = 1.0;

// 레귤레이션 이탈 문턱. 5V에서 4.70V이며 USB 2.0 다운스트림 포트 하한
// 4.75V 바로 아래다. 절대값이 아니라 비율이라 9V·12V PD에서도 성립한다.
export const REGULATION_RATIO = 0.94;

// 컨버터가 완전히 무너진 상태.
export const COLLAPSE_RATIO = 0.8;

const P0_PHASE = "P0";
const THERMAL_PHASE = "P3";

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// 기준전압은 무부하 전압이 아니라 경부하 출력전압이다(스펙 §2-6).
export function vLightLoadV(windows: PhaseWindow[]): number | null {
  const p0 = windows.find((w) => w.phase === P0_PHASE);
  return p0 ? p0.voltageMedianV : null;
}

export type KneeResult = {
  regulationKneeA: number | null;
  kneeIsUpperBound: boolean;
  latchOff: boolean;
};

export function regulationKnee(windows: PhaseWindow[]): KneeResult {
  const vLight = vLightLoadV(windows);
  if (vLight === null) return { regulationKneeA: null, kneeIsUpperBound: false, latchOff: false };
  const threshold = vLight * REGULATION_RATIO;

  // P0은 기준을 만드는 단계라 판정 대상에서 뺀다. 부하가 올라가는
  // 순서대로 보므로 저전류→상행이 보장된다(스펙 §3-2 ②).
  const candidates = windows.filter((w) => w.phase !== P0_PHASE);
  const departed = candidates.find((w) => w.latchOff || w.voltageMedianV < threshold);

  if (departed) {
    return { regulationKneeA: departed.loadTargetA, kneeIsUpperBound: false, latchOff: departed.latchOff };
  }
  const highest = candidates.reduce((max, w) => Math.max(max, w.loadTargetA), 0);
  return { regulationKneeA: highest || null, kneeIsUpperBound: true, latchOff: false };
}

// 최소자승을 쓰는 이유: 두 점 차분은 IR 노이즈에 취약하다(스펙 §3-2 ②).
export function thermalSlopeCPerMin(windows: PhaseWindow[]): number | null {
  const window = windows.find((w) => w.phase === THERMAL_PHASE);
  if (!window || window.tempSamples.length < 2) return null;
  const points = window.tempSamples;
  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.atMs, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.tempIrSurfaceC, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.atMs - meanX) * (point.tempIrSurfaceC - meanY);
    denominator += (point.atMs - meanX) ** 2;
  }
  if (denominator === 0) return null;
  const slopePerMs = numerator / denominator;
  return slopePerMs * 60_000;
}

export function specAttainmentPct(windows: PhaseWindow[], ratedOutputCurrentA: number | null): number | null {
  if (ratedOutputCurrentA === null || ratedOutputCurrentA <= 0) return null;
  const vLight = vLightLoadV(windows);
  if (vLight === null) return null;
  const threshold = vLight * REGULATION_RATIO;
  const sustained = windows
    .filter((w) => w.phase !== P0_PHASE && !w.latchOff && w.voltageMedianV >= threshold)
    .reduce((max, w) => Math.max(max, w.loadTargetA), 0);
  return (Math.min(sustained, ratedOutputCurrentA) / ratedOutputCurrentA) * 100;
}

export type QuickGrade = "HEALTHY" | "CAUTION" | "SUSPECT_DEGRADED" | "BASELINE_PENDING";

export type QuickGradeInput = {
  regulationKneeA: number | null;
  ratedOutputCurrentA: number | null;
  thermalSlopeCPerMin: number | null;
  s1CPerMin: number;                 // 0 = 미설정
  specAttainmentPct: number | null;
};

const ATTAINMENT_PASS_PCT = 95;
const SEVERE_KNEE_FRACTION = 0.7;

// ⚠️ 이 등급은 이상점수 4등급과 다른 축이다. 열화는 수명, 이상점수는
// 열폭주 위험이다. 두 값을 합산하거나 같은 enum으로 취급하지 않는다.
export function quickGrade(input: QuickGradeInput): { grade: QuickGrade; gradeProvisional: boolean } {
  const { regulationKneeA, ratedOutputCurrentA, thermalSlopeCPerMin: slope, s1CPerMin, specAttainmentPct: attainment } = input;
  const gradeProvisional = s1CPerMin === 0;

  const kneeObservable = regulationKneeA !== null && ratedOutputCurrentA !== null && ratedOutputCurrentA > 0;
  const slopeObservable = s1CPerMin > 0 && slope !== null;
  const attainObservable = attainment !== null;
  const observable = [kneeObservable, slopeObservable, attainObservable].filter(Boolean).length;

  if (observable < 2) return { grade: "BASELINE_PENDING", gradeProvisional };

  const kneeViolated = kneeObservable && regulationKneeA! < ratedOutputCurrentA!;
  const slopeViolated = slopeObservable && slope! >= s1CPerMin;
  const attainViolated = attainObservable && attainment! < ATTAINMENT_PASS_PCT;
  const violations = [kneeViolated, slopeViolated, attainViolated].filter(Boolean).length;

  const severeKnee = kneeObservable && regulationKneeA! < ratedOutputCurrentA! * SEVERE_KNEE_FRACTION;
  if (severeKnee || violations >= 2) return { grade: "SUSPECT_DEGRADED", gradeProvisional };
  if (violations === 1) return { grade: "CAUTION", gradeProvisional };
  return { grade: "HEALTHY", gradeProvisional };
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `cd backend && npx vitest run src/diagnosis/metrics.test.ts`
Expected: PASS (20 tests)

- [ ] **Step 5: 커밋**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add backend/src/diagnosis/metrics.ts backend/src/diagnosis/metrics.test.ts
git commit -m "feat(diagnosis): compute the quick-diagnosis indicators and grade"
```

---

### Task 3: 정밀 용량 산식 (`metrics.ts` 2/2)

**Files:**
- Modify: `backend/src/diagnosis/metrics.ts` (Task 2에서 만든 파일 끝에 추가)
- Test: `backend/src/diagnosis/metrics.test.ts` (Task 2 테스트 파일 끝에 추가)

**Interfaces:**
- Consumes: Task 2의 `metrics.ts`
- Produces:
  - `const DEFAULT_ASSUMED_EFFICIENCY = 0.88`
  - `function accumulateWh(currentWh: number, voltageV: number, currentA: number, tickMs: number): number`
  - `type CapacityResultInput`, `type CapacityResult`
  - `function capacityResult(input: CapacityResultInput): CapacityResult`
  - `function baselineWhFrom(previous: { deliveredWh: number | null; partial: boolean }[]): number | null`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`backend/src/diagnosis/metrics.test.ts` 끝에 추가:

```ts
import { accumulateWh, baselineWhFrom, capacityResult, DEFAULT_ASSUMED_EFFICIENCY } from "./metrics.js";

describe("accumulateWh", () => {
  it("tick 간격에서 시간 단위를 환산해 누적한다", () => {
    // 5V × 1A = 5W를 1초 → 5 / 3600 Wh
    expect(accumulateWh(0, 5, -1, 1000)).toBeCloseTo(5 / 3600, 9);
  });

  it("방전 부호(음수)를 절대값으로 다룬다", () => {
    expect(accumulateWh(0, 5, -1, 1000)).toBe(accumulateWh(0, 5, 1, 1000));
  });

  it("Δt를 상수로 박지 않는다 — 100ms 프레임이 들어와도 같은 코드가 맞는다", () => {
    const oneSecond = accumulateWh(0, 5, -1, 1000);
    const tenFrames = Array.from({ length: 10 }).reduce<number>((wh) => accumulateWh(wh, 5, -1, 100), 0);
    expect(tenFrames).toBeCloseTo(oneSecond, 9);
  });
});

describe("baselineWhFrom", () => {
  it("첫 완료 테스트의 deliveredWh를 기준선으로 삼는다", () => {
    expect(baselineWhFrom([{ deliveredWh: 34.8, partial: false }, { deliveredWh: 31.2, partial: false }])).toBe(34.8);
  });

  it("중단된 결과는 기준선 후보가 아니다", () => {
    expect(baselineWhFrom([{ deliveredWh: 12.0, partial: true }, { deliveredWh: 34.8, partial: false }])).toBe(34.8);
  });

  it("완료 이력이 없으면 null", () => {
    expect(baselineWhFrom([{ deliveredWh: 12.0, partial: true }])).toBeNull();
  });
});

describe("capacityResult", () => {
  const base = { deliveredWh: 31.2, ratedWh: 37.0, baselineWh: 34.8, assumedEfficiency: 0.88, dischargeCurrentA: 1.0, partial: false };

  it("상대 SOH는 기준선 대비다 — η가 분자·분모에서 약분된다", () => {
    expect(capacityResult(base).sohRelPct).toBeCloseTo(89.66, 2);
  });

  it("절대 SOH는 η 가정에 의존하며 assumedEfficiency를 반드시 동봉한다", () => {
    const result = capacityResult(base);
    expect(result.sohAbsPct).toBeCloseTo(95.82, 2);
    expect(result.assumedEfficiency).toBe(0.88);
  });

  it("첫 테스트는 sohRelPct가 null이고 isBaseline이 true다 — 100%로 내면 '열화 없음'으로 오독된다", () => {
    const result = capacityResult({ ...base, baselineWh: null });
    expect(result.sohRelPct).toBeNull();
    expect(result.isBaseline).toBe(true);
  });

  it("중단된 결과는 SOH를 내지 않는다", () => {
    const result = capacityResult({ ...base, partial: true });
    expect(result.sohRelPct).toBeNull();
    expect(result.sohAbsPct).toBeNull();
    expect(result.partial).toBe(true);
  });

  it("중단된 결과는 기준선도 되지 않는다", () => {
    expect(capacityResult({ ...base, baselineWh: null, partial: true }).isBaseline).toBe(false);
  });

  it("η로 보정하지 않으면 새 배터리가 SOH 85%로 나온다 — 회귀 방지", () => {
    // 10000mAh(37Wh) 신품에서 실제로 뽑히는 31.5Wh
    const fresh = capacityResult({ ...base, deliveredWh: 31.5, baselineWh: null });
    expect(31.5 / 37.0 * 100).toBeCloseTo(85.1, 1);   // 보정 안 하면 이 값
    expect(fresh.sohAbsPct).toBeGreaterThan(95);       // 보정하면 정상 범위
  });

  it("정격 용량이 없으면 절대 SOH는 null", () => {
    expect(capacityResult({ ...base, ratedWh: null }).sohAbsPct).toBeNull();
  });

  it("기본 효율은 0.88이다 (스펙 §8 H4, 정의 필요)", () => {
    expect(DEFAULT_ASSUMED_EFFICIENCY).toBe(0.88);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `cd backend && npx vitest run src/diagnosis/metrics.test.ts`
Expected: FAIL — `accumulateWh is not exported`

- [ ] **Step 3: 최소 구현을 쓴다**

`backend/src/diagnosis/metrics.ts` 끝에 추가:

```ts
// ── 정밀 용량 테스트 (스펙 §4) ──────────────────────────────────────

// 부스트 효율. 데이터시트 최대치는 91~96%지만 중부하(2A) + 저잔량 조합에서
// 80% 초반까지 떨어진다. 실측 전이라 `정의 필요`다(스펙 §8 H4).
export const DEFAULT_ASSUMED_EFFICIENCY = 0.88;

const MS_PER_HOUR = 3_600_000;

// ⚠️ Δt를 상수로 박지 않는다. 지금은 1초 tick이지만 Kafka consumer가
// 100ms 프레임을 넣기 시작하면 같은 코드가 그대로 맞아야 한다.
export function accumulateWh(currentWh: number, voltageV: number, currentA: number, tickMs: number): number {
  return currentWh + Math.abs(voltageV * currentA) * (tickMs / MS_PER_HOUR);
}

// 중단된 결과는 기준선 후보가 아니다(스펙 §4-3).
export function baselineWhFrom(previous: { deliveredWh: number | null; partial: boolean }[]): number | null {
  const first = previous.find((item) => !item.partial && item.deliveredWh !== null);
  return first ? first.deliveredWh : null;
}

export type CapacityResultInput = {
  deliveredWh: number;
  ratedWh: number | null;
  baselineWh: number | null;
  assumedEfficiency: number;
  dischargeCurrentA: number;
  partial: boolean;
};

export type CapacityResult = {
  deliveredWh: number;
  ratedWh: number | null;
  baselineWh: number | null;
  sohRelPct: number | null;
  sohAbsPct: number | null;
  assumedEfficiency: number | null;
  dischargeCurrentA: number;
  isBaseline: boolean;
  partial: boolean;
};

export function capacityResult(input: CapacityResultInput): CapacityResult {
  const { deliveredWh, ratedWh, baselineWh, assumedEfficiency, dischargeCurrentA, partial } = input;

  // 첫 테스트에서 sohRelPct를 100%로 내면 "열화 없음"으로 오독된다.
  // 기준선 자신이므로 null + isBaseline: true다(스펙 §4-2).
  const isBaseline = !partial && baselineWh === null;

  const sohRelPct = partial || baselineWh === null || baselineWh <= 0
    ? null
    : (deliveredWh / baselineWh) * 100;

  // 정격 Wh는 셀 기준(3.7V × mAh)이고 측정은 출력단(5V) 기준이라,
  // η로 보정하지 않으면 방금 산 배터리가 SOH 85%로 나온다(스펙 §4-2).
  const sohAbsPct = partial || ratedWh === null || ratedWh <= 0 || assumedEfficiency <= 0
    ? null
    : (deliveredWh / (ratedWh * assumedEfficiency)) * 100;

  return {
    deliveredWh,
    ratedWh,
    baselineWh,
    sohRelPct,
    sohAbsPct,
    assumedEfficiency: partial ? null : assumedEfficiency,
    dischargeCurrentA,
    isBaseline,
    partial,
  };
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `cd backend && npx vitest run src/diagnosis/metrics.test.ts`
Expected: PASS (32 tests)

- [ ] **Step 5: 커밋**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add backend/src/diagnosis/metrics.ts backend/src/diagnosis/metrics.test.ts
git commit -m "feat(diagnosis): compute capacity-test SOH with boost-efficiency correction"
```

---

### Task 4: 안전 중단 판정 (`safety.ts`)

**Files:**
- Create: `backend/src/diagnosis/safety.ts`
- Test: `backend/src/diagnosis/safety.test.ts`

**Interfaces:**
- Consumes: `metrics.ts`의 `COLLAPSE_RATIO`
- Produces:
  - `type DiagnosisAbortReason = "USER" | "TEMP_ABSOLUTE" | "TEMP_SLOPE" | "GAS" | "VOLTAGE_COLLAPSE" | "SESSION_ENDED" | "RELAY_CUT" | "DEVICE_OFFLINE"`
  - `type DiagnosisSafetyThresholds = { surfaceCutoffC: number; tempSlopeCPerMin: number; gasRaw: number }`
  - `const UNSET_DIAGNOSIS_THRESHOLDS: DiagnosisSafetyThresholds`
  - `type SafetySample = { voltageV: number; tempIrSurfaceC: number | null; gasRaw: number | null; tempSlopeCPerMin: number | null }`
  - `function judgeDiagnosisAbort(kind, sample, vLightLoadV, thresholds): DiagnosisAbortReason | null`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`backend/src/diagnosis/safety.test.ts`:

```ts
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `cd backend && npx vitest run src/diagnosis/safety.test.ts`
Expected: FAIL — `Failed to resolve import "./safety.js"`

- [ ] **Step 3: 최소 구현을 쓴다**

`backend/src/diagnosis/safety.ts`:

```ts
// 진단 중 안전 중단 판정. 정본은 스펙 §3-3이다.
//
// ⚠️ 문턱을 하드코딩하지 않는다. H2·H3 실측이 나오면 .env 숫자만 바꾸고
// 이 파일은 건드리지 않는다. 판정 규칙 자체를 바꿔야 하면 이 파일만
// 교체하며, 러너는 영향받지 않는다.
//
// failsafe.ts와 마찬가지로 `0`이 미설정 sentinel이다.

import { COLLAPSE_RATIO } from "./metrics.js";

export type DiagnosisAbortReason =
  | "USER"
  | "TEMP_ABSOLUTE"
  | "TEMP_SLOPE"
  | "GAS"
  | "VOLTAGE_COLLAPSE"
  | "SESSION_ENDED"
  | "RELAY_CUT"
  | "DEVICE_OFFLINE";

export type DiagnosisSafetyThresholds = {
  surfaceCutoffC: number;      // 스펙 잠정 50°C — `정의 필요`(§8 H2)
  tempSlopeCPerMin: number;    // 스펙 잠정 5°C/min — 주 판단 근거
  gasRaw: number;
};

export const UNSET_DIAGNOSIS_THRESHOLDS: DiagnosisSafetyThresholds = Object.freeze({
  surfaceCutoffC: 0,
  tempSlopeCPerMin: 0,
  gasRaw: 0,
});

export type SafetySample = {
  voltageV: number;
  tempIrSurfaceC: number | null;
  gasRaw: number | null;
  tempSlopeCPerMin: number | null;
};

// 절대 온도 → 가스 → 상승률 → 전압 순으로 본다. 어느 것이든 중단하지만
// 보고되는 사유는 하나이므로 근거가 가장 확실한 것을 앞에 둔다.
export function judgeDiagnosisAbort(
  kind: "QUICK" | "CAPACITY",
  sample: SafetySample,
  vLightLoadV: number | null,
  thresholds: DiagnosisSafetyThresholds
): DiagnosisAbortReason | null {
  if (thresholds.surfaceCutoffC > 0 && sample.tempIrSurfaceC !== null && sample.tempIrSurfaceC >= thresholds.surfaceCutoffC) {
    return "TEMP_ABSOLUTE";
  }
  if (thresholds.gasRaw > 0 && sample.gasRaw !== null && sample.gasRaw >= thresholds.gasRaw) {
    return "GAS";
  }
  if (thresholds.tempSlopeCPerMin > 0 && sample.tempSlopeCPerMin !== null && sample.tempSlopeCPerMin > thresholds.tempSlopeCPerMin) {
    return "TEMP_SLOPE";
  }
  // ⚠️ 전압 붕괴는 QUICK에서만 중단 사유다. CAPACITY에서 같은 조건은
  // 정상 컷오프(→ COMPLETED)이며, 러너가 그렇게 처리한다.
  if (kind === "QUICK" && vLightLoadV !== null && sample.voltageV < vLightLoadV * COLLAPSE_RATIO) {
    return "VOLTAGE_COLLAPSE";
  }
  return null;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `cd backend && npx vitest run src/diagnosis/safety.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add backend/src/diagnosis/safety.ts backend/src/diagnosis/safety.test.ts
git commit -m "feat(diagnosis): judge safety aborts with injected thresholds"
```

---

## Group B — 설정과 저장소 (Task 5-6)

---

### Task 5: 진단 문턱을 환경변수로 뺀다

**Files:**
- Modify: `backend/src/config/env.ts`
- Modify: `backend/.env.example`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `const diagnosisSafetyThresholds: DiagnosisSafetyThresholds` (env에서 조립)
  - `const diagnosisS1CPerMin: number`
  - `const diagnosisAssumedEfficiency: number`

- [ ] **Step 1: `env.ts`의 스키마에 5개 항목을 추가한다**

`backend/src/config/env.ts`의 `envSchema` 안, `GOOGLE_CLIENT_SECRET` 줄 앞에 추가:

```ts
  // F21 진단 문턱. 전부 `0`이 미설정 sentinel이며 그 계층을 비활성화한다.
  // H2·H3 실측이 나오면 여기 숫자만 바꾼다(코드 변경 불필요).
  DIAG_SURFACE_CUTOFF_C: z.coerce.number().min(0).default(0),
  DIAG_TEMP_SLOPE_C_PER_MIN: z.coerce.number().min(0).default(0),
  DIAG_GAS_RAW: z.coerce.number().min(0).default(0),
  DIAG_S1_THERMAL_SLOPE_C_PER_MIN: z.coerce.number().min(0).default(0),
  // 부스트 효율은 0이면 절대 SOH를 못 내므로 기본값이 있다(스펙 §8 H4).
  DIAG_ASSUMED_EFFICIENCY: z.coerce.number().min(0).max(1).default(0.88),
```

- [ ] **Step 2: 파일 끝에 파생 상수를 추가한다**

`backend/src/config/env.ts` 끝에 추가:

```ts
import type { DiagnosisSafetyThresholds } from "../diagnosis/safety.js";

export const diagnosisSafetyThresholds: DiagnosisSafetyThresholds = Object.freeze({
  surfaceCutoffC: env.DIAG_SURFACE_CUTOFF_C,
  tempSlopeCPerMin: env.DIAG_TEMP_SLOPE_C_PER_MIN,
  gasRaw: env.DIAG_GAS_RAW,
});

// 발열 기울기 상한. 스펙 §3-4가 "판정의 형태만 확정"이라 실측 전에는 0이며,
// 0이면 그 조건을 위반으로 보지 않고 결과에 gradeProvisional을 단다.
export const diagnosisS1CPerMin = env.DIAG_S1_THERMAL_SLOPE_C_PER_MIN;

export const diagnosisAssumedEfficiency = env.DIAG_ASSUMED_EFFICIENCY;
```

- [ ] **Step 3: `.env.example`에 항목을 추가한다**

`backend/.env.example` 끝에 추가:

```
# ── F21 보조배터리 진단 문턱 ─────────────────────────────────────
# `0`은 미설정 sentinel이며 그 안전 계층을 비활성화한다.
# 실측(mode2 스펙 §8 H2·H3)이 끝나면 여기 숫자만 바꾼다 — 코드는 그대로다.
DIAG_SURFACE_CUTOFF_C=0
DIAG_TEMP_SLOPE_C_PER_MIN=0
DIAG_GAS_RAW=0
# 등급 판정의 발열 기울기 상한. 0이면 gradeProvisional=true로 나간다.
DIAG_S1_THERMAL_SLOPE_C_PER_MIN=0
# 부스트 효율 η. 절대 SOH(참고값) 산출에만 쓰며 응답에 동봉된다.
DIAG_ASSUMED_EFFICIENCY=0.88
```

- [ ] **Step 4: 타입 검사와 기존 테스트가 통과하는지 확인한다**

Run: `cd backend && npm run typecheck && npm test`
Expected: PASS — 기존 테스트 전부 통과 (기본값이 있어 `vitest.config.ts`의 env 설정을 고칠 필요가 없다)

- [ ] **Step 5: 커밋**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add backend/src/config/env.ts backend/.env.example
git commit -m "feat(config): read F21 diagnosis thresholds from the environment"
```

---

### Task 6: 저장소 확장과 데모 픽스처

**Files:**
- Modify: `backend/src/store/types.ts`
- Modify: `backend/src/store/contract.ts`
- Modify: `backend/src/store/memory.ts`
- Modify: `backend/src/store.ts`
- Test: `backend/src/store/contract.test.ts` (테스트 추가)

**Interfaces:**
- Consumes: `diagnosis/metrics.ts`의 `PhaseWindow`
- Produces:
  - `type DiagnosisProgress` (`DemoDiagnosis.progress`)
  - `advanceDiagnosis(id: string, phase: string, progress: DiagnosisProgress): Promise<DemoDiagnosis>`
  - `completeDiagnosis(id: string, result: Record<string, unknown>): Promise<DemoDiagnosis>`
  - `abortDiagnosisBySystem(batteryId: string, reason: string): Promise<DemoDiagnosis | null>`
  - 픽스처 `PB-HONG-001`(모드 2, `hong` 소유), `PB-HONG-002`(기준선 이력 보유)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`backend/src/store/contract.test.ts` 끝에 추가:

```ts
describe("진단 진행 상태", () => {
  it("hong이 모드 2 자산을 갖고 있다 — 기본 데모 계정에서 F21 화면이 잠기면 안 된다", async () => {
    const store = createMemoryStore();
    const owned = await store.batteries("hong");
    expect(owned.some((battery) => battery.targetMode === 2)).toBe(true);
  });

  it("advanceDiagnosis가 단계와 진행 상태를 갱신한다", async () => {
    const store = createMemoryStore();
    const battery = (await store.batteries("hong")).find((b) => b.targetMode === 2)!;
    await store.startSession("hong", battery.id);
    const started = await store.startDiagnosis("hong", "QUICK", battery.id, { acknowledged: true });

    const advanced = await store.advanceDiagnosis(started.id, "P3", {
      loadTargetA: 1.5, loadActualA: 1.47, partialMetrics: { vLightLoadV: 5.02 },
      windows: [], deliveredWh: 0, vLightLoadV: 5.02,
    });

    expect(advanced.phase).toBe("P3");
    expect(advanced.progress?.loadTargetA).toBe(1.5);
  });

  it("completeDiagnosis가 COMPLETED로 닫고 결과를 남긴다", async () => {
    const store = createMemoryStore();
    const battery = (await store.batteries("hong")).find((b) => b.targetMode === 2)!;
    await store.startSession("hong", battery.id);
    const started = await store.startDiagnosis("hong", "QUICK", battery.id, { acknowledged: true });

    const done = await store.completeDiagnosis(started.id, { quick: { grade: "HEALTHY" } });

    expect(done.status).toBe("COMPLETED");
    expect(done.progress).toBeNull();
    expect(await store.activeDiagnosis(battery.id)).toBeNull();
  });

  it("abortDiagnosisBySystem은 활성 세션 없이도 진단을 닫는다 — 세션 종료 시 필요하다", async () => {
    const store = createMemoryStore();
    const battery = (await store.batteries("hong")).find((b) => b.targetMode === 2)!;
    await store.startSession("hong", battery.id);
    const started = await store.startDiagnosis("hong", "QUICK", battery.id, { acknowledged: true });

    const aborted = await store.abortDiagnosisBySystem(battery.id, "SESSION_ENDED");

    expect(aborted?.id).toBe(started.id);
    expect(aborted?.status).toBe("ABORTED");
    expect(aborted?.result?.abortReason).toBe("SESSION_ENDED");
  });

  it("진행 중 진단이 없으면 abortDiagnosisBySystem은 null을 낸다 — 던지지 않는다", async () => {
    const store = createMemoryStore();
    const battery = (await store.batteries("hong")).find((b) => b.targetMode === 2)!;
    expect(await store.abortDiagnosisBySystem(battery.id, "SESSION_ENDED")).toBeNull();
  });

  it("모드 2면 안전 프로필과 무관하게 진단을 시작할 수 있다 (2026-09-01 결정)", async () => {
    const store = createMemoryStore();
    const battery = (await store.batteries("hong")).find((b) => b.targetMode === 2)!;
    await store.startSession("hong", battery.id);
    await expect(store.startDiagnosis("hong", "QUICK", battery.id, { acknowledged: true })).resolves.toBeDefined();
  });

  it("모드 1 자산은 여전히 MODE_NOT_SUPPORTED다", async () => {
    const store = createMemoryStore();
    const battery = (await store.batteries("hong")).find((b) => b.targetMode === 1)!;
    await store.startSession("hong", battery.id);
    await expect(store.startDiagnosis("hong", "QUICK", battery.id, { acknowledged: true })).rejects.toThrow("MODE_NOT_SUPPORTED");
  });
});
```

> `contract.test.ts` 상단에 `createMemoryStore` import가 이미 있는지 확인하고, 없으면
> `import { createMemoryStore } from "./memory.js";` 를 추가한다.

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `cd backend && npx vitest run src/store/contract.test.ts`
Expected: FAIL — `store.advanceDiagnosis is not a function`

- [ ] **Step 3: `store/types.ts`를 고친다**

`DemoDiagnosis` 타입을 교체하고 `F21_THRESHOLDS`를 지운다:

```ts
import type { PhaseWindow } from "../diagnosis/metrics.js";

export type DiagnosisProgress = {
  loadTargetA: number | null;
  loadActualA: number | null;
  partialMetrics: Record<string, number | boolean | null> | null;
  windows: PhaseWindow[];
  deliveredWh: number;
  vLightLoadV: number | null;
};

export type DemoDiagnosis = {
  id: string;
  batteryId: string;
  sessionId: string;
  kind: "QUICK" | "CAPACITY";
  status: "RUNNING" | "COMPLETED" | "ABORTED" | "FAILED";
  phase: string;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  startedAt: string;
  estimatedEndAt: string | null;
  progress: DiagnosisProgress | null;   // RUNNING 동안만 채워진다
};
```

그리고 `F21_THRESHOLDS` 상수 블록(`export const F21_THRESHOLDS = Object.freeze({ … });`)을 **통째로 삭제**한다.
잠금이 모드 2 전체로 열리면서 `configured` 게이트가 사라지기 때문이다(2026-09-01 결정).

- [ ] **Step 4: `store/contract.ts`에 메서드 3개를 추가한다**

`abortDiagnosis(...)` 줄 바로 아래에 추가:

```ts
  advanceDiagnosis(id: string, phase: string, progress: DiagnosisProgress): Promise<DemoDiagnosis>;
  completeDiagnosis(id: string, result: Record<string, unknown>): Promise<DemoDiagnosis>;
  // 안전 중단·세션 종료용. abortDiagnosis와 달리 활성 세션과 소유자를
  // 검사하지 않는다 — 세션이 끝난 뒤에는 그 검사를 통과할 수 없어서
  // 진단이 영원히 RUNNING으로 남는다.
  abortDiagnosisBySystem(batteryId: string, reason: string): Promise<DemoDiagnosis | null>;
```

`DiagnosisProgress`를 타입 import에 추가한다.

- [ ] **Step 5: `store/memory.ts`를 고친다**

5-a. `F21_THRESHOLDS` import를 지운다 (`import { CSV_HEADER, INPUT_LIMITS, csvRow } from "./types.js";`).

5-b. `beginDiagnosis`에서 안전 프로필 게이트를 지우고 `progress`를 초기화한다:

```ts
  const beginDiagnosis = (ownerId: string, kind: "QUICK" | "CAPACITY", batteryId: string, input: Record<string, unknown>): DemoDiagnosis => {
    const battery = findBattery(batteryId);
    const session = findActiveSession(ownerId);
    if (!battery || !session || session.batteryId !== batteryId) throw new Error("NO_ACTIVE_SESSION");
    if (battery.targetMode !== 2) throw new Error("MODE_NOT_SUPPORTED");
    // 안전 프로필 게이트는 2026-09-01에 제거됐다 — 모드 2면 실행을 허용한다.
    // 결과에는 dataSource가 실려 시뮬레이션 시기 데이터를 구분할 수 있다.
    if (kind === "CAPACITY" && battery.capacityWh === null) throw new Error("CAPACITY_NOT_REGISTERED");
    if (findActiveDiagnosis(batteryId)) throw new Error("DIAGNOSIS_IN_PROGRESS");
    const diagnosis: DemoDiagnosis = {
      id: `dg_${randomUUID()}`,
      batteryId,
      sessionId: session.id,
      kind,
      status: "RUNNING",
      phase: kind === "QUICK" ? "P0" : "CAPACITY",
      input,
      result: null,
      startedAt: isoNow(),
      estimatedEndAt: null,   // 러너가 채운다
      progress: { loadTargetA: null, loadActualA: null, partialMetrics: null, windows: [], deliveredWh: 0, vLightLoadV: null },
    };
    demoDiagnoses.set(diagnosis.id, diagnosis);
    return { ...diagnosis };
  };
```

5-c. `cancelDiagnosis` 아래에 3개 함수를 추가한다:

```ts
  const advance = (id: string, phase: string, progress: DiagnosisProgress): DemoDiagnosis => {
    const diagnosis = demoDiagnoses.get(id);
    if (!diagnosis) throw new Error("NOT_FOUND");
    diagnosis.phase = phase;
    diagnosis.progress = progress;
    return { ...diagnosis };
  };

  const complete = (id: string, result: Record<string, unknown>): DemoDiagnosis => {
    const diagnosis = demoDiagnoses.get(id);
    if (!diagnosis) throw new Error("NOT_FOUND");
    diagnosis.status = "COMPLETED";
    diagnosis.result = result;
    diagnosis.progress = null;
    return { ...diagnosis };
  };

  const cancelBySystem = (batteryId: string, reason: string): DemoDiagnosis | null => {
    const diagnosis = findActiveDiagnosis(batteryId);
    if (!diagnosis) return null;
    const stored = demoDiagnoses.get(diagnosis.id)!;
    stored.status = "ABORTED";
    // 부분 결과를 SOH로 쓰지 않으려면 partial 표시가 남아야 한다(스펙 §4-3).
    stored.result = { abortReason: reason, partial: true, deliveredWh: stored.progress?.deliveredWh ?? 0 };
    stored.progress = null;
    return { ...stored };
  };
```

`cancelDiagnosis`도 `partial`과 `deliveredWh`를 남기도록 고친다:

```ts
    diagnosis.status = "ABORTED";
    diagnosis.result = { abortReason: "USER", partial: true, deliveredWh: diagnosis.progress?.deliveredWh ?? 0 };
    diagnosis.progress = null;
```

5-d. 반환 객체에 3개를 등록한다 (`abortDiagnosis` 줄 아래):

```ts
    async advanceDiagnosis(id, phase, progress) { return advance(id, phase, progress); },
    async completeDiagnosis(id, result) { return complete(id, result); },
    async abortDiagnosisBySystem(batteryId, reason) { return cancelBySystem(batteryId, reason); },
```

5-e. `demoBatteries` 배열 끝(`DEMO-PACK-001` 뒤)에 픽스처 2개를 추가한다:

```ts
    makeBattery({ id: "PB-HONG-001", ownerId: "hong", label: "PB-HONG-001", model: "USB 보조배터리 · 37Wh", maker: "CellGuard Lab", chemistry: "LI_PO", targetMode: 2, seriesCount: null, capacityWh: 37, ratedOutputCurrentA: 2, opsStatus: "NORMAL", latest: { voltageV: 5.05, currentA: -1, powerW: -5.05, tempContact: null, tempIrSurface: 32.4, socPct: 88, score: 0.16, measuredAt: "2026-08-06T01:26:00.000Z" } }),
    makeBattery({ id: "PB-HONG-002", ownerId: "hong", label: "PB-HONG-002", model: "USB 보조배터리 · 37Wh · 기준선 보유", maker: "CellGuard Lab", chemistry: "LI_PO", targetMode: 2, seriesCount: null, capacityWh: 37, ratedOutputCurrentA: 2, opsStatus: "NORMAL", latest: { voltageV: 5.02, currentA: -1.4, powerW: -7.03, tempContact: null, tempIrSurface: 36.1, socPct: 71, score: 0.22, measuredAt: "2026-08-06T01:25:00.000Z" } }),
```

5-f. `demoDiagnoses` 선언 아래에 `PB-HONG-002`의 기준선 이력을 심는다.
`baselineWh`가 없으면 모든 첫 테스트가 `sohRelPct: null`이라 그 경로를 화면에서 볼 수 없다:

```ts
  // PB-HONG-002의 기준선 이력. 이게 없으면 정밀 용량 테스트가 항상
  // isBaseline: true라 sohRelPct가 나오는 화면을 볼 수 없다.
  demoDiagnoses.set("dg_seed_baseline", {
    id: "dg_seed_baseline",
    batteryId: "PB-HONG-002",
    sessionId: "ses_seed",
    kind: "CAPACITY",
    status: "COMPLETED",
    phase: "CAPACITY",
    input: { dischargeCurrentA: 1, fullyChargedConfirmed: true, acknowledged: true },
    result: {
      dataSource: "SIMULATED",
      capacity: {
        deliveredWh: 32.4, ratedWh: 37, baselineWh: null,
        sohRelPct: null, sohAbsPct: 99.5, assumedEfficiency: 0.88,
        dischargeCurrentA: 1, isBaseline: true, partial: false,
      },
    },
    startedAt: "2026-08-01T02:00:00.000Z",
    estimatedEndAt: "2026-08-01T09:20:00.000Z",
    progress: null,
  });
```

- [ ] **Step 6: `store.ts`에 위임을 추가한다**

`export const abortDiagnosis = …` 줄 아래에 추가:

```ts
export const advanceDiagnosis = active.advanceDiagnosis.bind(active);
export const completeDiagnosis = active.completeDiagnosis.bind(active);
export const abortDiagnosisBySystem = active.abortDiagnosisBySystem.bind(active);
```

- [ ] **Step 7: `server.ts`의 `F21_THRESHOLDS` 참조를 끊는다**

`F21_THRESHOLDS`를 삭제했으므로 두 곳을 고쳐야 typecheck가 통과한다.

7-a. `backend/src/server.ts:24` — `./store.js` import 목록에서 `F21_THRESHOLDS,` 줄을 지운다.

7-b. `backend/src/server.ts:829` — `/api/admin/health` 응답을 교체:

```ts
  res.json({ status: "ok", scope: "admin", runtime: "demo", safetyProfile: { configured: true, dataSource: "SIMULATED" } });
```

- [ ] **Step 8: 테스트가 통과하는지 확인한다**

Run: `cd backend && npm test && npm run typecheck`
Expected: PASS — 신규 7건 포함 전부 통과

- [ ] **Step 9: 커밋**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add backend/src/store backend/src/store.ts backend/src/server.ts
git commit -m "feat(store): track diagnosis progress and open the mode 2 gate"
```

---

## Group C — 계측 소스와 러너 (Task 7-8)

---

### Task 7: ingest 포트와 시뮬레이터

**Files:**
- Create: `backend/src/diagnosis/ingest.ts`
- Create: `backend/src/diagnosis/simulator.ts`
- Test: `backend/src/diagnosis/simulator.test.ts`

**Interfaces:**
- Consumes: `store/types.ts`의 `DemoDiagnosis`, `DemoBattery`
- Produces:
  - `type DiagnosisSample = { atMs: number; voltageV: number; currentA: number; tempIrSurfaceC: number | null; gasRaw: number | null; loadTargetA: number }`
  - `interface DiagnosisSource { sample(battery, diagnosis, elapsedMs, loadTargetA, deliveredWh): DiagnosisSample }`
  - `function createSimulatorSource(): DiagnosisSource`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`backend/src/diagnosis/simulator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createSimulatorSource } from "./simulator.js";
import type { DemoBattery, DemoDiagnosis } from "../store/types.js";

const battery = (id: string): DemoBattery => ({
  id, ownerId: "hong", label: id, model: "USB", maker: null, chemistry: "LI_PO",
  targetMode: 2, seriesCount: null, capacityWh: 37, ratedOutputCurrentA: 2,
  opsStatus: "NORMAL", version: 0, adminMemo: "", memo: "",
  latest: { voltageV: 5, currentA: -1, powerW: -5, tempContact: null, tempIrSurface: 30, socPct: 90, score: 0.1, measuredAt: "2026-09-01T00:00:00.000Z" },
} as DemoBattery);

const diagnosis = (kind: "QUICK" | "CAPACITY"): DemoDiagnosis => ({
  id: "dg_1", batteryId: "PB-A", sessionId: "s1", kind, status: "RUNNING",
  phase: kind === "QUICK" ? "P0" : "CAPACITY", input: {}, result: null,
  startedAt: "2026-09-01T00:00:00.000Z", estimatedEndAt: null,
  progress: { loadTargetA: null, loadActualA: null, partialMetrics: null, windows: [], deliveredWh: 0, vLightLoadV: null },
});

describe("createSimulatorSource", () => {
  it("같은 자산은 항상 같은 결과를 낸다 — 재현 가능해야 한다", () => {
    const source = createSimulatorSource();
    const a = source.sample(battery("PB-A"), diagnosis("QUICK"), 5_000, 0.1, 0);
    const b = source.sample(battery("PB-A"), diagnosis("QUICK"), 5_000, 0.1, 0);
    expect(a).toEqual(b);
  });

  it("자산마다 특성이 다르다 — 전부 같은 등급이 나오면 진단이 무의미하다", () => {
    const source = createSimulatorSource();
    const highLoad = 2.0;
    const voltages = ["PB-A", "PB-B", "PB-C", "PB-D"].map(
      (id) => source.sample(battery(id), diagnosis("QUICK"), 100_000, highLoad, 0).voltageV
    );
    expect(new Set(voltages).size).toBeGreaterThan(1);
  });

  it("경부하에서는 출력전압이 5V 근처다", () => {
    const source = createSimulatorSource();
    const sample = source.sample(battery("PB-A"), diagnosis("QUICK"), 5_000, 0.1, 0);
    expect(sample.voltageV).toBeGreaterThan(4.9);
    expect(sample.voltageV).toBeLessThan(5.2);
  });

  it("방전 전류는 음수다 — 부호 규약을 지킨다", () => {
    const source = createSimulatorSource();
    expect(source.sample(battery("PB-A"), diagnosis("QUICK"), 5_000, 1.0, 0).currentA).toBeLessThan(0);
  });

  it("부하가 커지면 표면온도가 오른다 — P3 기울기가 잡혀야 한다", () => {
    const source = createSimulatorSource();
    const early = source.sample(battery("PB-A"), diagnosis("QUICK"), 50_000, 1.5, 0);
    const late = source.sample(battery("PB-A"), diagnosis("QUICK"), 90_000, 1.5, 0);
    expect(late.tempIrSurfaceC!).toBeGreaterThan(early.tempIrSurfaceC!);
  });

  it("용량을 다 뽑으면 전압이 무너진다 — 정상 컷오프 경로", () => {
    const source = createSimulatorSource();
    const drained = source.sample(battery("PB-A"), diagnosis("CAPACITY"), 3_600_000, 1.0, 999);
    expect(drained.voltageV).toBeLessThan(4.0);
  });

  it("모드 2에는 가스 센서가 없는 프로필이라 gasRaw는 null이다", () => {
    const source = createSimulatorSource();
    expect(source.sample(battery("PB-A"), diagnosis("QUICK"), 5_000, 0.1, 0).gasRaw).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `cd backend && npx vitest run src/diagnosis/simulator.test.ts`
Expected: FAIL — `Failed to resolve import "./simulator.js"`

- [ ] **Step 3: `ingest.ts`를 쓴다**

```ts
// 진단 계측 소스의 포트. 백엔드는 "샘플이 들어온다"만 알고 그게 어디서
// 오는지 모른다.
//
//   오늘  : simulator.ts 가 구현
//   나중  : Kafka consumer 가 같은 인터페이스를 구현
//
// 러너와 산식은 이 인터페이스만 보므로, 실물이 붙어도 metrics.ts·runner.ts는
// 바뀌지 않는다.

import type { DemoBattery, DemoDiagnosis } from "../store/types.js";

export type DiagnosisSample = {
  atMs: number;                     // 진단 시작 기준 경과 ms
  voltageV: number;
  currentA: number;                 // 부호 살림. 방전 = 음수
  tempIrSurfaceC: number | null;
  gasRaw: number | null;
  loadTargetA: number;              // 그 프레임에서 지시한 목표 전류
};

export interface DiagnosisSource {
  sample(
    battery: DemoBattery,
    diagnosis: DemoDiagnosis,
    elapsedMs: number,
    loadTargetA: number,
    deliveredWh: number
  ): DiagnosisSample;
}
```

- [ ] **Step 4: `simulator.ts`를 쓴다**

```ts
// 오늘의 계측 소스. Kafka consumer가 생기면 이 파일만 지운다.
//
// 데모 tick의 합성값을 그대로 쓰면 진단 결과가 부하와 무관해져 무의미하다.
// 그래서 부스트 컨버터 거동을 모사한다 — 자산 ID를 시드로 특성을 정하고,
// 목표 전류가 그 이탈점을 넘으면 출력전압을 처지게 하고, 부하 전력에
// 비례해 표면온도를 올린다.

import type { DemoBattery, DemoDiagnosis } from "../store/types.js";
import type { DiagnosisSample, DiagnosisSource } from "./ingest.js";

type PackTraits = {
  collapseCurrentA: number;
  vLightLoadV: number;
  thermalCoeffCPerWMin: number;
  capacityWhActual: number;
};

// 결정론적 해시. 같은 자산은 항상 같은 특성을 갖는다.
function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0) / 4294967295;
}

function traitsFor(battery: DemoBattery): PackTraits {
  const a = hash(battery.id);
  const b = hash(`${battery.id}:thermal`);
  const c = hash(`${battery.id}:capacity`);
  // 실제 보조배터리 IC의 출력 한계는 0.8A(HT4928S)~4.8A(IP5318)로 6배
  // 흩어진다(스펙 §9, 2026-08-08 웹 검증).
  return {
    collapseCurrentA: 0.8 + a * 1.6,          // 0.8 ~ 2.4A
    vLightLoadV: 5.02 + a * 0.1,              // 5.02 ~ 5.12V
    thermalCoeffCPerWMin: 0.25 + b * 0.75,
    capacityWhActual: (battery.capacityWh ?? 37) * (0.82 + c * 0.1),
  };
}

const AMBIENT_C = 28;
const LATCH_OFF_FACTOR = 1.35;

export function createSimulatorSource(): DiagnosisSource {
  return {
    sample(battery, diagnosis: DemoDiagnosis, elapsedMs, loadTargetA, deliveredWh): DiagnosisSample {
      const traits = traitsFor(battery);
      const load = Math.max(loadTargetA, 0);

      let voltageV: number;
      if (diagnosis.kind === "CAPACITY" && deliveredWh >= traits.capacityWhActual) {
        // 용량 소진 → 컨버터가 무너진다. 러너가 정상 컷오프로 처리한다.
        voltageV = traits.vLightLoadV * 0.6;
      } else if (load > traits.collapseCurrentA * LATCH_OFF_FACTOR) {
        // 래치오프 — IP5306류는 출력 <4.4V가 30ms 지속되면 통째로 차단한다.
        voltageV = 0.1;
      } else if (load > traits.collapseCurrentA) {
        const excess = (load - traits.collapseCurrentA) / traits.collapseCurrentA;
        voltageV = traits.vLightLoadV * (1 - 0.35 * excess);
      } else {
        voltageV = traits.vLightLoadV - load * 0.03;
      }

      const powerW = voltageV * load;
      const minutes = elapsedMs / 60_000;
      const tempIrSurfaceC = AMBIENT_C + traits.thermalCoeffCPerWMin * powerW * minutes;

      return {
        atMs: elapsedMs,
        voltageV: Number(voltageV.toFixed(3)),
        currentA: Number((-load).toFixed(3)),   // 방전 = 음수
        tempIrSurfaceC: Number(tempIrSurfaceC.toFixed(2)),
        // 모드 2 COMBINED_EXISTING_PARTS_V1 프로필에는 MQ-2가 없다.
        gasRaw: null,
        loadTargetA: load,
      };
    },
  };
}
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `cd backend && npx vitest run src/diagnosis/simulator.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: 커밋**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add backend/src/diagnosis/ingest.ts backend/src/diagnosis/simulator.ts backend/src/diagnosis/simulator.test.ts
git commit -m "feat(diagnosis): add the ingest port and a boost-converter simulator"
```

---

### Task 8: 러너 (`runner.ts`)

**Files:**
- Create: `backend/src/diagnosis/runner.ts`
- Test: `backend/src/diagnosis/runner.test.ts`

**Interfaces:**
- Consumes: `phases.ts`, `metrics.ts`, `safety.ts`, `ingest.ts`, `store/types.ts`
- Produces:
  - `type RunnerConfig = { thresholds: DiagnosisSafetyThresholds; s1CPerMin: number; assumedEfficiency: number; tickMs: number }`
  - `type RunnerOutcome` (아래 3-variant union)
  - `function stepDiagnosis(input: StepInput): RunnerOutcome`
  - `type AbortDeps = { setLoadA(a: number): Promise<void>; relayCut(reason: string): Promise<void> }`
  - `function applyAbort(deps: AbortDeps, reason: string): Promise<void>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`backend/src/diagnosis/runner.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { applyAbort, stepDiagnosis } from "./runner.js";
import type { RunnerConfig } from "./runner.js";
import { UNSET_DIAGNOSIS_THRESHOLDS } from "./safety.js";
import type { DemoBattery, DemoDiagnosis } from "../store/types.js";

const config: RunnerConfig = {
  thresholds: UNSET_DIAGNOSIS_THRESHOLDS,
  s1CPerMin: 0,
  assumedEfficiency: 0.88,
  tickMs: 1000,
};

const battery = (): DemoBattery => ({
  id: "PB-A", ownerId: "hong", label: "PB-A", model: "USB", maker: null, chemistry: "LI_PO",
  targetMode: 2, seriesCount: null, capacityWh: 37, ratedOutputCurrentA: 2,
  opsStatus: "NORMAL", version: 0, adminMemo: "", memo: "",
  latest: { voltageV: 5, currentA: -1, powerW: -5, tempContact: null, tempIrSurface: 30, socPct: 90, score: 0.1, measuredAt: "2026-09-01T00:00:00.000Z" },
} as DemoBattery);

const running = (kind: "QUICK" | "CAPACITY", phase: string): DemoDiagnosis => ({
  id: "dg_1", batteryId: "PB-A", sessionId: "s1", kind, status: "RUNNING", phase,
  input: kind === "CAPACITY" ? { dischargeCurrentA: 1 } : {},
  result: null, startedAt: "2026-09-01T00:00:00.000Z", estimatedEndAt: null,
  progress: { loadTargetA: null, loadActualA: null, partialMetrics: null, windows: [], deliveredWh: 0, vLightLoadV: null },
});

describe("stepDiagnosis", () => {
  it("경과시간에 맞는 단계를 낸다", () => {
    const outcome = stepDiagnosis({ battery: battery(), diagnosis: running("QUICK", "P0"), elapsedMs: 30_000, config });
    expect(outcome.kind).toBe("RUNNING");
    if (outcome.kind === "RUNNING") expect(outcome.phase).toBe("P2");
  });

  it("단계가 바뀐 tick에만 phaseChanged가 true다 — WS는 전환 시에만 나간다", () => {
    const changed = stepDiagnosis({ battery: battery(), diagnosis: running("QUICK", "P1"), elapsedMs: 30_000, config });
    const same = stepDiagnosis({ battery: battery(), diagnosis: running("QUICK", "P2"), elapsedMs: 30_000, config });
    expect(changed.kind === "RUNNING" && changed.phaseChanged).toBe(true);
    expect(same.kind === "RUNNING" && same.phaseChanged).toBe(false);
  });

  it("빠른 진단은 120초에 완료된다", () => {
    const outcome = stepDiagnosis({ battery: battery(), diagnosis: running("QUICK", "P5"), elapsedMs: 120_000, config });
    expect(outcome.kind).toBe("COMPLETED");
  });

  it("완료 결과에 quick 블록과 dataSource가 실린다", () => {
    const outcome = stepDiagnosis({ battery: battery(), diagnosis: running("QUICK", "P5"), elapsedMs: 120_000, config });
    if (outcome.kind !== "COMPLETED") throw new Error("expected COMPLETED");
    expect(outcome.result.dataSource).toBe("SIMULATED");
    expect(outcome.result.quick).toBeTruthy();
    expect(outcome.result.capacity).toBeNull();
  });

  it("안전 문턱이 걸리면 ABORTED와 사유를 낸다", () => {
    const hot: RunnerConfig = { ...config, thresholds: { surfaceCutoffC: 1, tempSlopeCPerMin: 0, gasRaw: 0 } };
    const outcome = stepDiagnosis({ battery: battery(), diagnosis: running("QUICK", "P3"), elapsedMs: 60_000, config: hot });
    expect(outcome.kind).toBe("ABORTED");
    if (outcome.kind === "ABORTED") expect(outcome.reason).toBe("TEMP_ABSOLUTE");
  });

  it("CAPACITY는 용량을 다 뽑으면 COMPLETED다 — 중단이 아니다", () => {
    const diagnosis = running("CAPACITY", "CAPACITY");
    diagnosis.progress!.deliveredWh = 999;
    diagnosis.progress!.vLightLoadV = 5.05;
    const outcome = stepDiagnosis({ battery: battery(), diagnosis, elapsedMs: 3_600_000, config });
    expect(outcome.kind).toBe("COMPLETED");
  });

  it("CAPACITY 진행 중에는 deliveredWh가 누적된다", () => {
    const outcome = stepDiagnosis({ battery: battery(), diagnosis: running("CAPACITY", "CAPACITY"), elapsedMs: 1000, config });
    if (outcome.kind !== "RUNNING") throw new Error("expected RUNNING");
    expect(outcome.progress.deliveredWh).toBeGreaterThan(0);
  });
});

describe("applyAbort", () => {
  it("⚠️ 부하를 0A로 내린 다음 릴레이를 차단한다 — 순서가 뒤바뀌면 아크가 생긴다", async () => {
    const calls: string[] = [];
    await applyAbort({
      setLoadA: async (a) => { calls.push(`setLoad:${a}`); },
      relayCut: async (reason) => { calls.push(`relayCut:${reason}`); },
    }, "TEMP_ABSOLUTE");
    expect(calls).toEqual(["setLoad:0", "relayCut:TEMP_ABSOLUTE"]);
  });

  it("부하 내리기가 실패해도 릴레이는 차단한다 — 안전이 우선이다", async () => {
    const relayCut = vi.fn(async () => {});
    await applyAbort({
      setLoadA: async () => { throw new Error("load controller offline"); },
      relayCut,
    }, "GAS");
    expect(relayCut).toHaveBeenCalledWith("GAS");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `cd backend && npx vitest run src/diagnosis/runner.test.ts`
Expected: FAIL — `Failed to resolve import "./runner.js"`

- [ ] **Step 3: 최소 구현을 쓴다**

`backend/src/diagnosis/runner.ts`:

```ts
// 진단 진행 판정. 순수 함수라 저장소도 WS도 모른다 — 호출부(server.ts)가
// 결과를 보고 스토어를 갱신하고 broadcast한다. failsafe.ts / failsafeRunner.ts
// 의 분리와 같은 구조다.

import type { DemoBattery, DemoDiagnosis, DiagnosisProgress } from "../store/types.js";
import { CAPACITY_PHASE, isInAggregationWindow, phaseAt, quickPhases } from "./phases.js";
import type { PhaseSpec } from "./phases.js";
import {
  accumulateWh, baselineWhFrom, capacityResult, COLLAPSE_RATIO, LATCH_OFF_VOLTAGE_V,
  median, quickGrade, regulationKnee, specAttainmentPct, thermalSlopeCPerMin, vLightLoadV,
} from "./metrics.js";
import type { PhaseWindow } from "./metrics.js";
import { judgeDiagnosisAbort } from "./safety.js";
import type { DiagnosisAbortReason, DiagnosisSafetyThresholds } from "./safety.js";
import { createSimulatorSource } from "./simulator.js";
import type { DiagnosisSource } from "./ingest.js";

export type RunnerConfig = {
  thresholds: DiagnosisSafetyThresholds;
  s1CPerMin: number;
  assumedEfficiency: number;
  tickMs: number;
};

export type StepInput = {
  battery: DemoBattery;
  diagnosis: DemoDiagnosis;
  elapsedMs: number;
  config: RunnerConfig;
  source?: DiagnosisSource;
  previousCapacity?: { deliveredWh: number | null; partial: boolean }[];
};

export type RunnerOutcome =
  | { kind: "RUNNING"; phase: string; phaseChanged: boolean; progress: DiagnosisProgress }
  | { kind: "ABORTED"; reason: DiagnosisAbortReason }
  | { kind: "COMPLETED"; result: Record<string, unknown> };

const defaultSource = createSimulatorSource();

function capacityLoadA(diagnosis: DemoDiagnosis): number {
  const value = diagnosis.input.dischargeCurrentA;
  return typeof value === "number" && value > 0 ? value : 1.0;
}

// 진행 중 창을 갱신한다. 후반 절반 구간의 샘플만 쌓는다.
function upsertWindow(windows: PhaseWindow[], spec: PhaseSpec, sample: { voltageV: number; currentA: number; atMs: number; tempIrSurfaceC: number | null }): PhaseWindow[] {
  const next = [...windows];
  let window = next.find((w) => w.phase === spec.phase);
  if (!window) {
    window = {
      phase: spec.phase,
      loadTargetA: spec.loadTargetA,
      voltageMedianV: sample.voltageV,
      currentMedianA: sample.currentA,
      tempSamples: [],
      latchOff: false,
    };
    next.push(window);
  }
  // 중앙값을 유지하려면 원자료가 필요하므로 온도 외 값은 누적 평균 대신
  // 관측한 전압을 모아 중앙값을 다시 낸다.
  const voltages = [...(window.tempSamples.length === 0 ? [] : []), window.voltageMedianV, sample.voltageV];
  window.voltageMedianV = median(voltages) ?? sample.voltageV;
  window.currentMedianA = sample.currentA;
  window.latchOff = window.latchOff || sample.voltageV < LATCH_OFF_VOLTAGE_V;
  if (sample.tempIrSurfaceC !== null) {
    window.tempSamples = [...window.tempSamples, { atMs: sample.atMs, tempIrSurfaceC: sample.tempIrSurfaceC }];
  }
  return next;
}

export function stepDiagnosis(input: StepInput): RunnerOutcome {
  const { battery, diagnosis, elapsedMs, config } = input;
  const source = input.source ?? defaultSource;
  const progress = diagnosis.progress ?? { loadTargetA: null, loadActualA: null, partialMetrics: null, windows: [], deliveredWh: 0, vLightLoadV: null };

  const isQuick = diagnosis.kind === "QUICK";
  const specs = isQuick ? quickPhases(battery.ratedOutputCurrentA) : [];
  const spec: PhaseSpec | null = isQuick
    ? phaseAt(specs, elapsedMs)
    : { phase: CAPACITY_PHASE, durationMs: Number.MAX_SAFE_INTEGER, loadTargetA: capacityLoadA(diagnosis) };

  // 빠른 진단은 총 시간이 지나면 종료다.
  if (isQuick && spec === null) {
    return { kind: "COMPLETED", result: buildQuickResult(progress, battery, config) };
  }

  const sample = source.sample(battery, diagnosis, elapsedMs, spec!.loadTargetA, progress.deliveredWh);
  const knownVLight = progress.vLightLoadV ?? vLightLoadV(progress.windows);

  const slope = thermalSlopeCPerMin(progress.windows);
  const abortReason = judgeDiagnosisAbort(
    diagnosis.kind,
    { voltageV: sample.voltageV, tempIrSurfaceC: sample.tempIrSurfaceC, gasRaw: sample.gasRaw, tempSlopeCPerMin: slope },
    knownVLight,
    config.thresholds
  );
  if (abortReason) return { kind: "ABORTED", reason: abortReason };

  if (!isQuick) {
    const deliveredWh = accumulateWh(progress.deliveredWh, sample.voltageV, sample.currentA, config.tickMs);
    const vLight = knownVLight ?? sample.voltageV;
    // ⚠️ CAPACITY에서 전압 붕괴는 중단이 아니라 정상 컷오프다(스펙 §4-1 ⑤).
    if (sample.voltageV < vLight * COLLAPSE_RATIO) {
      return {
        kind: "COMPLETED",
        result: buildCapacityResult(deliveredWh, battery, diagnosis, config, input.previousCapacity ?? [], false),
      };
    }
    return {
      kind: "RUNNING",
      phase: CAPACITY_PHASE,
      phaseChanged: diagnosis.phase !== CAPACITY_PHASE,
      progress: {
        loadTargetA: spec!.loadTargetA,
        loadActualA: Math.abs(sample.currentA),
        partialMetrics: { deliveredWh, specAttainmentPct: null },
        windows: progress.windows,
        deliveredWh,
        vLightLoadV: vLight,
      },
    };
  }

  const windows = isInAggregationWindow(specs, elapsedMs)
    ? upsertWindow(progress.windows, spec!, sample)
    : progress.windows;
  const vLight = vLightLoadV(windows);
  const knee = regulationKnee(windows);

  return {
    kind: "RUNNING",
    phase: spec!.phase,
    phaseChanged: diagnosis.phase !== spec!.phase,
    progress: {
      loadTargetA: spec!.loadTargetA,
      loadActualA: Math.abs(sample.currentA),
      partialMetrics: {
        vLightLoadV: vLight,
        regulationKneeA: knee.kneeIsUpperBound ? null : knee.regulationKneeA,
        kneeIsUpperBound: knee.kneeIsUpperBound ? null : false,
        thermalSlopeCPerMin: thermalSlopeCPerMin(windows),
        specAttainmentPct: specAttainmentPct(windows, battery.ratedOutputCurrentA),
      },
      windows,
      deliveredWh: progress.deliveredWh,
      vLightLoadV: vLight,
    },
  };
}

function buildQuickResult(progress: DiagnosisProgress, battery: DemoBattery, config: RunnerConfig): Record<string, unknown> {
  const windows = progress.windows;
  const knee = regulationKnee(windows);
  const slope = thermalSlopeCPerMin(windows);
  const attainment = specAttainmentPct(windows, battery.ratedOutputCurrentA);
  const { grade, gradeProvisional } = quickGrade({
    regulationKneeA: knee.regulationKneeA,
    ratedOutputCurrentA: battery.ratedOutputCurrentA,
    thermalSlopeCPerMin: slope,
    s1CPerMin: config.s1CPerMin,
    specAttainmentPct: attainment,
  });
  return {
    dataSource: "SIMULATED",
    quick: {
      vLightLoadV: vLightLoadV(windows),
      regulationKneeA: knee.regulationKneeA,
      kneeIsUpperBound: knee.kneeIsUpperBound,
      latchOff: knee.latchOff,
      thermalSlopeCPerMin: slope,
      specAttainmentPct: attainment,
      ratedOutputCurrentA: battery.ratedOutputCurrentA,
      grade,
      gradeProvisional,
    },
    capacity: null,
  };
}

function buildCapacityResult(
  deliveredWh: number,
  battery: DemoBattery,
  diagnosis: DemoDiagnosis,
  config: RunnerConfig,
  previous: { deliveredWh: number | null; partial: boolean }[],
  partial: boolean
): Record<string, unknown> {
  return {
    dataSource: "SIMULATED",
    quick: null,
    capacity: capacityResult({
      deliveredWh,
      ratedWh: battery.capacityWh,
      baselineWh: baselineWhFrom(previous),
      assumedEfficiency: config.assumedEfficiency,
      dischargeCurrentA: capacityLoadA(diagnosis),
      partial,
    }),
  };
}

export type AbortDeps = {
  setLoadA(amps: number): Promise<void>;
  relayCut(reason: string): Promise<void>;
};

// ⚠️ 부하를 먼저 0A로 내린 다음 릴레이를 차단한다. 순서가 뒤바뀌면
// 인덕티브 킥과 아크가 생긴다(스펙 §3-3). 부하 내리기가 실패해도
// 차단은 반드시 수행한다 — 안전이 우선이다.
export async function applyAbort(deps: AbortDeps, reason: string): Promise<void> {
  try {
    await deps.setLoadA(0);
  } catch {
    // 부하 제어 실패를 이유로 차단을 건너뛰지 않는다.
  }
  await deps.relayCut(reason);
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `cd backend && npx vitest run src/diagnosis/runner.test.ts`
Expected: PASS (9 tests)

`upsertWindow`의 전압 중앙값 누적이 테스트에서 어긋나면, `PhaseWindow`에
`voltageSamples: number[]`를 추가해 원자료를 모으고 `voltageMedianV`를
`median(voltageSamples)`로 계산하도록 바꾼다. 그때 `metrics.test.ts`의
`win()` 헬퍼에도 기본값 `voltageSamples: []`를 추가한다.

- [ ] **Step 5: 커밋**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add backend/src/diagnosis/runner.ts backend/src/diagnosis/runner.test.ts
git commit -m "feat(diagnosis): advance phases, judge aborts, and build results"
```

---

## Group D — 서버 배선 (Task 9-11)

---

### Task 9: capability 해제와 에러코드

**Files:**
- Modify: `backend/src/server.ts:170` (capability), `:274-299` (errorFromDomain), `:858-870` (diagnosisStart)
- Modify: `frontend/src/types.ts` (ErrorCode)

**Interfaces:**
- Consumes: Task 6의 스토어
- Produces: `executionAllowed: true` 응답, `409 CAPACITY_NOT_REGISTERED` / `409 RELAY_CUT` / `409 DEVICE_OFFLINE`

- [ ] **Step 1: `errorFromDomain`의 매핑에 3줄을 추가한다**

`backend/src/server.ts`의 `mapping` 객체, `CAPACITY_REQUIRED` 줄 아래:

```ts
    CAPACITY_NOT_REGISTERED: [409, "CAPACITY_NOT_REGISTERED"],
    RELAY_CUT: [409, "RELAY_CUT"],
    DEVICE_OFFLINE: [409, "DEVICE_OFFLINE"],
```

`DEVICE_OFFLINE`은 프론트 `ErrorCode`에만 있고 백엔드 맵에 없어 지금 500으로 샌다.

- [ ] **Step 2: `batteryJson`의 capability를 실제 판정으로 바꾼다**

`backend/src/server.ts:170` 부근의 `diagnosisCapability` 블록을 교체:

```ts
    // 2026-09-01 결정: 모드 2면 실행을 허용한다. 안전 프로필 게이트
    // (MODE2_FULL 한정)는 제거됐고, 결과에 dataSource가 실려 시뮬레이션
    // 시기 데이터를 이력에서 구분한다. 계약서 §4.13도 함께 갱신했다.
    diagnosisCapability: battery.targetMode !== 2
      ? { executionAllowed: false, reasonCode: "MODE_NOT_SUPPORTED" }
      : relay.state === "OPEN"
        ? { executionAllowed: false, reasonCode: "RELAY_CUT" }
        : { executionAllowed: true, reasonCode: null }
```

`batteryJson` 안에서 릴레이를 아직 안 읽고 있으면 함수 앞부분에
`const relay = await relayByBattery(battery.id);` 를 추가한다.

- [ ] **Step 3: `diagnosisStart`에 릴레이 재검증을 넣는다**

`backend/src/server.ts`의 `diagnosisStart`, `body.acknowledged` 검사 아래에 추가:

```ts
  const relay = await relayByBattery(batteryId);
  if (relay.state === "OPEN") { apiError(res, 409, "RELAY_CUT", "The relay is cut, so there is no load path."); return; }
```

`CAPACITY_NOT_REGISTERED`는 Task 6에서 스토어가 던지므로 `errorFromDomain`이 처리한다.

- [ ] **Step 4: 프론트 `ErrorCode`에 2종을 추가한다**

`frontend/src/types.ts`의 `ErrorCode` union, `"RUNTIME_NOT_READY"` 앞에:

```ts
  | "CAPACITY_NOT_REGISTERED" | "RELAY_CUT"
```

- [ ] **Step 5: 확인한다**

Run: `cd backend && npm run typecheck && npm test`
Run: `cd frontend && npm run typecheck`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add backend/src/server.ts frontend/src/types.ts
git commit -m "feat(api): unlock mode 2 diagnosis and map the three missing error codes"
```

---

### Task 10: 결과 직렬화와 이력 요약

**Files:**
- Modify: `backend/src/server.ts:241-264` (`diagnosisJson`), `:895-906` (이력 `summary`)

**Interfaces:**
- Consumes: Task 8의 결과 구조 (`result.quick` / `result.capacity` / `result.dataSource`)
- Produces: 계약서 §4.13 형태의 `Diagnosis` JSON

- [ ] **Step 1: `diagnosisJson`을 고친다**

```ts
async function diagnosisJson(diagnosis: NonNullable<Awaited<ReturnType<typeof diagnosisById>>>) {
  const battery = await batteryById(diagnosis.batteryId);
  const result = diagnosis.result ?? {};
  const progress = diagnosis.progress;
  return {
    id: diagnosis.id,
    batteryId: diagnosis.batteryId,
    batteryLabel: battery?.label,
    sessionId: diagnosis.sessionId,
    kind: diagnosis.kind,
    status: diagnosis.status,
    phase: diagnosis.phase,
    confidence: diagnosis.kind === "QUICK" ? "LOW" : diagnosis.status === "COMPLETED" ? "HIGH" : undefined,
    startedAt: diagnosis.startedAt,
    estimatedEndAt: diagnosis.estimatedEndAt,
    measuredAt: diagnosis.status === "COMPLETED" ? diagnosis.estimatedEndAt : undefined,
    loadTargetA: progress?.loadTargetA ?? null,
    loadActualA: progress?.loadActualA ?? null,
    socHintLevel: typeof diagnosis.input.socHintLevel === "number" ? diagnosis.input.socHintLevel : null,
    abortReason: typeof result.abortReason === "string" ? result.abortReason : null,
    partialMetrics: progress?.partialMetrics ?? null,
    // 시뮬레이션 시기 데이터를 이력에서 구분하기 위한 출처 표시.
    dataSource: typeof result.dataSource === "string" ? result.dataSource : null,
    result: diagnosis.result,
    quick: (result.quick as Record<string, unknown> | null | undefined) ?? null,
    capacity: (result.capacity as Record<string, unknown> | null | undefined) ?? null,
  };
}
```

- [ ] **Step 2: 이력 `summary`를 실제값으로 바꾼다**

`app.get("/api/batteries/:id/diagnoses", …)` 안의 `summary` 줄을 교체:

```ts
    summary: diagnosis.kind === "QUICK"
      ? {
          regulationKneeA: (diagnosis.quick?.regulationKneeA as number | null) ?? null,
          thermalSlopeCPerMin: (diagnosis.quick?.thermalSlopeCPerMin as number | null) ?? null,
          grade: (diagnosis.quick?.grade as string | null) ?? null,
        }
      : {
          sohRelPct: (diagnosis.capacity?.sohRelPct as number | null) ?? null,
          deliveredWh: (diagnosis.capacity?.deliveredWh as number | null) ?? null,
        }
```

- [ ] **Step 3: 확인한다**

Run: `cd backend && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add backend/src/server.ts
git commit -m "feat(api): serialize real diagnosis results and history summaries"
```

- [ ] **Step 5: `diagnosisJson`을 `diagnosis/routes.ts`로 옮긴다**

`server.ts`가 1200줄이 넘어 그대로 두면 더 커진다(스펙 §13).
**함수 하나만** 옮긴다 — 라우트 등록은 `server.ts`에 남긴다. 그래야 이동 범위가 작다.

`backend/src/diagnosis/routes.ts`를 만들고 Step 1의 `diagnosisJson` 본문을 그대로 옮기되,
스토어 접근을 주입받게 바꾼다 (`server.ts`의 모듈 스코프에 의존하지 않게):

```ts
// 진단 응답 직렬화. 계약서 §4.13의 Diagnosis 객체 형태를 만든다.
// server.ts가 1200줄을 넘어 이 헬퍼만 분리했다 — 라우트 등록은 server.ts에 남는다.

import type { DemoBattery, DemoDiagnosis } from "../store/types.js";

export function diagnosisJson(diagnosis: DemoDiagnosis, battery: DemoBattery | undefined) {
  const result = diagnosis.result ?? {};
  const progress = diagnosis.progress;
  return {
    id: diagnosis.id,
    batteryId: diagnosis.batteryId,
    batteryLabel: battery?.label,
    sessionId: diagnosis.sessionId,
    kind: diagnosis.kind,
    status: diagnosis.status,
    phase: diagnosis.phase,
    confidence: diagnosis.kind === "QUICK" ? "LOW" : diagnosis.status === "COMPLETED" ? "HIGH" : undefined,
    startedAt: diagnosis.startedAt,
    estimatedEndAt: diagnosis.estimatedEndAt,
    measuredAt: diagnosis.status === "COMPLETED" ? diagnosis.estimatedEndAt : undefined,
    loadTargetA: progress?.loadTargetA ?? null,
    loadActualA: progress?.loadActualA ?? null,
    socHintLevel: typeof diagnosis.input.socHintLevel === "number" ? diagnosis.input.socHintLevel : null,
    abortReason: typeof result.abortReason === "string" ? result.abortReason : null,
    partialMetrics: progress?.partialMetrics ?? null,
    dataSource: typeof result.dataSource === "string" ? result.dataSource : null,
    result: diagnosis.result,
    quick: (result.quick as Record<string, unknown> | null | undefined) ?? null,
    capacity: (result.capacity as Record<string, unknown> | null | undefined) ?? null,
  };
}
```

`server.ts`에서는 이름 충돌을 피해 얇은 래퍼만 남긴다:

```ts
import { diagnosisJson as buildDiagnosisJson } from "./diagnosis/routes.js";

async function diagnosisJson(diagnosis: NonNullable<Awaited<ReturnType<typeof diagnosisById>>>) {
  return buildDiagnosisJson(diagnosis, await batteryById(diagnosis.batteryId));
}
```

호출부는 전부 그대로 동작한다 (`await diagnosisJson(...)`).

- [ ] **Step 6: 확인하고 커밋한다**

Run: `cd backend && npm run typecheck && npm test`
Expected: PASS

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add backend/src/diagnosis/routes.ts backend/src/server.ts
git commit -m "refactor(api): extract the diagnosis serializer out of server.ts"
```

---

### Task 11: 러너 tick, WS 발행, 세션 종료 정리

**Files:**
- Modify: `backend/src/server.ts` (tick 부근 `:1179-1213`, 세션 종료 `:532`·`:807`, 릴레이 차단 `:583`)

**Interfaces:**
- Consumes: Task 8의 `stepDiagnosis`/`applyAbort`, Task 6의 스토어 메서드, Task 5의 설정
- Produces: WS `diagnosis.progress` / `diagnosis.done` / `diagnosis.aborted`

- [ ] **Step 1: import를 추가한다**

`backend/src/server.ts` 상단:

```ts
import { applyAbort, stepDiagnosis } from "./diagnosis/runner.js";
import { diagnosisAssumedEfficiency, diagnosisS1CPerMin, diagnosisSafetyThresholds } from "./config/env.js";
import { advanceDiagnosis, completeDiagnosis, abortDiagnosisBySystem } from "./store.js";
```

(기존 `./store.js` import 블록에 세 이름을 합쳐도 된다.)

- [ ] **Step 2: 진단 tick 함수를 추가한다**

`tickActiveBattery` 함수 아래, `setInterval` 위에 추가:

```ts
const DIAGNOSIS_TICK_MS = 1000;

async function tickActiveDiagnosis(): Promise<void> {
  const session = await activeSession();
  if (!session) return;
  const diagnosis = await activeDiagnosis(session.batteryId);
  if (!diagnosis) return;
  const battery = await batteryById(diagnosis.batteryId);
  if (!battery) return;

  const elapsedMs = Date.now() - new Date(diagnosis.startedAt).getTime();
  const previous = (await diagnosesForBattery(battery.id))
    .filter((item) => item.kind === "CAPACITY" && item.status === "COMPLETED")
    .map((item) => {
      const capacity = (item.result?.capacity ?? {}) as { deliveredWh?: number | null; partial?: boolean };
      return { deliveredWh: capacity.deliveredWh ?? null, partial: capacity.partial === true };
    });

  const outcome = stepDiagnosis({
    battery,
    diagnosis,
    elapsedMs,
    previousCapacity: previous,
    config: {
      thresholds: diagnosisSafetyThresholds,
      s1CPerMin: diagnosisS1CPerMin,
      assumedEfficiency: diagnosisAssumedEfficiency,
      tickMs: DIAGNOSIS_TICK_MS,
    },
  });

  if (outcome.kind === "RUNNING") {
    const updated = await advanceDiagnosis(diagnosis.id, outcome.phase, outcome.progress);
    // 계약 §5.3: 매 tick이 아니라 단계 전환 시에만 보낸다.
    if (outcome.phaseChanged) {
      await broadcast("diagnosis.progress", {
        id: updated.id,
        kind: updated.kind,
        phase: updated.phase,
        loadTargetA: outcome.progress.loadTargetA,
        loadActualA: outcome.progress.loadActualA,
        estimatedEndAt: updated.estimatedEndAt,
        partialMetrics: outcome.progress.partialMetrics,
      }, null, battery.id);
    }
    return;
  }

  if (outcome.kind === "COMPLETED") {
    const done = await completeDiagnosis(diagnosis.id, outcome.result);
    await broadcast("diagnosis.done", await diagnosisJson(done), null, battery.id);
    return;
  }

  // ⚠️ 부하를 0A로 내린 다음 릴레이를 차단한다. 순서가 뒤바뀌면 아크가 생긴다.
  await applyAbort({
    setLoadA: async () => { /* 부하 제어는 에지가 붙을 때 연결한다 */ },
    relayCut: async (reason) => { await engageFailsafe(battery.id, reason, "DIAGNOSIS_ABORT"); },
  }, outcome.reason);
  const aborted = await abortDiagnosisBySystem(battery.id, outcome.reason);
  if (aborted) {
    await broadcast("diagnosis.aborted", { id: aborted.id, kind: aborted.kind, abortReason: outcome.reason }, null, battery.id);
  }
}
```

- [ ] **Step 3: 기존 `setInterval`에 진단 tick을 붙인다**

```ts
setInterval(() => {
  void tickActiveBattery().catch((error) => { console.error("tickActiveBattery failed", error); });
  void tickActiveDiagnosis().catch((error) => { console.error("tickActiveDiagnosis failed", error); });
}, 1000);
```

- [ ] **Step 4: 세션 종료·릴레이 차단 시 진단을 닫는다**

세 지점 각각에서, 기존 `broadcast("session.ended", …)` 또는 `broadcast("relay.changed", …)` **바로 앞**에
아래 헬퍼 호출을 넣는다. 헬퍼는 `tickActiveDiagnosis` 아래에 정의한다:

```ts
// 계약 §4.13: 세션이 끝나면 진행 중 진단을 ABORTED로 닫는다.
// 안 닫으면 영원히 RUNNING으로 남는다.
async function closeDiagnosisFor(batteryId: string, reason: "SESSION_ENDED" | "RELAY_CUT"): Promise<void> {
  const aborted = await abortDiagnosisBySystem(batteryId, reason);
  if (!aborted) return;
  await broadcast("diagnosis.aborted", { id: aborted.id, kind: aborted.kind, abortReason: reason }, null, batteryId);
}
```

- `server.ts:532` (`SUPERSEDED`) — `broadcast("session.ended", …)` 앞에
  `await closeDiagnosisFor(priorSession.batteryId, "SESSION_ENDED");`
- `server.ts:807` (`BLOCKED`) — `broadcast("session.ended", …)` 앞에
  `await closeDiagnosisFor(req.params.id, "SESSION_ENDED");`
- `server.ts:583` (릴레이 변경) — 이 핸들러에는 `action` 변수가 이미 있고
  `if (action === "cut") await devicePort.relayCut(…)` 줄이 있다. 그 줄 **바로 아래**에
  `if (action === "cut") await closeDiagnosisFor(battery.id, "RELAY_CUT");` 를 넣는다.
  (`broadcast("relay.changed", …)` 보다 앞이다.)

- [ ] **Step 5: 확인한다**

Run: `cd backend && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add backend/src/server.ts
git commit -m "feat(api): drive diagnoses from the tick and broadcast diagnosis events"
```

---

## Group E — 프론트, 문서, 검증 (Task 12-14)

---

### Task 12: 프론트 진행률·라벨·목 정합

**Files:**
- Create: `frontend/src/api/diagnosisLabels.ts`
- Test: `frontend/src/test/diagnosis-labels.test.ts`
- Modify: `frontend/src/pages/UserPages.tsx`
- Modify: `frontend/src/mocks/handlers.ts`

**Interfaces:**
- Consumes: Task 10의 응답 필드
- Produces: `gradeLabel`, `abortReasonLabel`, `statusLabel`, `progressPct`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`frontend/src/test/diagnosis-labels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { abortReasonLabel, gradeLabel, progressPct, statusLabel } from "../api/diagnosisLabels";

describe("gradeLabel", () => {
  it("서버 code를 한국어 문구로 옮긴다 — 서버는 문구를 만들지 않는다", () => {
    expect(gradeLabel("HEALTHY")).toBe("양호");
    expect(gradeLabel("SUSPECT_DEGRADED")).toBe("열화 의심");
    expect(gradeLabel("BASELINE_PENDING")).toBe("기준 없음");
  });

  it("모르는 code는 그대로 보여준다 — 빈칸보다 낫다", () => {
    expect(gradeLabel("NEW_CODE")).toBe("NEW_CODE");
  });

  it("null이면 대시", () => expect(gradeLabel(null)).toBe("—"));
});

describe("abortReasonLabel", () => {
  it("중단 사유 8종을 옮긴다", () => {
    expect(abortReasonLabel("USER")).toBe("사용자 중단");
    expect(abortReasonLabel("TEMP_SLOPE")).toBe("온도 상승률 초과");
    expect(abortReasonLabel("VOLTAGE_COLLAPSE")).toBe("출력전압 붕괴");
  });
});

describe("statusLabel", () => {
  it("진행 상태를 옮긴다", () => {
    expect(statusLabel("RUNNING")).toBe("진행 중");
    expect(statusLabel("COMPLETED")).toBe("완료");
    expect(statusLabel("ABORTED")).toBe("중단됨");
  });
});

describe("progressPct", () => {
  it("시작·예상종료 사이의 경과 비율이다", () => {
    const started = "2026-09-01T00:00:00.000Z";
    const ends = "2026-09-01T00:02:00.000Z";
    expect(progressPct(started, ends, new Date("2026-09-01T00:01:00.000Z").getTime())).toBe(50);
  });

  it("0~100으로 자른다", () => {
    const started = "2026-09-01T00:00:00.000Z";
    const ends = "2026-09-01T00:02:00.000Z";
    expect(progressPct(started, ends, new Date("2026-09-01T00:10:00.000Z").getTime())).toBe(100);
  });

  it("예상 종료를 모르면 null — 32%를 하드코딩하지 않는다", () => {
    expect(progressPct("2026-09-01T00:00:00.000Z", null, Date.now())).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `cd frontend && npx vitest run src/test/diagnosis-labels.test.ts`
Expected: FAIL — `Failed to resolve import "../api/diagnosisLabels"`

- [ ] **Step 3: `frontend/src/api/diagnosisLabels.ts`를 쓴다**

```ts
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
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `cd frontend && npx vitest run src/test/diagnosis-labels.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: `UserPages.tsx`에서 라벨과 진행률을 쓴다**

5-a. import 추가:

```ts
import { abortReasonLabel, gradeLabel, progressPct, statusLabel } from "../api/diagnosisLabels";
```

5-b. 진행률 바 (`<div className="progress-track"><span style={{ width: "32%" }} /></div>`)를 교체:

```tsx
<div className="progress-track"><span style={{ width: `${progressPct(active.data.startedAt, active.data.estimatedEndAt) ?? 0}%` }} /></div>
```

5-c. 이력 행의 `{item.status}` → `{statusLabel(item.status)}`

5-d. 상세 모달의 `<span>상태<strong>{detail.data.status}</strong></span>` → `{statusLabel(detail.data.status)}`

5-e. 상세 모달 QUICK 블록의 `<span>{detail.data.quick?.grade ?? "—"}</span>` → `<span>{gradeLabel(detail.data.quick?.grade as string | null)}</span>`

5-f. 상세 모달 상단 `detail.data ? \`${detail.data.status} · …\`` 의 `status`도 `statusLabel(...)`로 바꾸고,
`abortReason`이 있으면 함께 보이도록 한다:

```tsx
description={detail.data ? `${statusLabel(detail.data.status)}${detail.data.abortReason ? ` · ${abortReasonLabel(detail.data.abortReason)}` : ""} · ${formatDateTime(detail.data.measuredAt ?? detail.data.startedAt)}` : ""}
```

- [ ] **Step 6: MSW 목을 서버 동작에 맞춘다**

`frontend/src/mocks/handlers.ts`:

- `b_pack_002`의 `diagnosisCapability`를 `{ executionAllowed: true, reasonCode: null }`로 바꾼다
  (서버가 모드 2 전부를 허용하므로 목만 잠겨 있으면 §1-3의 혼선이 재발한다).
- `b_pack_001`·`b_pack_003`(모드 1)은 `MODE_NOT_SUPPORTED` 그대로 둔다.
- 진단 시작 핸들러의 `if (battery.diagnosisCapability?.executionAllowed !== true) return bad(409, "SAFETY_PROFILE_NOT_READY");` 는
  그대로 두되, 위 변경으로 모드 2에서는 통과하게 된다.

- [ ] **Step 7: 확인한다**

Run: `cd frontend && npm test && npm run typecheck`
Expected: PASS — 기존 `msw-diagnosis.test.ts`·`diagnosis-contract.test.ts`가
`executionAllowed`를 단언하고 있으면 새 값에 맞춰 고친다.

- [ ] **Step 8: 커밋**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add frontend/src/api/diagnosisLabels.ts frontend/src/test/diagnosis-labels.test.ts frontend/src/pages/UserPages.tsx frontend/src/mocks/handlers.ts
git commit -m "feat(web): show real diagnosis progress and localize result codes"
```

---

### Task 13: 정본 문서 갱신

**Files:**
- Modify: `docs/backend_contract.md` (§4.13)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: Task 9의 실제 동작
- Produces: 코드와 일치하는 정본 문서

- [ ] **Step 1: `docs/backend_contract.md` §4.13의 잠금 규칙을 갱신한다**

`### 4.13 보조배터리 진단 (F21)` 아래의 하드웨어 프로필 문단과 문턱 sentinel 문단을 교체:

```markdown
**2026-09-01 갱신 — 실행 잠금을 모드 2 전체로 열었다.** `targetMode`가 2이면
하드웨어 프로필과 문턱 설정에 관계없이 진단을 시작할 수 있다. 이전의
*"`MODE2_FULL`만 실행 가능, `COMBINED_EXISTING_PARTS_V1`은 409"* 규칙과
*"문턱값 하나라도 0이면 `configured=false`이며 409"* 규칙은 **폐기됐다.**

대신 결과에 출처를 싣는다. `dataSource`가 `SIMULATED`면 계측값이 백엔드
시뮬레이터에서 나온 것이고, 실물 에지가 붙으면 `MEASURED`가 된다. 안전 문턱은
`0`이 미설정 sentinel이라는 규약을 유지하되, **미설정이 실행을 막지는 않는다** —
해당 안전 계층만 비활성화된다.

`reasonCode`는 `MODE_NOT_SUPPORTED|RELAY_CUT|DEVICE_OFFLINE|null`이다.
`SAFETY_PROFILE_NOT_READY`는 더 이상 발생하지 않는다.
```

- [ ] **Step 2: §4.13의 `quick` 블록 예시에 필드 2개를 추가한다**

```json
"quick": {
  "vLightLoadV": 5.06,
  "regulationKneeA": 1.6,
  "kneeIsUpperBound": false,
  "latchOff": false,
  "thermalSlopeCPerMin": 2.4,
  "specAttainmentPct": 80,
  "ratedOutputCurrentA": 2.0,
  "grade": "SUSPECT_DEGRADED",
  "gradeProvisional": true
}
```

그리고 필드 설명을 예시 아래에 덧붙인다:

```markdown
- `latchOff` — 출력 소실(5V→0V)로 이탈이 관측됐는지. 점진적 처짐과 구분한다(스펙 §3-2 ②)
- `gradeProvisional` — 발열 기울기 상한 `S1`이 미설정(`0`)인 상태로 낸 등급이라는 표시. H3 실측 후 `false`가 된다
- `dataSource` (최상위) — `SIMULATED` \| `MEASURED`
```

- [ ] **Step 3: `CLAUDE.md`의 승격 금지 문장을 갱신한다**

「보조배터리 열화 진단 (모드 2)」 절의 *"하드웨어 프로필을 먼저 본다"* 항목을 교체:

```markdown
- **⚠️ 실행 잠금은 2026-09-01에 열렸다 — 모드 2면 진단이 시작된다.** 이전의
  *"`COMBINED_EXISTING_PARTS_V1`은 `409 SAFETY_PROFILE_NOT_READY`"* 규칙은 폐기됐다.
  **다만 계측값의 출처를 반드시 확인하라** — 결과의 `dataSource`가 `SIMULATED`면
  백엔드 시뮬레이터가 만든 값이고 **실물 측정이 아니다.** 실물 에지가 붙기 전까지
  이 값으로 배터리 상태를 판단하면 안 된다.
- **안전 문턱은 여전히 미실측이다(§8 H2·H3).** `0`이 미설정 sentinel이며 그 안전
  계층을 비활성화한다. `.env`의 `DIAG_*` 값으로 주입하며, 실측이 끝나면 숫자만 바꾼다.
  `S1`이 `0`이면 등급에 `gradeProvisional: true`가 붙는다.
```

「회로도」 절의 *"안전 문턱과 연속 감시가 검증되기 전 `COMBINED_EXISTING_PARTS_V1`을 제품 F21 진단으로 승격하지 않는다"* 문장도
*"…승격하지 않는다"* → *"…승격하지 않았으나, 소프트웨어 실행 잠금은 2026-09-01에 열렸다(위 절 참조). 실물 부하를 거는 것과 시뮬레이션 실행은 다른 문제다."* 로 고친다.

- [ ] **Step 4: 계약서 린터를 돌린다**

Run: `cd /Users/jungjeahwan/Desktop/claude/han && python3 tools/contract_lint.py`
Expected: 위반 0건. `docs/product_contract.md`를 고치지 않았으므로 통과해야 한다.

- [ ] **Step 5: 커밋**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add docs/backend_contract.md CLAUDE.md
git commit -m "docs: record that the F21 execution lock is open and results are simulated"
```

---

### Task 14: end-to-end 검증

**Files:**
- 변경 없음 (검증만)

**Interfaces:**
- Consumes: Task 1-13 전부

- [ ] **Step 1: 전체 테스트와 타입 검사**

```bash
cd /Users/jungjeahwan/Desktop/claude/han/backend && npm test && npm run typecheck
cd /Users/jungjeahwan/Desktop/claude/han/frontend && npm test && npm run typecheck
```
Expected: 전부 PASS

- [ ] **Step 2: 실 백엔드를 띄운다 (MSW 없이)**

```bash
cd /Users/jungjeahwan/Desktop/claude/han/backend
env $(grep -v '^#' .env.example | xargs) PORT=3099 ./node_modules/.bin/tsx src/server.ts
```
Expected: `CellGuard backend listening on 3099 (auth=demo data=memory)`

- [ ] **Step 3: 빠른 진단을 끝까지 돌린다**

다른 터미널에서:

```bash
B=http://127.0.0.1:3099
T=$(curl -s -X POST $B/api/demo/login -H 'content-type: application/json' -d '{"email":"hong@cellguard.io"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')
H="Authorization: Demo $T"

# 모드 2 자산이 hong 소유로 보이는지
curl -s $B/api/batteries -H "$H" | grep -o 'PB-HONG-001'

curl -s -X POST $B/api/sessions -H "$H" -H 'content-type: application/json' -d '{"batteryId":"PB-HONG-001"}'
curl -s -X POST $B/api/diagnosis/quick -H "$H" -H 'content-type: application/json' \
  -d '{"socHintLevel":3,"acknowledged":true}' -w "\n[%{http_code}]\n"
```
Expected: `[202]`, `"status":"RUNNING"`, `"phase":"P0"`

```bash
sleep 125
curl -s $B/api/batteries/PB-HONG-001/diagnoses -H "$H"
```
Expected: `items[0].status === "COMPLETED"`, `summary.grade`가 `null`이 아님

- [ ] **Step 4: 거절 경로를 확인한다**

```bash
# 모드 1 자산
curl -s -X POST $B/api/sessions -H "$H" -H 'content-type: application/json' -d '{"batteryId":"PACK-001"}'
curl -s -X POST $B/api/diagnosis/quick -H "$H" -H 'content-type: application/json' -d '{"acknowledged":true}' -w "\n[%{http_code}]\n"
```
Expected: `[409] MODE_NOT_SUPPORTED`

```bash
# ack 없이
curl -s -X POST $B/api/diagnosis/quick -H "$H" -H 'content-type: application/json' -d '{}' -w "\n[%{http_code}]\n"
```
Expected: `[400] ACK_REQUIRED`

`capacityWh`가 없는 모드 2 자산을 등록해 `POST /api/diagnosis/capacity`를 부르면
`[409] CAPACITY_NOT_REGISTERED`가 나와야 한다.

- [ ] **Step 5: 중단 경로를 확인한다**

```bash
curl -s -X POST $B/api/sessions -H "$H" -H 'content-type: application/json' -d '{"batteryId":"PB-HONG-001"}'
curl -s -X POST $B/api/diagnosis/quick -H "$H" -H 'content-type: application/json' -d '{"acknowledged":true}' > /dev/null
curl -s -X DELETE $B/api/diagnosis/active -H "$H" -w "\n[%{http_code}]\n"
```
Expected: `[200]`, `"status":"ABORTED"`, `"abortReason":"USER"`

- [ ] **Step 6: 화면에서 확인한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han/frontend && npm run dev:real
```

브라우저에서 `hong@cellguard.io`로 로그인 → `PB-HONG-001` 세션 시작 → `보조배터리 진단`:
- 안전 프로필 잠금 카드가 **보이지 않아야** 한다
- 안전 확인 체크 후 `빠른 진단 시작`이 눌린다
- 진행률 바가 **움직인다** (32%에 멈춰 있지 않다)
- 단계가 `P0` → `P1` → … 로 바뀐다
- 120초 후 이력에 결과가 쌓이고, 상세에서 등급이 **한국어**로 보인다
- `PB-HONG-002`로 정밀 용량 테스트를 시작하면 `sohRelPct`가 산출되는 경로가 열린다 (기준선 이력 보유)

- [ ] **Step 7: 서버를 정리하고 커밋한다**

```bash
pkill -f "tsx src/server.ts"
cd /Users/jungjeahwan/Desktop/claude/han
git status   # 변경이 없어야 정상. 있으면 검증 중 수정한 내용을 커밋한다
```

---

## 완료 판정

- [ ] `cd backend && npm test` 통과 (신규 스위트 5개 포함)
- [ ] `cd backend && npm run typecheck` 통과
- [ ] `cd frontend && npm test && npm run typecheck` 통과
- [ ] `python3 tools/contract_lint.py` 위반 0건
- [ ] Task 14의 end-to-end 7단계 전부 확인
- [ ] `docs/backend_contract.md`와 `CLAUDE.md`가 실제 동작과 일치
