# 셀가드 앱 공통 컴포넌트 인라인 토큰 레시피 (그룹 3 확정)

그룹 4~6이 화면·모달을 in-place 토큰화할 때 **판단 없이 복사**하는 레시피다. 앱은 인라인 스타일이므로, 각 컴포넌트의 "금지색 인라인 → 토큰" 매핑을 여기서 못박는다. 모달·버튼은 그룹 3이 CSS 클래스로 추출했으므로 클래스를 쓰고, 나머지는 아래 인라인 레시피를 따른다.

## 공통 규칙 (그룹 1·2 승계)

- 금지색(`#6B7280 #E5E7EB #F9FAFB #F3F4F6 #4B5563 #9CA3AF #374151 #111827 #D1D5DB #EEF0F3`)은 전부 토큰으로 교체한다.
- 뉴트럴 매핑: 진한 텍스트 `#111827`→`var(--ink)`, 본문 텍스트 `#374151`/`#4B5563`→`var(--ink-2)`, 뮤트 텍스트 `#6B7280`/`#9CA3AF`→`var(--ink-3)`, 보더·구분선 `#E5E7EB`/`#F3F4F6`/`#F9FAFB`→`var(--border)`, 옅은 배경면 `#F9FAFB`→`var(--bg-base)`.
- radius: `16px`/`18px`/`22px`→`var(--r-panel)`(큰 패널·히어로) 또는 `var(--r-card)`(일반 카드) — 카드는 `--r-card`, 히어로/대형 패널은 `--r-panel`. `9px`/`10px`/`11px`→`var(--r-card)`. `6px`/`7px`/`8px`(작은 칩·아이콘 타일)→`var(--r-card)`. `50%`/`99px`/`999px`→`var(--r-pill)`.
- SVG 속성(`stroke=`/`fill=`)은 `var()` 불가 → hex 유지, 토큰과 동일 값(뉴트럴 `#141719`/`#8B9099`, 상태 `#16A34A`/`#D97706`/`#EA580C`/`#DC2626`). `currentColor`는 부모 `color` 상속이므로 그대로.
- 간격 스케일 8/12/16px 중심(관제 밀도). 모든 수치에 `font-variant-numeric:tabular-nums`.
- 글래스는 크롬(사이드바·상단바·모달 오버레이)에만. **본문 카드·테이블·차트는 불투명**(`.cg-surface`). 인라인 `backdrop-filter`·`class="cg-glass"`를 본문에 넣지 않는다(린터 `glass_misuse`가 강제).
- 스크롤은 메인 컬럼이 담당(그룹 2). 화면 컴포넌트에 자체 `overflow:auto`를 넣지 않는다(모달 패널 내부 스크롤은 예외).

## 카드 — `.cg-surface` 재사용

뉴트럴 흰 카드는 스킨 3속성을 클래스로 치환하고 레이아웃은 인라인으로 남긴다.

- Before: `style="background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:20px;display:flex;..."`
- After: `class="cg-surface" style="padding:20px;display:flex;..."` (skin 3속성 제거, 나머지 레이아웃 유지. `16px`는 `.cg-surface`의 `--r-card`로 흡수)

상태 틴트 미니 카드(대시보드 V/A/T/SOC 등)는 `.cg-surface`가 아니라 저알파 상태 배경을 유지하되 뉴트럴만 토큰화한다:
- 정상 계열: `background:rgba(22,163,74,.1);border:1px solid rgba(22,163,74,.22)` 유지, 내부 텍스트 뉴트럴만 토큰화.
- 경고 온도 계열: `background`/`border`에 `rgba(234,88,12,...)` 유지, 값 텍스트 `color:#EA580C`(=`--alert`) 유지.
- 다크 히어로 카드(대시보드 상단 `linear-gradient(125deg,#171E30,...)`)는 그룹 4 대시보드에서 별도로 다룬다(라이트 서피스 전환 여부는 그룹 4 화면 판단). 이 레시피 범위 밖.

