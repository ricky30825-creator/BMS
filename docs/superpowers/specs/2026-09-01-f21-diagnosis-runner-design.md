# F21 보조배터리 진단 — 실행 잠금 해제와 백엔드 러너 설계

**작성일** 2026-09-01
**상태** 승인됨 (구현 대기)
**대상** 모드 2 (USB 보조배터리) 열화 진단 — 빠른 진단 / 정밀 용량 테스트

---

## 0. 이 문서를 읽는 법

산식·물리 근거의 정본은 `docs/hardware/mode2_powerbank_diagnosis_spec.md`, API 표면의 정본은
`docs/backend_contract.md` §4.13이다. **이 문서는 그 둘을 코드로 옮기는 방법만 정의한다.**
산식을 여기서 다시 정의하지 않고, 어느 절에서 왔는지 인용한다.

구현자가 임의 판단해야 하는 지점은 §9에 모아 두었다. 그 외의 값·이름은 전부 확정이다.

---

## 1. 배경과 문제

### 1-1. 현재 상태 (2026-09-01 실측)

프론트 `/powerbankDiag` 화면과 백엔드 `/api/diagnosis/*` 라우트는 **경로·필드명이 모두 일치**한다.
그런데 실행 게이트가 두 곳에 하드코딩 `false`라 진단이 시작되는 경로가 존재하지 않는다.

| 위치 | 내용 |
|---|---|
| `backend/src/server.ts:170` | `diagnosisCapability.executionAllowed`가 조건 없이 `false` |
| `backend/src/store/types.ts:99` | `F21_THRESHOLDS.configured = false` (상수), `memory.ts:251`이 이걸 보고 throw |

실 백엔드(`AUTH_MODE=demo`, `DATA_MODE=memory`)에 모드 2 자산을 등록하고 세션을 연 뒤 호출한 결과:

```
POST /api/diagnosis/quick     → 409 SAFETY_PROFILE_NOT_READY
POST /api/diagnosis/capacity  → 409 SAFETY_PROFILE_NOT_READY
GET  /api/diagnosis/active    → 200 null
```

### 1-2. 잠금 외의 갭

잠금을 열어도 다음이 비어 있어 진단이 진행되지 않는다.

1. **러너 없음** — `memory.ts:246-256`이 `status: "RUNNING"` 레코드를 만들고 끝난다. 상태를 옮기거나 결과를 채우는 코드가 없다.
2. **WS 미발행** — `server.ts`의 `broadcast()` 호출부에 `diagnosis.*`가 하나도 없다. 프론트는 `diagnosis.progress`/`done`/`aborted` 세 개를 모두 처리한다(`useRealtime.ts:50-52`).
3. **결과 항상 `null`** — `diagnosisJson()`이 `quick: null, capacity: null`을 상수로 반환한다(`server.ts:262-263`). 이력 `summary`도 `null` 하드코딩(`server.ts:905`).
4. **에러코드 3종 누락** — 계약서가 요구하는 `CAPACITY_NOT_REGISTERED`·`RELAY_CUT`·`DEVICE_OFFLINE`이 `errorFromDomain` 맵에 없다.
5. **세션 종료 시 정리 없음** — 계약서가 요구하는 "세션이 끝나면 진행 중 진단을 `ABORTED`로 닫는다"가 어느 경로에도 없다.

### 1-3. 개발 중 혼선의 원인 (반드시 알아야 함)

`npm run dev`는 **MSW 목을 켠 채로 뜬다.** `frontend/`에 `.env`가 없고(`.env.example`은 Vite가 읽지 않는다)
`main.tsx:10-11`이 `VITE_USE_MOCKS !== "false"`면 목을 켜기 때문이다.
목 데이터의 `PACK-004`만 `executionAllowed: true`라서, **목에서는 진단이 끝까지 동작하는 것처럼 보인다.**

실 백엔드를 보려면 `npm run dev:real` 또는 `?mock=0`을 쓴다.
이 설계는 목과 서버 동작을 정합시켜 이 혼선을 없앤다(§7-4).

---

## 2. 결정 사항

브레인스토밍에서 확정된 것.

| 항목 | 결정 | 근거 |
|---|---|---|
| 목표 | **동작하는 백엔드 진단** — 서버가 단계를 진행시키고 WS를 쏘고 결과를 산출 | 사용자 결정 |
| 잠금 | **`targetMode === 2`면 무조건 허용** | 사용자 결정 |
| 소요 시간 | **스펙 실시간 그대로** (빠른 진단 120초, 정밀 용량 수 시간) | 사용자 결정 |
| 구조 | **A′ — 순수 로직 + ingest 포트** | 아래 |
| 안전 중단 | **문턱·규칙 모두 교체 가능하게** (주입식) | 사용자 결정 |

### 2-1. AI와 F21은 독립이다 (구현자가 혼동하기 쉬움)

