# 셀가드 B2B SaaS 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 셀가드 프로토타입의 기능과 사용자 흐름을 유지하면서, 현대적인 B2B SaaS 산업 안전 관제 디자인으로 재구성한다.

**Architecture:** 대상 HTML은 번들 로더와 압축된 UI 템플릿으로 구성되어 있다. 번들에서 템플릿을 안전하게 추출해 CSS/React UI를 변경한 뒤 같은 번들 형식으로 다시 삽입한다. UI 데이터·상태 전환·이벤트 핸들러는 보존하고, 시각 토큰과 주요 레이아웃만 바꾼다.

**Tech Stack:** 단일 HTML, React/Babel 번들, CSS, Node.js 압축 해제/재압축, 로컬 HTTP 렌더링 검증

## Global Constraints

- 대상은 `설계 산출물/헬가드 프로토타입_v2.html` 한 파일이며 기존 화면 수·텍스트·기능·흐름을 유지한다.
- 기본 표면은 쿨그레이·화이트, 브랜드는 네이비·블루, 초록·주황·빨강은 상태 표시용으로만 사용한다.
- 랜딩은 네이비 Hero, 로그인 후는 고정 사이드바 및 일관된 페이지 헤더 구조를 적용한다.
- 대시보드는 핵심 상황 → 전압·전류·온도·SOC → 대형 차트·이벤트/분석 순으로 구성한다.
- 기존 상호작용을 보존하고 데스크톱·모바일에서 렌더링을 확인한다.

---

### Task 1: 번들 템플릿 추출과 회귀 검증 기준 마련

**Files:**
- Modify: `설계 산출물/헬가드 프로토타입_v2.html`
- Create: `/private/tmp/cellguard-v2.template.html` (검증용 임시 파일, Git 미추적)
- Create: `/private/tmp/extract-cellguard-v2.mjs` (검증용 임시 스크립트, Git 미추적)

**Interfaces:**
- Consumes: HTML의 `script[type="__bundler/manifest"]`, `script[type="__bundler/template"]`
- Produces: 재삽입 가능한 템플릿 문자열과 변경 후 정적 검사 기준

- [ ] **Step 1: 추출 실패 테스트를 작성한다**

`/private/tmp/extract-cellguard-v2.mjs`에서 manifest/template 존재 여부와 gzip 해제 결과에 `<!DOCTYPE html>` 및 `ReactDOM`이 포함되는지를 검사한다.

```js
if (!manifestEl || !templateEl) throw new Error('bundle manifest/template missing');
if (!template.includes('<!DOCTYPE html>') || !template.includes('ReactDOM')) {
  throw new Error('unexpected UI template');
}
```

- [ ] **Step 2: 추출 검증이 현재 파일에서 통과하는지 확인한다**

Run: `node /private/tmp/extract-cellguard-v2.mjs '설계 산출물/헬가드 프로토타입_v2.html'`

Expected: `template extracted` 및 임시 템플릿 파일 생성

- [ ] **Step 3: 추출·재삽입 스크립트를 구현한다**

압축된 asset을 `zlib.gunzipSync()`로 해제하고, 수정한 템플릿을 UTF-8 gzip/base64로 같은 manifest entry에 재삽입한다. manifest의 다른 asset 및 로더 코드는 변경하지 않는다.

```js
const source = fs.readFileSync(input, 'utf8');
const manifest = JSON.parse(manifestText);
const entry = Object.values(manifest).find((item) => item.mime === 'text/html');
entry.data = zlib.gzipSync(Buffer.from(template, 'utf8')).toString('base64');
entry.compressed = true;
```

- [ ] **Step 4: 재삽입 후 정적 검증을 통과시킨다**

Run: `node /private/tmp/extract-cellguard-v2.mjs '설계 산출물/헬가드 프로토타입_v2.html'`

Expected: `template extracted` 및 템플릿에서 기존의 `route`, `setState`, `relayModal`, `eventsList` 문자열 확인

- [ ] **Step 5: 작업 단위 커밋을 만든다**

```bash
git add '설계 산출물/헬가드 프로토타입_v2.html'
git commit -m 'chore: validate CellGuard prototype bundle'
```

### Task 2: 브랜드 토큰과 공통 SaaS 셸 적용

**Files:**
- Modify: `설계 산출물/헬가드 프로토타입_v2.html` (번들 내 템플릿의 전역 CSS 및 공통 레이아웃)

**Interfaces:**
- Consumes: Task 1의 추출·재삽입 절차
- Produces: `--navy`, `--blue`, `--surface`, `--canvas`, `--text` CSS 토큰과 공통 페이지 헤더/사이드바 스타일

- [ ] **Step 1: 기존 웜 컬러 사용을 탐지하는 실패 검사를 작성한다**

추출된 템플릿에서 전역 body 배경에 `#FAF8F4` 및 기본 본문 텍스트에 `#2A251F`가 남아 있는지 검사한다.

```js
if (template.includes('body { background: #FAF8F4')) {
  throw new Error('warm canvas token remains');
}
```

- [ ] **Step 2: 변경 전 검사 실패를 확인한다**

Run: `node /private/tmp/check-cellguard-theme.mjs /private/tmp/cellguard-v2.template.html`

Expected: FAIL with `warm canvas token remains`

- [ ] **Step 3: 전역 토큰과 공통 레이아웃을 구현한다**

```css
:root { --navy:#071a35; --blue:#0d57bd; --canvas:#eef2f7; --surface:#fff; --text:#172033; --muted:#63748c; --line:#dbe5f0; }
body { background:var(--canvas); color:var(--text); }
.app-shell { background:var(--canvas); }
.sidebar { background:var(--navy); }
```