## 테이블 (CSS grid — `<table>` 아님)

관리자 유저/감사 로그 등은 `display:grid;grid-template-columns:...`로 된 표다.

- 헤더 행: `color:var(--ink-3);font-weight:700;font-size:12px;` + 하단 구분선 `border-bottom:1px solid var(--border)`.
- 본문 행: 행 구분선 `border-bottom:1px solid var(--border)`. 셀 값 `color:var(--ink)`(주요)·`color:var(--ink-2)`(보조).
- **위험(danger) 등급 행만** 낮은 채도 상태 배경: `background:rgba(220,38,38,.06)`. 주의/경고/정상 행은 배경 없음(과다 채색 금지).
- 컨테이너: `.cg-surface`로 감싼다.
- 모바일: 표를 카드 목록/상세로 전환(그룹 7 반응형에서 처리).

## 게이지 (SVG 아크 + JS 계산색)

- 컨테이너: `.cg-surface`.
- 아크 **트랙**(배경 호): 다크 카드용 `stroke="rgba(255,255,255,.12)"`를 라이트 서피스에선 **`stroke="rgba(20,23,25,.1)"`**로. (SVG 속성이라 `var()` 불가, `--border`보다 약간 진하게 해 트랙이 보이게.)
- 아크 **값**(전경 호): `stroke="{{ scoreColor }}"` 유지 — JS가 4단계 상태 hex를 넣는다(그룹 1에서 정합 완료: 정상 `#16A34A`/주의 `#D97706`/경고 `#EA580C`/위험 `#DC2626`).
- 점수 숫자: `color:var(--ink)` + `font-variant-numeric:tabular-nums`. 등급 라벨: `color:{{ scoreColor }}`(JS).
- 밴드 범례 칩(정상/주의/경고/위험): 저알파 상태 배경 + 상태 텍스트 유지(예 `background:rgba(22,163,74,.16);color:#15803D`), 반경 `6px/7px`→`var(--r-card)`.

## 차트 (SVG 라인/면적)

- 컨테이너: `.cg-surface`.
- **격자선**: `<line ... stroke="#F3F4F6">`(금지색)를 **`stroke="#ECEAE8"`**로. (`--border`=`rgba(20,23,25,.08)`를 흰 서피스 위에 렌더한 SVG-safe hex. `var()` 불가.)
- **추세선**: `stroke="{{ color }}"` = 상태색 hex 유지(정적 스파크라인은 지표색 hex 유지 — V `#16A34A`/A `#0EA5E9`/T `#EA580C`/SOC `#7C3AED`).
- **면적 채움**: 선 상태색의 **`.08` 알파**(예 추세선이 `#EA580C`면 `fill="rgba(234,88,12,.08)"`). JS 계산값(`{{ dChartFill }}`)이면 JS가 이 알파를 내도록 한다.
- 축 라벨: `color:var(--ink-3)`.

## 배지 (형태는 인라인, 색은 상태/템플릿)

- 형태 레시피: `font-size:11px;font-weight:700;padding:3px 9px;border-radius:var(--r-pill);` (+ 숫자 포함 시 `font-variant-numeric:tabular-nums`). `99px`→`var(--r-pill)`.
- 정적 상태 배지(텍스트/배경 쌍, 금지색 아님 → 유지):
  - 정상: `color:#16A34A;background:#E9F8EE` (또는 `#DCFCE7`)
  - 주의: `color:#D97706;background:#FEF3C7`
  - 경고: `color:#EA580C;background:#FEECEC` (또는 흰 텍스트 `color:#fff;background:#EA580C`)
  - 위험: `color:#DC2626;background:#FEECEC`
  - 브랜드/정보: `color:var(--brand);background:#EAF1FF`
- 템플릿 계산색 배지(`color:{{ x.col }};background:{{ x.bg }}`)는 형태만 토큰화(`border-radius`), 색은 JS 그대로. JS가 위 상태 쌍을 내도록 그룹 4~6에서 확인.