열폭주 이상탐지(LSTM-AE + Informer)와 F21 열화 진단은 **다른 축**이다.
CLAUDE.md: *"열화 등급과 이상점수 4등급은 다른 축이다."*

- F21 산식은 **전부 결정론적**이다. AI를 호출하지 않는다.
- 의존 방향은 **반대**다 — 스펙 §6-3에 따르면 AI가 `diag_phase != null` 프레임을 학습셋에서 제외하고 진단 중 알림을 억제한다. 즉 AI가 F21의 산출물을 소비한다.
- 따라서 **AI 알고리즘 미완성은 F21을 막지 않는다.**

⚠️ `CAUTION`이 양쪽 enum에 다 있다. 합산하거나 같은 타입으로 취급하면 조용히 틀린다.

### 2-2. 왜 별도 프로세스가 아닌가

진단 상태기계의 **최종 거처는 호스트의 별도 프로세스가 아니라 에지(라즈베리파이)**다.

- 스펙 §3-1: *"라즈베리파이는 INA226의 `current_a`가 목표값 근처에서 안정된 시점을 계단으로 검출하고 거기서부터 창을 센다"*
- 스펙 §6-1: 에지가 `diag_phase`·`load_target_a`를 100ms 프레임에 실어 보낸다
- 부하 제어(BW150)도 에지에 붙는다

반면 **산식의 최종 거처는 백엔드**다 — `backend_contract.md:592` *"산출 주체는 **백엔드**다"*.

그래서 이 설계는 임시방편이 아니라 **최종 구조의 백엔드 절반을 지금 짓는 것**이다.
실물이 붙을 때 사라지는 파일은 `simulator.ts` 하나다.

덧붙여 지금은 별도 프로세스가 백엔드와 말할 수단이 없다 — Kafka 브로커·consumer·ingest 엔드포인트가 전부 없다.

---

## 3. 구조

```
backend/src/diagnosis/
  phases.ts      단계 시퀀스 정의                 ← 계약. 나중에 에지와 공유할 정의
  metrics.ts     산식 (순수 함수)                 ← 백엔드가 최종적으로도 소유
  safety.ts      중단 판정 (주입식 문턱)           ← 규칙째로 교체 가능
  runner.ts      진행·전환·완료 판정 (순수 + deps)
  ingest.ts      포트 정의
  simulator.ts   오늘의 계측 소스                  ← 유일하게 버려질 파일
  routes.ts      라우트 헬퍼 (server.ts에서 이전)
```

`failsafe.ts`(순수 판정) / `failsafeRunner.ts`(부수효과) 분리를 그대로 따른다.

### 3-1. ingest 포트

백엔드는 *"단계가 바뀌었다 / 샘플이 들어왔다 / 끝났다"*만 안다. 그게 어디서 오는지 모른다.

```ts
// diagnosis/ingest.ts
export type DiagnosisSample = {
  atMs: number;              // 진단 시작 기준 경과 ms
  voltageV: number;
  currentA: number;          // 부호 살림. 방전 = 음수 (CLAUDE.md 규약)
  tempIrSurfaceC: number | null;
  gasRaw: number | null;
  loadTargetA: number;       // 그 프레임에서 지시한 목표 전류
};

export interface DiagnosisSource {
  sample(diagnosis: DemoDiagnosis, elapsedMs: number): DiagnosisSample;
}
```

- **오늘**: `simulator.ts`가 구현
- **나중**: Kafka consumer가 같은 인터페이스를 구현. 러너·산식은 변경 없음

⚠️ **import 방향을 지킨다 — 순환 참조가 나기 쉬운 자리다.**
`store/types.ts`가 `progress.windows`에 `PhaseWindow`를 쓰므로 `diagnosis/metrics.ts`를 import한다(§7-1).
따라서 **`metrics.ts`·`phases.ts`·`safety.ts`는 스토어를 import하지 않는다** — 순수 계산만 한다.
스토어 타입이 필요한 건 `ingest.ts`·`runner.ts`·`routes.ts`뿐이다.

---

## 4. 단계 시퀀스 (`phases.ts`)

스펙 §3-1 표 그대로.

| 단계 | 지속 | 목표 전류 | 기록 |
|---|---|---|---|
| `P0` | 10s | **0.1A** (최소 유지) | 경부하 출력전압 `vLightLoadV`, 시작 표면온도 |
| `P1` | 20s | 0.5A | 후반 10초의 V·I 중앙값, T |
| `P2` | 20s | 1.0A | 동일 |
| `P3` | **40s** | 1.5A | 동일 + **발열 기울기 산출 구간** |
| `P4` | 20s | 2.0A | 동일 |
| `P5` | 10s | **0.1A** (최소 유지) | 부하를 내린 뒤의 회복 전압 |
| `P6` | ≤60s | 미세 스윕 | 무너진 두 단계 사이를 0.1A 간격 재스윕. **안 무너졌으면 생략** |