랜딩 Hero에만 낮은 대비의 격자·파형 배경을 추가하고, 페이지 헤더의 제목·설명·주요 버튼 위치를 모든 로그인 후 화면에 공통 적용한다.

- [ ] **Step 4: 토큰 검사를 통과시킨다**

Run: `node /private/tmp/check-cellguard-theme.mjs /private/tmp/cellguard-v2.template.html`

Expected: PASS with `cool SaaS theme tokens verified`

- [ ] **Step 5: 작업 단위 커밋을 만든다**

```bash
git add '설계 산출물/헬가드 프로토타입_v2.html'
git commit -m 'style: apply CellGuard SaaS visual system'
```

### Task 3: 대시보드 정보 위계와 데이터 시각화 재구성

**Files:**
- Modify: `설계 산출물/헬가드 프로토타입_v2.html` (번들 내 dashboard JSX/CSS)

**Interfaces:**
- Consumes: 기존 `volt`, `curr`, `temp`, `soc`, `score`, `relayActionLabel`, `eventsList`, `trendCharts` 상태/데이터
- Produces: `dashboard-priority-layout`의 핵심 상황·핵심 지표·추세/이벤트 섹션

- [ ] **Step 1: 대시보드 구조 실패 검사를 작성한다**

새 레이아웃 식별자와 4개 핵심 수치, 추세 밴드가 모두 존재하는지 확인한다.

```js
for (const marker of ['dashboard-priority-layout', '현재 연결된 배터리', '핵심 지표 추세', 'status-band']) {
  if (!template.includes(marker)) throw new Error('missing dashboard marker: ' + marker);
}
```

- [ ] **Step 2: 변경 전 검사 실패를 확인한다**

Run: `node /private/tmp/check-cellguard-dashboard.mjs /private/tmp/cellguard-v2.template.html`

Expected: FAIL with `missing dashboard marker: dashboard-priority-layout`

- [ ] **Step 3: 대시보드 JSX와 CSS를 구현한다**

기존 데이터·버튼 핸들러를 유지한 채 작은 카드 군을 다음 구조로 교체한다.

```jsx
<section className="dashboard-priority-layout">
  <section className="critical-status">{/* connected battery, score, relay action */}</section>
  <section className="metric-grid">{/* volt, curr, temp, soc */}</section>
  <section className="analysis-grid">{/* large trend chart, recent events, analysis entry */}</section>
</section>
```

차트에는 `.status-band.normal`, `.status-band.caution`, `.status-band.warning`, `.status-band.danger`를 배치해 상태 구간과 현재값/임계선/상승 추세를 함께 표시한다.

- [ ] **Step 4: 구조 검사 및 상태 데이터 보존 검사를 통과시킨다**

Run: `node /private/tmp/check-cellguard-dashboard.mjs /private/tmp/cellguard-v2.template.html`

Expected: PASS with `dashboard priority structure verified`

- [ ] **Step 5: 작업 단위 커밋을 만든다**

```bash
git add '설계 산출물/헬가드 프로토타입_v2.html'
git commit -m 'feat: prioritize CellGuard dashboard monitoring'
```

### Task 4: 상태/모션/반응형과 브라우저 검증

**Files:**
- Modify: `설계 산출물/헬가드 프로토타입_v2.html` (번들 내 CSS/JSX)

**Interfaces:**
- Consumes: Task 2 토큰, Task 3 섹션/기존 모달·필터·이벤트 상태
- Produces: 접속 상태 및 빈 상태 표현, 상태 강조, 160~220ms 모션, 모바일 단일열 레이아웃

- [ ] **Step 1: 상태·반응형 실패 검사를 작성한다**

```js
for (const marker of ['@media (max-width: 768px)', 'animation:', '연결 끊김', '데이터 없음', '측정 중']) {
  if (!template.includes(marker)) throw new Error('missing service state marker: ' + marker);
}
```

- [ ] **Step 2: 변경 전 검사 실패를 확인한다**

Run: `node /private/tmp/check-cellguard-states.mjs /private/tmp/cellguard-v2.template.html`

Expected: FAIL with at least one `missing service state marker`

- [ ] **Step 3: 상태와 모션을 구현한다**

필터 선택·카드 선택·상세 패널 등장에는 160~220ms `transform`/`opacity` 전환을 사용한다. 위험 발생 시 상단 위험 영역, 온도/점수 지표, 차트의 위험 구간, 관련 이벤트 행을 같은 위험 상태로 강조한다. 로딩·데이터 없음·연결 끊김·측정 중은 기존 데이터 흐름을 바꾸지 않는 표시 전용 상태로 넣는다.

- [ ] **Step 4: 정적 상태 검사를 통과시킨다**

Run: `node /private/tmp/check-cellguard-states.mjs /private/tmp/cellguard-v2.template.html`

Expected: PASS with `service states and responsive rules verified`

- [ ] **Step 5: 실제 브라우저 렌더링과 상호작용을 검증한다**

로컬 HTTP 서버에서 HTML을 열고 데스크톱·모바일 뷰포트를 확인한다. 대시보드 진입, 필터 변경, 이벤트 상세 패널 열기, 릴레이 확인 모달 열기와 닫기를 수행한다.

Expected: JavaScript 오류 없음, 대시보드 섹션·차트 밴드·상태 강조가 보이고 기존 상호작용이 동작함

- [ ] **Step 6: 최종 변경을 커밋한다**

```bash
git add '설계 산출물/헬가드 프로토타입_v2.html'
git commit -m 'feat: complete CellGuard SaaS prototype redesign'
```