## 탭 · 필터 (선택=브랜드 한정)

- 형태 레시피: `font-size:12px;font-weight:600;padding:5px 11px;border-radius:var(--r-card);cursor:pointer;`. `8px`→`var(--r-card)`.
- 비선택: `color:var(--ink-2);background:var(--surface);border:1px solid var(--border);` — hover 시 `background:rgba(20,23,25,.04)`.
- 선택: `color:#fff;background:var(--brand-grad);border:1px solid transparent;` (또는 브랜드 틴트 `color:var(--brand);background:#EAF1FF;border:1px solid #BFD3FF`). **선택 강조는 브랜드로만**(상태색으로 선택 표시 금지).
- 템플릿 계산색 탭(`background:{{ b.bg }};color:{{ b.col }};border:{{ b.bd }}`)은 JS가 위 값을 내도록 그룹 4~6에서 확인.

## 버튼 — `.cg-btn-*` 클래스 (그룹 3)

- 주요: `class="cg-btn-primary"` (브랜드 그라데이션, 흰 텍스트).
- 보조(뉴트럴 아웃라인): `class="cg-btn-ghost"`.
- 위험 액션(릴레이 차단 등): `class="cg-btn-danger"`.
- 브랜드-틴트 보조(예 "정보 수정")는 클래스가 아닌 인라인: `color:var(--brand);border:1px solid #CFE0FF;background:#F5F9FF;` + 버튼 공통(`font-size:14px;font-weight:700;padding:13px;border-radius:var(--r-card);text-align:center;cursor:pointer`).
- 버튼을 한 행에 나란히 둘 때 각 버튼에 `style="flex:1;"`를 인라인으로 얹는다(레이아웃은 클래스에 없음).

## 모달 — `.cg-modal-*` 골격 (그룹 3)

17개 모달을 아래 골격으로 통일한다. 정본은 제네릭 상세 모달(그룹 3 Task 2)이다.

```html
<div sc-camel-on-click="{{ closeX }}" class="cg-modal-overlay">
  <div class="cg-modal" [sc-camel-on-click="{{ stop }}"] [style="width:560px;"]>
    <div class="cg-modal-head">
      <div ...제목/아이콘...><div class="cg-modal-title">{{ title }}</div>...</div>
      <span sc-camel-on-click="{{ closeX }}" class="cg-modal-close"><svg .../></span>
    </div>
    ...본문(인라인 토큰 레시피 적용)...
    <div class="cg-modal-actions">
      <span sc-camel-on-click="{{ closeX }}" class="cg-btn-ghost" style="flex:1;">취소</span>
      <span sc-camel-on-click="{{ save }}" class="cg-btn-primary" style="flex:1;">저장</span>
    </div>
  </div>
</div>
```

- 오버레이 z-index는 클래스가 `100`으로 고정(랜딩 nav 50·드롭다운 30 위). 개별 모달의 기존 `z-index:40~48`은 클래스로 흡수되어 사라진다.
- 패널 기본 width 480px. 더 넓은 모달은 `style="width:520px;"`/`"width:560px;"`로 인라인 오버라이드. gap/padding이 다르면 인라인으로 오버라이드.
- **stop-propagation**: 패널 클릭이 닫히면 안 되는 모달(대부분)은 패널에 `sc-camel-on-click="{{ stop }}"`를 **원래 있던 그대로 유지**한다. 제네릭 상세 모달처럼 원래 stop이 없던 모달은 추가하지 않는다(동작 무회귀).
- 폼 입력(`<input>`/`<select>`): `border:1px solid var(--border);border-radius:var(--r-card);background:var(--bg-base);color:var(--ink);` (금지색 `#E5E7EB`/`#F9FAFB`/`#111827`/`#374151` 정합). placeholder 아이콘 `stroke="#9CA3AF"`→`#8B9099`.