합계 120초 (P6 생략 시).

> **이번 구현에서 `P6`는 정의만 두고 항상 생략한다.** 스윕 알고리즘이 `정의 필요` 상태다(§15).
> `phases.ts`에 `P6`를 표현하되 `quickPhases()`가 반환하는 시퀀스에는 넣지 않는다.
> 따라서 빠른 진단은 **항상 정확히 120초**다.

**규칙**

1. **각 단계의 후반 절반만 집계에 쓴다.** 부하 변경 직후는 컨버터 재정착 과도구간이라 값이 흔들린다(스펙 §3-1).
   예: `P0`(10s) → 마지막 5초, `P3`(40s) → 마지막 20초.
2. **P0·P5는 무부하가 아니라 0.1A다.** 보조배터리는 무부하가 지속되면 출력을 스스로 끊는다(스펙 §2-6, CLAUDE.md). 진짜 무부하로 두면 0V를 읽는다. 그래서 기준전압 이름이 `vLightLoadV`이지 `vOpenCircuitV`가 아니다.
3. **P3만 40초인 이유**: 케이스 열시정수가 수십 초라 20초 기울기는 노이즈에 묻힌다.
4. **목표 전류는 스펙 §3-1의 고정 계단이다** — 0.1 / 0.5 / 1.0 / 1.5 / 2.0 / 0.1 A.
   ⚠️ **정격 전류 상한을 걸지 않는다.** `0.7 × 광고 정격` 규칙은 스펙 §9-2(스크리닝
   프로토콜, :766)의 것이지 빠른 진단의 것이 아니다. 이 상한을 §3에 적용하면
   `specAttainmentPct`가 70%를 넘을 수 없어 **`HEALTHY` 등급이 도달 불가능해진다**
   (2026-09-01 실측으로 확인 — 계획 v1의 결함이었고 제거했다).
   `MIN_HOLD_LOAD_A = 0.1` 하한은 그대로 유지한다 — 보조배터리가 무부하에서 출력을
   끊는 물리 제약이라 성격이 다르다.
   ⚠️ **미해결**: 실물 하드웨어에서 빠른 진단이 정격을 초과하는 부하를 걸어도 되는지는
   실측으로 정해야 한다(§3-3 중단 문턱 H2와 함께). 지금은 계측이 시뮬레이터라 물리 위험이 없다.
5. **단계는 경과시간에서 계산한다.** 러너가 단계 상태를 들고 있지 않다. tick이 밀리거나 걸러져도 단계가 어긋나지 않고, 서버가 바빠도 P3가 40초보다 짧아지지 않는다.

**정밀 용량**은 단일 단계 `CAPACITY`다. 컷오프까지 지속한다.

```ts
export type PhaseSpec = { phase: string; durationMs: number; loadTargetA: number };
export function quickPhases(ratedOutputCurrentA: number | null): PhaseSpec[];
export function phaseAt(specs: PhaseSpec[], elapsedMs: number): PhaseSpec | null;  // null = 종료
```

---

## 5. 산식 (`metrics.ts`) — 전부 순수 함수

```ts
export type PhaseWindow = {
  phase: string;
  loadTargetA: number;
  voltageMedianV: number;
  currentMedianA: number;              // 부호 살림. 산식은 Math.abs() 사용
  tempSamples: { atMs: number; tempIrSurfaceC: number }[];
  latchOff: boolean;                   // 출력 소실(V < 1.0V) 관측
};
```

### 5-1. `regulationKneeA` — 레귤레이션 이탈 전류 (스펙 §3-2 ①)

```
vLightLoadV = P0 창의 voltageMedianV
knee        = voltageMedianV < 0.94 × vLightLoadV 인 최소 loadTargetA
```

- 2.0A까지 버티면 → `regulationKneeA: 2.0`, `kneeIsUpperBound: true`
  ("2.0A 이상"이지 "정확히 2.0A"가 아니다)
- **래치오프**(`voltageMedianV < 1.0V`)도 정상적인 이탈 관측이다 → 그 단계의 `loadTargetA`를 knee로 기록, `latchOff: true`.
  (`1.0V`는 "출력이 사라졌다"를 판정하는 우리 쪽 검출 문턱이다. IC 내부 차단 조건인 `<4.4V·30ms`와 다른 값이며,
  우리는 결과로 나타난 출력 소실만 본다. `safety.ts` 문턱과 달리 산식 상수이므로 `metrics.ts`에 둔다.)
  IP5306류는 출력 <4.4V가 30ms 지속되면 출력을 통째로 차단한다(스펙 §3-2 ②).
  **"배터리 사망"이나 센서 오류로 오독하면 안 된다.**
- ⚠️ **절대값 4.7V가 아니라 `vLightLoadV` 비율을 쓴다.** 9V·12V PD 모드에서도 같은 산식이 성립해야 한다.
- 94%의 근거: 5V에서 4.70V이며 USB 2.0 다운스트림 포트 하한 4.75V 바로 아래다.

### 5-2. `thermalSlopeCPerMin` — 발열 기울기 (스펙 §3-2 ②)

P3(1.5A) 40초 구간 `temp_ir_surface`의 **최소자승** 기울기 × 60.

두 점 차분을 쓰지 않는 이유: IR 노이즈에 취약하다.
`tempSamples`가 2개 미만이면 `null`.

### 5-3. `specAttainmentPct` — 스펙 도달률 (스펙 §3-2 ③)

```
specAttainmentPct = min(이탈 없이 버틴 최대 목표전류, ratedOutputCurrentA) / ratedOutputCurrentA × 100
```

`ratedOutputCurrentA`가 없으면 `null`이고 **등급 판정에서 제외**한다.

### 5-4. 등급 (스펙 §3-4)

```
HEALTHY           knee ≥ rated  AND  slope < S1  AND  attainment ≥ 95
CAUTION           위 셋 중 하나 위반
SUSPECT_DEGRADED  둘 이상 위반  OR  knee < rated × 0.7
BASELINE_PENDING  §9-1 참조
```

enum은 계약서 §4.13: `HEALTHY | CAUTION | SUSPECT_DEGRADED | BASELINE_PENDING`.

⚠️ 이 등급은 이상점수 4등급(`NORMAL`/`CAUTION`/`WARNING`/`DANGER`)과 **다른 축**이다.

### 5-5. 정밀 용량 (스펙 §4)

```
Δt_h         = tickIntervalMs / 3_600_000            (1초 tick → 1/3600 h)
deliveredWh += |voltageV × currentA| × Δt_h          (매 tick 누적)
baselineWh   = 그 자산의 첫 COMPLETED CAPACITY 진단의 deliveredWh (partial 제외)
sohRelPct    = deliveredWh / baselineWh × 100        ← 신뢰값 (η가 약분됨)
sohAbsPct    = deliveredWh / (ratedWh × η) × 100     ← 참고값
컷오프       = voltageV < 0.80 × vLightLoadV 가 회복하지 않음
```

⚠️ **적산 주기가 스펙과 다르다.** 스펙 §4-1은 INA226 100ms 적산인데 우리는 1초 tick이다.
계측 소스가 시뮬레이터라 허용되는 차이이며, `Δt`를 상수로 박지 말고 **실제 tick 간격에서 계산**한다.
Kafka consumer가 100ms 프레임을 넣기 시작하면 같은 코드가 그대로 맞는다.

`estimatedEndAt`(스펙 §4-1 ②) = `now + ratedWh / (vLightLoadV × |dischargeCurrentA|)` 시간.
시작 시점에는 `vLightLoadV`를 아직 모르므로 **공칭 5.0V**로 추정하고, `P0` 집계가 끝나면 갱신한다.

`assumedEfficiency`(η)는 응답에 **반드시 동봉**한다. 기본 0.88 (스펙 §8 H4, `정의 필요`).

**코드로 강제할 불변식 3개**

1. **첫 테스트는 `sohRelPct: null` + `isBaseline: true`.**
   기준선 자신을 100%로 내면 "열화 없음"으로 오독된다.
2. **`partial: true`면 `sohRelPct`·`sohAbsPct` 모두 `null`이고 `baselineWh` 후보에서도 제외.**
3. **`ratedWh`는 셀 기준(3.7V × mAh), 측정은 출력단(5V) 기준.**
   η로 보정하지 않으면 방금 산 10000mAh 제품이 `31.5 / 37 = 85.1%`로 나온다.

---

## 6. 안전 중단 (`safety.ts`) — 교체 가능하게

`failsafe.ts`와 같은 모양. **문턱을 하드코딩하지 않고 주입한다.**

```ts
export type DiagnosisAbortReason =
  | "TEMP_ABSOLUTE" | "TEMP_SLOPE" | "GAS" | "VOLTAGE_COLLAPSE";

export type DiagnosisSafetyThresholds = {
  surfaceCutoffC: number;        // 0 = 미설정 → 그 계층 비활성
  tempSlopeCPerMin: number;
  gasRaw: number;
  voltageCollapseRatio: number;  // 확정값 0.80
};

export function judgeDiagnosisAbort(
  kind: "QUICK" | "CAPACITY",
  sample: DiagnosisSample,
  vLightLoadV: number | null,
  tempSlopeCPerMin: number | null,
  thresholds: DiagnosisSafetyThresholds
): DiagnosisAbortReason | null;
```

| `abortReason` | 조건 | 상태 |
|---|---|---|
| `TEMP_ABSOLUTE` | 표면온도 ≥ `surfaceCutoffC` (스펙 잠정 50°C) | `정의 필요` (§8 H2) |
| `TEMP_SLOPE` | `dT/dt` > `tempSlopeCPerMin` (스펙 잠정 5°C/min) | `정의 필요` (§8 H2) · **주 판단 근거** |
| `GAS` | `gas_raw` ≥ `gasRaw` | 0 sentinel로 비활성 |
| `VOLTAGE_COLLAPSE` | V < 0.80 × `vLightLoadV` | **확정** |

**규칙**

1. **`0`은 미설정 sentinel이다.** 해당 계층을 비활성화한다. `failsafe.ts:37`의 `UNSET_THRESHOLDS`와 같은 규약.
2. ⚠️ **`VOLTAGE_COLLAPSE`는 `QUICK`에서만 중단 사유다.** `CAPACITY`에서 같은 조건은 **정상 컷오프**(→ `COMPLETED`)다. 같은 임계가 kind에 따라 정반대 결과를 낸다.
3. **중단 순서: 부하를 0A로 내린 다음 릴레이를 차단한다.** 순서가 뒤바뀌면 인덕티브 킥과 아크가 생긴다(스펙 §3-3). **테스트로 고정한다.**
4. **차단은 CH3(마스터)로 한다.** CH4는 안전 채널이 아니다(스펙 §2-5).
5. **Fail-Safe는 진단 중에도 억제하지 않는다.** 이상 **알림**만 억제한다(스펙 §6-3).

문턱은 `config/env.ts`에서 읽는다. H2·H3 실측이 나오면 **`.env` 숫자만 바꾸고 코드는 건드리지 않는다.**
판정 규칙 자체를 바꿔야 하면 이 파일만 교체한다 — 러너는 영향받지 않는다.

> 관리자 화면에서 런타임에 문턱을 바꾸는 기능은 **넣지 않는다.**
> 계약서가 임계치 설정 엔드포인트를 만들지 말라고 명시한다. 반영 경로는 `.env` 교체 + 재기동이다.

---

## 7. 배선

### 7-1. 스토어 확장

`DemoDiagnosis`에 진행 상태를 담을 자리가 없다. `result`에 넣으면 최종 결과와 섞이므로 필드를 늘린다.

```ts
// store/types.ts
export type DemoDiagnosis = {
  …기존…
  progress: {                        // RUNNING 동안만 채워짐. 완료 시 null
    loadTargetA: number | null;
    loadActualA: number | null;
    partialMetrics: Record<string, number | boolean | null> | null;
    windows: PhaseWindow[];
    deliveredWh: number;
    vLightLoadV: number | null;
  } | null;
};
```

`store/contract.ts` + `store/memory.ts`에 메서드 3개 추가:

| 메서드 | 용도 |
|---|---|
| `advanceDiagnosis(id, phase, progress)` | 단계 전환·진행 상태 갱신 |
| `completeDiagnosis(id, result)` | `COMPLETED` 확정 + `result` 기록 |
| `abortDiagnosisBySystem(batteryId, reason)` | 안전 중단·세션 종료용 |

⚠️ **세 번째가 왜 필요한가**: 현재 `abortDiagnosis(ownerId, batteryId)`가 활성 세션과 소유자를 검사한다
(`memory.ts:258-265`). 세션이 끝나서 진단을 닫아야 하는 상황에서는 그 검사가 통과할 수 없어
진단이 영원히 `RUNNING`으로 남는다.

`baselineWh`는 메서드를 늘리지 않고 `diagnosesForBattery()`에서
**첫 `COMPLETED` + `CAPACITY` + `partial !== true`** 를 골라 계산한다.

### 7-2. 러너 tick

`server.ts:1211`의 **기존 1초 `setInterval`에 진단 tick을 추가**한다.
별도 타이머를 만들지 않는 이유: 계측 tick과 진단 tick이 갈리면 같은 프레임에 두 시각이 생긴다.

```
tick() → 활성 진단 있음?
       → source.sample(diagnosis, elapsedMs)            // ingest 포트
       → runner.step(diagnosis, sample, thresholds)     // 순수
       → { phaseChanged?, aborted?, completed? } 에 따라 store 갱신 + broadcast
```

### 7-3. WS 발행 (계약서 §5.3)

| 이벤트 | 시점 | payload |
|---|---|---|
| `diagnosis.progress` | **단계 전환 시에만** | `{ id, kind, phase, loadTargetA, loadActualA, estimatedEndAt, partialMetrics }` |
| `diagnosis.done` | 완료 | `Diagnosis` 객체 전체 |
| `diagnosis.aborted` | 중단 | `{ id, kind, abortReason }` — 사유 code만 |

`topicForType()`이 이미 `diagnosis.*` → `diagnosis` 토픽으로 매핑한다(`server.ts:1035`).
프론트도 세 이벤트를 다 처리한다(`useRealtime.ts:50-52`).
**양쪽 배선이 이미 있고 서버 발행부만 비어 있다.**

매 tick이 아니라 단계 전환에만 보내므로 빠른 진단 120초에 WS는 6~7건만 나간다.

### 7-4. 잠금 해제

`server.ts:170`을 실제 판정으로 교체:

```ts
diagnosisCapability: battery.targetMode !== 2
  ? { executionAllowed: false, reasonCode: "MODE_NOT_SUPPORTED" }
  : relayCut      ? { executionAllowed: false, reasonCode: "RELAY_CUT" }
  : deviceOffline ? { executionAllowed: false, reasonCode: "DEVICE_OFFLINE" }
  : { executionAllowed: true, reasonCode: null }
```

`F21_THRESHOLDS.configured` 게이트(`memory.ts:251`)를 제거한다.
대신 결과에 `dataSource: "SIMULATED"`가 실려 이력에서 시뮬레이션 시기 데이터를 구분할 수 있다.

⚠️ **문서 갱신이 함께 필요하다.** 계약서 §4.13이 현재
*"`MODE2_FULL`만 실행 가능, `COMBINED_EXISTING_PARTS_V1`은 409"*,
*"문턱값 하나라도 0이면 `configured=false`이며 409"* 라고 명시한다.
코드만 바꾸면 문서와 정면으로 어긋난다. CLAUDE.md 본문의 승격 금지 문장도 같다.
**둘 다 갱신하고 결정 근거와 날짜(2026-09-01)를 남긴다.**

### 7-5. 에러코드 3종

계약서 §4.13이 요구하는데 코드에 없다.

| 코드 | 조건 | 현재 |
|---|---|---|
| `409 CAPACITY_NOT_REGISTERED` | `CAPACITY`인데 `capacityWh` 없음 | `errorFromDomain` 맵·프론트 `ErrorCode` 양쪽에 없음 |
| `409 RELAY_CUT` | 릴레이 차단 상태라 부하 경로 없음 | 양쪽에 없음 |
| `409 DEVICE_OFFLINE` | 진단기 오프라인 | 프론트에만 있음. **백엔드 맵에 없어 500으로 샌다** |

프론트가 `capacityWh` 없으면 버튼을 비활성화하지만(`UserPages.tsx:214`),
서버가 재검증하지 않으면 API 직접 호출로 뚫린다.

### 7-6. 세션 종료·릴레이 차단 시 정리

계약서: *"세션이 끝나면(`TIMEOUT`/`SUPERSEDED`/`BLOCKED`) 진행 중 진단을 `ABORTED`로 닫는다."*
현재 어느 경로에도 없다.

- `server.ts:532` — `SUPERSEDED`
- `server.ts:807` — `BLOCKED`
- `TIMEOUT` 경로
- 릴레이 차단 경로 → `abortReason: "RELAY_CUT"`

각 지점에서 `abortDiagnosisBySystem(batteryId, …)` 호출 + `diagnosis.aborted` 발행.

### 7-7. 재시작

메모리 스토어라 서버를 내리면 진행 중이던 `CAPACITY`가 배터리 자산과 함께 사라진다.
고아 레코드가 없으므로 정리 코드는 불필요하다.

**후속 과제**: PostgreSQL 저장소가 생기면 *"기동 시 `RUNNING` 진단을 `ABORTED`(`SESSION_ENDED`)로 닫기"* 가 필요하다.

---

## 8. 시뮬레이터 (`simulator.ts`) — 교체 대상

기존 데모 tick의 합성값을 쓰면 진단 결과가 부하와 무관해져 무의미하다.
**부스트 컨버터 거동을 모사**해야 등급이 실제로 갈린다.

```ts
// batteryId를 시드로 한 결정론적 특성. 같은 자산은 항상 같은 결과
type PackTraits = {
  collapseCurrentA: number;      // 0.8 ~ 2.4A
  vLightLoadV: number;           // 5.02 ~ 5.12V
  thermalCoeffCPerWMin: number;
  capacityWhActual: number;      // ratedWh × η(0.82~0.92) × 열화계수
};
```

- **전압**: `|I| < collapse` → `vLightLoadV` 근처.
  넘으면 처짐. `|I| > collapse × 1.35` → 래치오프(V ≈ 0).
  실제 IC 출력 한계는 0.8A(HT4928S) ~ 4.8A(IP5318)로 **6배 흩어진다**(스펙 §9, 2026-08-08 웹 검증).
- **온도**: `T += thermalCoeffCPerWMin × 부하전력W × Δt분`. P3(1.5A)에서 기울기가 실제로 잡힌다.
- **CAPACITY**: `deliveredWh`가 `capacityWhActual`에 도달하면 전압 붕괴 → 컷오프.

시드를 자산별로 흩으면 `PACK-003`/`004`/`005`가 서로 다른 등급으로 나온다.

⚠️ **시뮬레이터는 `ingest.ts` 포트를 호출하는 쪽이다.** 러너와 산식은 시뮬레이터의 존재를 모른다.
Kafka consumer가 같은 포트를 구현하면 이 파일만 지운다.

---

## 9. 구현자가 알아야 할 판단 (계약서의 빈틈)

### 9-1. `BASELINE_PENDING`의 정의

계약서 enum에는 있는데 스펙 §3-4 표에 정의가 없다.

**결정**: `ratedOutputCurrentA`도 없고 `S1`도 미설정이라 **세 조건 중 둘을 못 보는 경우**.
"비교 기준 없음"이라는 이름 뜻과 맞는다.

### 9-2. `S1`(발열 기울기 상한) 미실측

스펙 §3-4가 *"판정의 형태만 확정"*이라고 명시한다(§8 H3).

**결정**: `failsafe.ts`의 `0 = 미설정 sentinel` 규약을 빌린다.
**`S1 === 0`이면 그 조건을 "위반 아님"으로 보고 결과에 `gradeProvisional: true`를 단다.**
실측이 나오면 `.env` 숫자만 바꾼다.

### 9-3. 계약서에 추가할 필드 3개

| 필드 | 위치 | 이유 |
|---|---|---|
| `latchOff: boolean` | `quick` | 스펙 §3-2 ②에는 있는데 계약서 예시에 누락 |
| `gradeProvisional: boolean` | `quick` | `S1` 미설정 상태로 낸 등급 표시 |
| `dataSource: "SIMULATED" \| "MEASURED"` | 최상위 | 이력에서 시뮬레이션 시기 구분 |

프론트 `Diagnosis` 타입은 `[key: string]: unknown`을 이미 갖고 있어 타입 변경 없이 수용된다.

---

## 10. 테스트 (TDD — 산식 먼저)

`metrics.ts`·`safety.ts`·`phases.ts`가 순수 함수라 픽스처만으로 검증된다.
**구현 전에 아래 테스트를 먼저 쓴다.**

| 파일 | 검증 |
|---|---|
| `metrics.test.ts` | 이탈점 94% 경계값 / 2.0A 버팀 → `kneeIsUpperBound: true` / 래치오프 → knee 기록 + `latchOff` / 기울기를 아는 합성 수열의 최소자승 / `rated` 없으면 `specAttainmentPct: null` 전파 / 등급 4종 경계 / **첫 테스트 `sohRelPct: null` + `isBaseline: true`** / **`partial: true`면 SOH 둘 다 `null`** / η 미보정 시 새 배터리가 85%로 나오는 회귀 테스트 |
| `safety.test.ts` | 문턱 `0`이면 비활성 / 각 `abortReason` 발동 / **`VOLTAGE_COLLAPSE`가 `QUICK`은 중단, `CAPACITY`는 정상 컷오프** |
| `phases.test.ts` | 경과시간 → 단계 매핑 / 총 120초 / `0.7 × rated` 상한 / `rated` `null`이면 상한 없음 |
| `runner.test.ts` | 단계 전환 1회당 `diagnosis.progress` 1회 / **중단 시 부하 0A가 릴레이 차단보다 먼저** / 세션 종료 시 `ABORTED` |

`runner.test.ts`의 순서 검증은 실물에서 아크가 생기는 지점이라 반드시 고정한다.

기존 테스트를 깨뜨리지 않는지도 확인한다: `store/contract.test.ts`(계약 테스트 20건), `store.test.ts`.

⚠️ CLAUDE.md 경고: **계약 테스트 20건은 per-device와 전역 세션을 구분하지 못한다.**
테스트 통과를 활성 세션 규칙의 근거로 삼지 않는다.

---

## 11. 프론트 변경 (작음)

배선은 이미 되어 있어 4가지만 손본다.

1. **진행률 바 `32%` 하드코딩**(`UserPages.tsx:215`) → `startedAt`/`estimatedEndAt`으로 계산
2. **등급·중단사유가 raw enum으로 노출** — `SUSPECT_DEGRADED`가 그대로 화면에 뜬다.
   계약 §1.10 *"서버는 문구를 만들지 않고 프론트 사전이 조립한다"* 에 따라
   `grade`·`abortReason`·`status` 한국어 라벨 사전을 추가한다.
3. **`ErrorCode`에 `CAPACITY_NOT_REGISTERED`·`RELAY_CUT` 추가** (`frontend/src/types.ts`)
4. **MSW 목을 서버 실제 동작에 맞춘다** (`frontend/src/mocks/handlers.ts`)
   현재 목은 `PACK-004`만 `executionAllowed: true`인데 서버는 모드 2 전부 허용으로 바뀐다.
   어긋난 채 두면 §1-3의 혼선이 그대로 재발한다.

---

## 12. 데모 데이터

⚠️ **`hong@cellguard.io`(기본 데모 계정)에게 모드 2 자산이 하나도 없다.**
`PACK-003`/`004`/`005`는 각각 `leelab`·`kimeng`·`parktest` 소유다(`memory.ts:39-41`).
기본 계정으로 로그인하면 진단 화면이 계속 잠금으로 보인다.

- `hong` 소유의 모드 2 픽스처를 **하나 추가**한다.
- **정밀 용량 테스트 이력이 이미 1건 있는 자산**도 하나 둔다.
  `baselineWh`가 없으면 모든 첫 테스트가 `sohRelPct: null`이라 그 경로를 화면에서 볼 수 없다.

---

## 13. 파일별 작업 목록

**신규**

```
backend/src/diagnosis/phases.ts          + phases.test.ts
backend/src/diagnosis/metrics.ts         + metrics.test.ts
backend/src/diagnosis/safety.ts          + safety.test.ts
backend/src/diagnosis/runner.ts          + runner.test.ts
backend/src/diagnosis/ingest.ts
backend/src/diagnosis/simulator.ts
backend/src/diagnosis/routes.ts
```

**수정**

```
backend/src/store/types.ts        DemoDiagnosis.progress / F21_THRESHOLDS 정리
backend/src/store/contract.ts     메서드 3종
backend/src/store/memory.ts       구현 + hong 소유 모드2 픽스처 + baseline 이력
backend/src/config/env.ts         진단 안전 문턱 · η · S1 (기본 0)
backend/src/server.ts             capability 판정 / diagnosisJson quick·capacity
                                  / 이력 summary 실제값 / 에러코드 3종
                                  / tick에 러너 / 세션종료·릴레이차단 시 정리
frontend/src/types.ts             ErrorCode 2종
frontend/src/pages/UserPages.tsx  진행률 계산 + 라벨 사전
frontend/src/mocks/handlers.ts    서버 동작에 정합
docs/backend_contract.md          §4.13 잠금 규칙 갱신 + 필드 3종
CLAUDE.md                         승격 금지 문장 갱신
```

`server.ts`가 1200줄이 넘어 진단 라우트 헬퍼(`diagnosisJson`·`diagnosisStart`)를
`diagnosis/routes.ts`로 이전한다. 이번에 건드리는 범위 안이고 그대로 두면 더 커진다.

---

## 14. 검증 (구현 완료 판정)

`docs/verification_matrix.md`의 형식을 따른다. 아래가 전부 통과해야 완료다.

1. `cd backend && npm test` — 신규 4개 스위트 + 기존 전부 통과
2. `cd backend && npm run typecheck`, `cd frontend && npm run typecheck`
3. `cd frontend && npm test`
4. **실 백엔드 end-to-end** (`AUTH_MODE=demo`, `DATA_MODE=memory`, MSW 없이):
   - `hong`으로 로그인 → 모드 2 자산 세션 시작
   - `POST /api/diagnosis/quick` → `202`, `status: "RUNNING"`
   - 120초 대기 → `GET /api/diagnoses/{id}` 가 `COMPLETED` + `quick` 블록에 실제 값
   - WS 구독 시 `diagnosis.progress` 6~7건 + `diagnosis.done` 1건
   - `DELETE /api/diagnosis/active` → `200`, `abortReason: "USER"`
   - `capacityWh` 없는 자산에 `POST /api/diagnosis/capacity` → `409 CAPACITY_NOT_REGISTERED`
   - `targetMode: 1` 자산 → `409 MODE_NOT_SUPPORTED`
5. `npm run dev:real`로 화면에서 진단 실행 → 진행률 이동, 결과 한국어 라벨 표시
6. **`HEALTHY` 등급이 실제로 나오는지 확인한다** — 시뮬레이터가 건강하게 모델링한 자산
   (이탈 전류가 2.0A보다 큰 팩)에서 `grade: "HEALTHY"`가 나와야 한다. 안 나오면 부하 계단이
   정격에 도달하지 못하고 있다는 뜻이다.

---

## 15. 범위 밖

- Kafka consumer / 에지 수집 / BW150 실제 부하 제어 — `simulator.ts`가 자리를 지킨다
- PostgreSQL 저장소 구현 (`DATA_MODE=postgres`는 계속 `503 RUNTIME_NOT_READY`)
- P6 미세 스윕의 실제 스윕 알고리즘 — 단계 정의만 두고 이번엔 항상 생략 (`정의 필요`)
- 스크리닝(§9 `S0`~`S3`) — 별도 과제
- 관리자 화면 문턱 설정 UI — 계약서가 금지
- 모드 1 진단 — 범위 밖
- AI 이상탐지 연동 — §2-1 참조. 독립 축이다
