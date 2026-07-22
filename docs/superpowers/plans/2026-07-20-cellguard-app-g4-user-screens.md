# 셀가드 앱 리디자인 — 그룹 4: 일반 사용자 화면 11 (대시보드~설정) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 일반 사용자 11개 화면(대시보드·디바이스·배터리 자산·배터리 상세·이상탐지·추세·이벤트·알림센터·공지·릴레이·설정)의 본문 마크업을 그룹 1~3에서 확정한 웜 뉴트럴 라이트 글래스 체계로 in-place 토큰화한다. 각 화면의 금지색(차가운 Tailwind 팔레트)·비허용 반경을 그룹 3 레시피가 못박은 토큰으로 교체하고, 뉴트럴 흰 카드를 `.cg-surface`로 치환한다. 라우팅·상태·예시 데이터·버튼 동작·카피·모달 정의는 **일절 건드리지 않는다**.

**Architecture:** 대상은 23MB 번들(`설계 산출물/셀가드 프로토타입_v3.html`)이며 실제 마크업은 JSON 문자열 한 줄 안에 있다. 편집은 `python3 tools/bundle_io.py unpack/pack` 왕복으로만 한다. 11개 화면은 모두 `<!-- ===== NAME ===== -->` 주석과 `<sc-if value="{{ isX }}">` 로 시작하는 블록이며, 각 `isX` 앵커는 문서 전체에서 **정확히 1회**만 등장한다(검증 완료). 앱은 인라인 스타일로 짜여 있고 테이블은 `<table>`이 아니라 CSS `grid`, 배지·탭 색은 템플릿 계산값(`{{ b.bg }}`)이다. 따라서 이 그룹은 **색·보더·반경·글래스 구조만** 바꾸고 레이아웃·구조·템플릿 바인딩은 유지한다.

**Tech Stack:** HTML/CSS 인라인 스타일 + `.cg-*` 클래스, `sc-camel`/`x-dc` 템플릿, Pretendard, Python 3(도구·검증).

**실행 모델:** 이 플랜은 **Sonnet 5**가 실행한다. 각 태스크는 (1) 아래 **마스터 치환 사전**(Global Constraints)의 번호를 인용하고 (2) 화면별 카드 스킨 교체 프래그먼트를 verbatim 제공하며 (3) `check_region == []` + `glass_misuse == []` 로 기계 게이트한다. 설계 판단(어떤 금지색이 어떤 토큰으로 가는지, 어떤 반경이 어디로 스냅되는지)은 전부 마스터 사전과 그룹 3 레시피 문서에 미리 확정돼 있다. **단 하나의 사전 판단 지점**(다크 히어로 3개의 라이트 전환 여부)만 아래 "결정 필요" 절에서 옵션·권고와 함께 명시하며, 해당 태스크(1·8·10) 상단에 재경고한다. 실행자는 그 외 어떤 색·반경·간격도 스스로 결정하지 않는다.

## Global Constraints

스펙 `docs/superpowers/specs/2026-07-19-cellguard-app-screens-light-glass-design.md`와 그룹 1·2·3 계약에서 그대로 가져온다. **모든 태스크에 적용된다.**

- 대상 파일 `설계 산출물/셀가드 프로토타입_v3.html`은 **git 추적 대상이 아니다**(`.gitignore`의 `설계 산출물/`). 되돌리기가 불가능하므로 그룹 시작 시(Task 1 Step 1) 백업한다. 커밋은 도구/문서만 이동하는 마커다(번들 자체는 커밋되지 않음).
- 실제 마크업은 JSON 문자열 한 줄 안에 있다. **손으로 편집하지 않는다.** `python3 tools/bundle_io.py unpack/pack`으로만 편집한다. 202번 줄 base64 자산 매니페스트는 절대 건드리지 않는다.
- `bundle_io.pack`은 마크업 내 `</`를 `<\/`로 이스케이프한다(브라우저 HTML 파서의 스크립트 조기 종료 방지). 이 처리를 우회하지 않는다.
- **왕복 검증(unpack diff)은 브라우저 렌더를 보장하지 않는다.** readlines 기반이라 HTML 파서 경로를 안 탄다. 이 그룹의 브라우저 렌더 확인은 **최종 Task 12** 한 번으로 통합한다(사유는 "브라우저 검증 방식" 절 참조).
- **SVG 속성에는 `var()`가 작동하지 않는다.** `stroke="..."`, `fill="..."`처럼 값이 SVG presentation **속성**에 직접 들어가면 CSS 변수는 무시된다. 이 경로는 **hex 문자열을 유지**하되 토큰과 **동일 값**으로 맞춘다: `--ink`=`#141719`, `--ink-3`=`#8B9099`, `--ok`=`#16A34A`, `--warn`=`#D97706`, `--alert`=`#EA580C`, `--danger`=`#DC2626`, 차트 격자선=`#ECEAE8`. 반대로 CSS **프로퍼티**(`color:`/`background:`/`border:`/`border-radius:` 등)에는 `var(--token)`을 쓴다.
- 라우팅·상태·예시 데이터·버튼 동작(`sc-camel-on-click`)·카피 텍스트를 변경하지 않는다. 상태색 4단계 로직 정합(`scoreColor`/`scoreLabel`, 임계값 30/60/80)은 **그룹 1에서 이미 완료됐다 — 다시 만지지 않는다.**
- radius는 `12px`(`var(--r-card)`) / `20px`(`var(--r-panel)`) / `999px`(`var(--r-pill)`) 3개만 쓴다.
- 상태색 4개는 상태 표시에만 쓴다(장식 재사용 금지): `--ok`(정상)/`--warn`(주의)/`--alert`(경고)/`--danger`(위험).
- **절제적 글래스**: 글래스(`.cg-glass`/`backdrop-filter`)는 크롬(사이드바·상단바·모달)에만. **본문 화면(이 그룹 전체)에는 글래스를 넣지 않는다.** 화면 카드·테이블·차트는 불투명 `.cg-surface`. (조사 결과 11개 화면 모두 현재 `glass_misuse == []` — 이 그룹은 새 글래스를 유입시키지 않으므로 계속 `[]` 이어야 한다.)
- 금지 색(린터 `BANNED_COLORS`): `#6B7280 #E5E7EB #F9FAFB #F3F4F6 #4B5563 #9CA3AF #374151 #111827 #D1D5DB #EEF0F3`. 이 값들은 전부 아래 마스터 사전대로 토큰(또는 SVG-safe hex)으로 교체한다. 브랜드 틴트(`#EAF1FF`/`#BFD3FF`/`#CFE0FF`/`#F5F9FF`/`#93C5FD` 등)와 상태 틴트(`#E9F8EE`/`#DCFCE7`/`#FEF3C7`/`#FEECEC`/`#FEF7F5`/`#DBF0FB`/`#EADFFB` 등), 지표 hex(`#0EA5E9`/`#7C3AED`/`#16A34A`/`#EA580C`/`#D97706`/`#DC2626`/`#2563EB` 등), 다크 툴팁/차트 색(`#161C2C`/`#171E30` 등)은 **금지색이 아니므로 유지**한다.
- Python은 `python3`, 표준 라이브러리만. 의존성 추가 없음.

### 마스터 치환 사전 (그룹 3 레시피의 적용형 — 실행자는 이대로만 교체한다)

각 항목은 **문맥 한정 리터럴 문자열**이다. 각 태스크는 자기 화면 슬라이스 안에서 해당 항목을 `replace_all`(전량 교체)한다. 문맥이 한정돼 있어 같은 금지색이라도 역할별로 정확히 다른 값으로 간다. **게이트는 개수가 아니라 `check_region == []`** 이므로, 개수는 참고치이고 슬라이스 전량 교체 후 검증이 최종 판정이다.

**뉴트럴 텍스트 (CSS 프로퍼티):**
1. `color:#6B7280` → `color:var(--ink-3)`  (뮤트 텍스트)
2. `color:#9CA3AF` → `color:var(--ink-3)`  (뮤트 텍스트 — **다크 히어로 블록 예외**, "결정 필요" 참조)
3. `color:#4B5563` → `color:var(--ink-2)`  (본문 텍스트)
4. `color:#374151` → `color:var(--ink-2)`  (라벨 텍스트)
5. `color:#111827` → `color:var(--ink)`  (진한 값 텍스트)

**뉴트럴 보더·구분선·면 (CSS 프로퍼티):**
6. `#E5E7EB` → `var(--border)`  (항상 보더/구분선 색으로만 등장 — 카드 변환 후 남은 것 전부)
7. `border-bottom:1px solid #F9FAFB` → `border-bottom:1px solid var(--border)`  (행 구분선)
8. `background:#F9FAFB` → `background:var(--bg-base)`  (옅은 배경면)
9. `border:1px solid #F3F4F6` → `border:1px solid var(--border)`
10. `border-top:1px solid #F3F4F6` → `border-top:1px solid var(--border)`
11. `border-bottom:1px solid #F3F4F6` → `border-bottom:1px solid var(--border)`
12. `background:#F3F4F6` → `background:var(--border)`  (프로그레스 트랙·세그먼트 컨트롤 트랙 배경)
13. 인라인 hover 오브젝트: `'#F3F4F6'` → `'rgba(20,23,25,.04)'` **그리고** `'#F9FAFB'` → `'rgba(20,23,25,.04)'`  (비선택 상호작용 hover)

**SVG 속성 (hex 유지, `var()` 금지):**
14. `stroke="#F3F4F6"` → `stroke="#ECEAE8"`  (차트 격자선)
15. `stroke="#6B7280"` → `stroke="#8B9099"`  (뮤트 아이콘)
16. `stroke="#9CA3AF"` → `stroke="#8B9099"`  (플레이스홀더/뮤트 아이콘)
17. `stroke="#4B5563"` → `stroke="#8B9099"`  (2차 아이콘 — **레시피 미세 공백, 아래 주 참조**)

> **주 (항목 17):** 그룹 3 레시피의 SVG-뉴트럴 hex 집합은 `{#141719(--ink), #8B9099(--ink-3)}` 두 값뿐이다. `#4B5563`(중간 회색)은 CSS 텍스트에선 `--ink-2`로 가지만 SVG-safe `--ink-2` hex가 레시피에 정의돼 있지 않다. 이 3개(알림센터 디바이스 아이콘, 설정 SMS·푸시 아이콘)는 모두 회색 타일 안의 **2차/장식 아이콘**이고 옆 라벨이 뮤트(`--ink-3`)이므로, 레시피의 두 허용값 중 **뮤트 `#8B9099`** 로 확정한다. 새 값을 만들지 않고 레시피 집합 안에서 고른 것이다. (이 미세 선택은 최종 보고에 명시됨 — 사람이 `#141719`(더 진하게)로 바꾸려면 이 3곳만 조정.)

**반경 스냅 (border-radius 문맥 한정 — 허용 3단계로 스냅):**
- 12px 미만 및 16px 이하는 `--r-card`(12px)로, 18px·22px는 히어로/대형 패널이므로 `--r-panel`(20px)로, 원형(50%·99px)은 `--r-pill`(999px)로 스냅한다. 문맥 한정 문자열로만 교체(`width:16px`·`gap:16px` 등 비반경 값은 건드리지 않음):
18. `border-radius:16px` → `border-radius:var(--r-card)`
19. `border-radius:14px` → `border-radius:var(--r-card)`
20. `border-radius:13px` → `border-radius:var(--r-card)`
21. `border-radius:11px` → `border-radius:var(--r-card)`
22. `border-radius:10px` → `border-radius:var(--r-card)`
23. `border-radius:9px`  → `border-radius:var(--r-card)`
24. `border-radius:8px`  → `border-radius:var(--r-card)`
25. `border-radius:7px`  → `border-radius:var(--r-card)`
26. `border-radius:5px`  → `border-radius:var(--r-card)`  (**주: 아래 미세 공백**)
27. `border-radius:3px`  → `border-radius:var(--r-card)`  (**주: 아래 미세 공백**)
28. `border-radius:99px` → `border-radius:var(--r-pill)`
29. `border-radius:50%`  → `border-radius:var(--r-pill)`
30. `border-radius:18px` → `border-radius:var(--r-panel)`  (다크 히어로 영역에만 등장 — 라이트 전환 시 카드 변환으로 흡수, "결정 필요" 참조)
31. `border-radius:22px` → `border-radius:var(--r-panel)`  (대시보드 히어로 — 상동)

> **주 (항목 26·27):** `3px`(11×11 범례 색 스와치, 배터리 상세·추세)·`5px`(18×18 비교 체크박스, 추세)는 그룹 3 레시피의 반경 규칙(6px 이상만 명시)보다 작다. 허용 반경이 3단계뿐이므로 가장 가까운 `--r-card`(12px)로 스냅하는데, 작은 요소라 시각적으로 **거의 원형**이 된다(범례 사각→둥근 점, 체크박스 사각→둥근). 이는 3단계 반경 허용목록의 강제 결과이며 새 규칙이 아니다(레시피의 "작은 칩→r-card" 방향을 그대로 연장). 최종 보고에 명시 — 사람이 스와치를 사각으로 유지하려면 허용목록에 소형 반경을 추가하는 별도 결정이 필요.

### 카드 스킨 → `.cg-surface` 변환 규칙 (그룹 3 레시피 "카드" 절)

**뉴트럴 흰 카드**(여는 태그가 `background:#fff;border:1px solid #E5E7EB;border-radius:16px;` 로 시작하는 것)는 이 3속성을 제거하고 `class="cg-surface"`를 추가한다. 나머지 인라인 레이아웃(padding/display/flex/gap 등)은 그대로 둔다. 각 태스크는 자기 화면의 카드 여는 태그 before/after를 verbatim 제공한다. **주의:** 카드 변환을 색·반경 치환보다 **먼저** 수행한다(카드 안의 `#E5E7EB`/`16px`가 변환으로 제거되어 이중 처리되지 않도록).

- **동적/템플릿 보더 카드**(`border:1px solid {{ d.bd }}` 등) 또는 **비-흰 배경 카드**(`background:{{ p.selBg }}`, 상태 틴트 그라데이션)는 `.cg-surface`로 바꾸지 않는다. 대신 `background:#fff`가 있으면 `background:var(--surface)`로, `border-radius:16px`는 사전 항목 18로 스냅하고, 템플릿 bg/border는 유지한다.
- **상태 틴트 미니 카드**(대시보드 V/A/T/SOC, 이상탐지 KPI 등, `linear-gradient(...,#F0FDF4,...)` + 비금지 틴트 보더)는 틴트를 **유지**하고 반경만 스냅한다(사전 18). 내부 뉴트럴 텍스트만 사전대로 토큰화.

### 결정 필요 (사용자 승인 — 태스크 1·8·10에 영향)

**다크 히어로 3개의 라이트 전환 여부.** 그룹 3 레시피는 "다크 히어로 카드는 그룹 4 대시보드에서 별도로 다룬다(라이트 서피스 전환 여부는 그룹 4 화면 판단)"라며 이 결정을 **이 플랜으로 위임**했다. 대상은 (1) 대시보드 상단 히어로+게이지(`linear-gradient(125deg,#171E30,…)`), (2) 알림센터 요약 히어로(`linear-gradient(120deg,#161C2C,…)`), (3) 릴레이 배너(`background:#161C2C`)다. 세 곳 모두 **다크 배경 위 뮤트 텍스트 `#9CA3AF`(금지색)** 를 담고 있어, 라이트 전환 여부에 따라 `#9CA3AF`의 교체 대상이 달라진다.

- **옵션 A — 라이트 전환 (권고, 기본값).** 세 히어로를 `.cg-surface`(또는 `var(--surface)`) 라이트 면으로 바꾼다. `#9CA3AF`→`var(--ink-3)`, `#fff` 텍스트→`var(--ink)`, `rgba(255,255,255,.05~.16)` 보더/면→`var(--border)`/`var(--bg-base)`/`rgba(20,23,25,.1)`, 게이지는 레시피 게이지(트랙 `stroke="rgba(20,23,25,.1)"`, 점수 `var(--ink)`), 요약/밴드 칩의 다크용 밝은 상태 텍스트(`#FCA5A5`/`#FDBA74`/`#86EFAC`/`#FCD34D` 등)→라이트용 상태색(`#DC2626`/`#EA580C`/`#16A34A`/`#D97706`)로 교체. **근거:** 스펙 성공 기준("사이드바·상단바·본문·모달이 하나의 웜 라이트 체계로 읽힌다", "위험 상태만 상태색으로 눈에 띈다")과 그룹 2 사이드바 다크→라이트 전환 선례에 부합하며, 모든 값이 토큰/허용목록 안에 남는다.
- **옵션 B — 다크 유지.** 세 히어로를 의도된 대비 앵커로 남기고, 금지색 `#9CA3AF`만 비금지 라이트 뮤트(예 `rgba(255,255,255,.6)`)로 교체한다. **트레이드오프:** 최소 변경·관제 히어로의 강한 시선 앵커 유지 vs 라이트 글래스 체계에 다크 면이 섞임 + 온-토큰이 아닌 bespoke 값 도입.

**이 플랜은 옵션 A로 세 태스크를 작성한다**(레시피가 이 결정을 Group 4에 위임했고, 옵션 A만 온-토큰·온-허용목록으로 닫히며 스펙 성공 기준에 정합). 실행 전 컨트롤러/사용자가 옵션 B(다크 유지)를 원하면 태스크 1·8·10의 히어로 프래그먼트만 교체하면 된다. **이 결정을 확정 없이 실행하지 말 것.**

### 브라우저 검증 방식 (사전 판단 — 통합)

11개 화면 편집은 **순수 색·반경·클래스 치환**이라 새 태그(`</` 유입)를 만들지 않는다 — `</` 이스케이프 파서 회귀(랜딩에서 브라우저에서만 드러났던 버그)의 위험원이 이 그룹엔 없다. 또한 11개 화면이 모두 같은 번들·같은 실행 앱 안에서 좌측 내비로 오갈 수 있다. 따라서 그룹 3(마크업 편집 태스크가 1개뿐 → 태스크별 브라우저 확인)과 달리, 그룹 2(다부분 셸 작업을 **최종 1회 통합 브라우저 확인**)의 패턴을 따른다: 각 화면 태스크는 왕복 diff + `check_region==[]` + `glass_misuse==[]`(기계 검증)로 끝내고, **Task 12에서 로컬 서버를 한 번 띄워 11개 화면을 내비로 순회하며 렌더·콘솔 에러를 통합 확인**한다. 11회 서버 스핀업을 피하면서도 회귀를 최종에 포착한다.

### 그룹 1·2·3이 만든 계약 (재사용, 재정의 금지)

- **CSS 토큰**(`:root`에 이미 정의됨): `--bg-base:#F7F6F4` / `--surface:#FFFFFF` / `--ink:#141719` / `--ink-2:#5A6068` / `--ink-3:#8B9099` / `--border:rgba(20,23,25,.08)` / `--brand:#2563EB` / `--brand-2:#3B82F6` / `--brand-grad:linear-gradient(135deg,#3B82F6,#2563EB)` / `--ok:#16A34A` / `--warn:#D97706` / `--alert:#EA580C` / `--danger:#DC2626` / `--r-card:12px` / `--r-panel:20px` / `--r-pill:999px` / `--nav-*`.
- **CSS 클래스**(`<style>`에 이미 정의됨): `.cg-glass`(글래스 패널, 크롬 전용), `.cg-surface`(불투명 서피스 = 카드), `.cg-modal-overlay`/`.cg-modal`/`.cg-modal-head`/`.cg-modal-title`/`.cg-modal-close`/`.cg-modal-actions`(모달 골격), `.cg-btn-primary`/`.cg-btn-ghost`/`.cg-btn-danger`(버튼). **그룹 4는 화면 본문만 다루므로 모달/버튼 클래스는 이 그룹에서 새로 적용하지 않는다**(모달은 그룹 6). 화면에서 쓰는 클래스는 `.cg-surface`뿐.
- **린터**: `landing_lint.check_region(region)`(금지색·비허용 반경·도트·이모지·지어낸 지표), `landing_lint.glass_misuse(region)`(본문 글래스 오남용), `landing_lint.app_region(markup)`. **그룹 4는 린터를 수정하지 않는다** — 검증 호출만 한다.
- **셸 스크롤 계약**(그룹 2): 스크롤은 메인 컬럼(`overflow:auto`), 상단바 `position:sticky;top:0;z-index:20`, 알림 드롭다운 `z-index:30`. **그룹 4의 화면은 자체 `overflow:auto`를 새로 넣지 않는다**(현재 화면들엔 없음 — 유지). 화면 내부 드롭다운(배터리 자산 모드 필터 `z-index:30`, 추세 비교 드롭다운 `z-index:20`)은 기존 값 유지.
- **상태 등급 4단계**(그룹 1 완료): 임계값 30/60/80, `scoreColor`/`scoreLabel` JS 정합 완료. **재작업 금지.**
- **모달 오버레이 z-index 100**(그룹 3): 화면의 `sc-camel-on-click` 모달 트리거는 그대로 두고 모달 정의는 건드리지 않는다(그룹 6).

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `설계 산출물/셀가드 프로토타입_v3.html` | 대상 번들. 11개 화면 본문 마크업(`<!-- ===== NAME ===== -->` 블록)의 색·반경·카드 스킨을 토큰화 | 수정 |
| `tools/bundle_io.py` | 번들 왕복 도구. **변경 없음**, 재사용만 | 재사용 |
| `tools/landing_lint.py` | 구간 린터(`check_region`/`glass_misuse`/`app_region`). **변경 없음**, 검증에 호출만 | 재사용 |
| `docs/superpowers/references/2026-07-20-cellguard-app-component-recipes.md` | 그룹 3 레시피. **변경 없음**, 매핑 출처로 참조만 | 재사용 |

> **앵커 재확인:** 줄 번호는 편집으로 이동한다. 각 태스크는 화면의 `<sc-if value="{{ isX }}">` 앵커(문서 전체 1회, 검증 완료)로 슬라이스를 찾는다. 슬라이스 경계는 `<!-- ===== 다음화면 ===== -->` 주석이다. 편집 전 `python3 tools/bundle_io.py unpack ... | grep -c 'value="{{ isX }}"'` 가 `1`인지 확인한다.

### 각 태스크 공통 절차 (반복 — 태스크 본문에서는 화면 고유 부분만 기술)

각 화면 태스크는 다음 6스텝을 따른다. **Step A~F**로 표기하고, 태스크 본문은 Step B(카드 프래그먼트)·Step C(적용 사전 항목)·화면 고유 주의만 채운다.

- **Step A — 꺼내기:** `python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_g4_<screen>.html` (그룹 첫 태스크는 그 전에 `backup`).
- **Step B — 카드 스킨 변환:** 태스크가 나열한 카드 여는 태그 before→after를 그대로 교체(색·반경 치환보다 먼저).
- **Step C — 사전 치환:** 태스크가 지정한 마스터 사전 항목을 **이 화면 슬라이스 안에서만** 전량 교체. (편집 도구가 슬라이스 스코프를 못 주면, 문맥 한정 문자열이라 문서 전역 교체해도 무방 — 단 다른 화면·모달·랜딩에도 같은 문자열이 있으므로, 안전하게는 슬라이스만. 아래 검증이 최종 게이트.)
- **Step D — 되쓰기 + 왕복:** `pack < /tmp/cg_g4_<screen>.html` → `unpack > verify` → `diff` 무차이(`왕복 OK`).
- **Step E — 린터 게이트:** 아래 파이썬으로 이 화면 슬라이스의 `check_region == []` **AND** `glass_misuse == []` 를 확인(+ 랜딩 무회귀 `landing_lint.py` exit 0).
- **Step F — 커밋:** 태스크가 지정한 `design(app-g4): <screen>` 메시지로 `git commit --allow-empty`.

**Step E 검증 스니펫(화면 마커만 태스크별로 교체):**
```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 - <<'PY'
import sys; sys.path.insert(0,'tools')
import bundle_io, landing_lint
m = bundle_io.unpack("설계 산출물/셀가드 프로토타입_v3.html")
A="<!-- ===== 시작마커 ===== -->"; B="<!-- ===== 끝마커 ===== -->"
reg=m[m.find(A):m.find(B)]
cr=landing_lint.check_region(reg); gm=landing_lint.glass_misuse(reg)
print("check_region:", cr if cr else "[] 통과")
print("glass_misuse:", gm if gm else "[] 통과")
assert cr==[], "금지색/비허용 반경 잔존"
assert gm==[], "본문 글래스 유입"
print("화면 검증 통과")
PY
python3 tools/landing_lint.py "설계 산출물/셀가드 프로토타입_v3.html"
```

---

### Task 1: DASHBOARD (대시보드)  ⚠️ 다크 히어로 결정 필요 — 옵션 A로 작성

**Files:** Modify `설계 산출물/셀가드 프로토타입_v3.html` — `<!-- ===== DASHBOARD ===== -->` ~ `<!-- ===== DEVICES ===== -->`.

**앵커:** `<sc-if value="{{ isDashboard }}">` (1회). 슬라이스 끝: `<!-- ===== DEVICES ===== -->`.

> ⚠️ 이 태스크는 Global Constraints "결정 필요"의 **다크 히어로(대시보드 상단 게이지 히어로)** 를 포함한다. 아래는 **옵션 A(라이트 전환)**. 옵션 B(다크 유지)를 승인받았으면 Step B-1만 옵션 B 프래그먼트로 교체하고 나머지는 동일.

**적용 컴포넌트(레시피):** 카드(`.cg-surface`) · 게이지(SVG 아크, 라이트) · 상태 틴트 미니 카드 · 차트(SVG 라인, 격자선/축) · 배지(공지 카테고리).

- [ ] **Step A** — unpack (그룹 첫 태스크: 먼저 `python3 tools/bundle_io.py backup "설계 산출물/셀가드 프로토타입_v3.html"`).
```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py backup "설계 산출물/셀가드 프로토타입_v3.html"
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_g4_dashboard.html
```

- [ ] **Step B-1 — 다크 히어로 컨테이너 → 라이트(옵션 A)**

Before (히어로 여는 div + 레드 글로우 블롭 + 좌측 텍스트 컬럼 헤더의 다크 전용 값):
```html
          <div style="background:linear-gradient(125deg,#171E30,#232B42 62%,#263050);border-radius:22px;padding:26px 28px;display:grid;grid-template-columns:1fr 300px;gap:26px;position:relative;overflow:hidden;">
            <div style="position:absolute;top:-60px;right:170px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(220,38,38,.18),transparent 70%);"></div>
```
After (라이트 서피스 + 레드 글로우는 저알파로 유지, 반경 스냅):
```html
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-panel);padding:26px 28px;display:grid;grid-template-columns:1fr 300px;gap:26px;position:relative;overflow:hidden;">
            <div style="position:absolute;top:-60px;right:170px;width:260px;height:260px;border-radius:var(--r-pill);background:radial-gradient(circle,rgba(220,38,38,.10),transparent 70%);"></div>
```

- [ ] **Step B-2 — 히어로 텍스트/버튼 다크 전용 색 → 라이트**

이 히어로 블록(위 컨테이너 ~ 게이지 카드 닫힘까지) 안에서 다음을 교체한다. **다크 배경이 사라지므로 `#fff`/밝은 뮤트는 라이트 잉크로 간다** (사전 항목 2는 이 블록에선 아래 규칙이 우선):
- `color:#fff` (히어로 내 텍스트 — connectedId, bTitle, 워드마크성 텍스트) → `color:var(--ink)`
- `color:#9CA3AF` (connectedModel, bDesc, curScore 라벨) → `color:var(--ink-3)`
- "배터리 변경" 버튼: `color:#fff;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:10px` → `color:var(--brand);background:#EAF1FF;border:1px solid #BFD3FF;border-radius:var(--r-card)`
- 릴레이 차단 버튼(위험 액션)은 상태색 유지: `color:#fff;background:#DC2626` 유지, `border-radius:11px`→`var(--r-card)`. 보조 차단 버튼 `background:rgba(220,38,38,.16);border:1px solid rgba(220,38,38,.36)` 유지(상태 틴트), `border-radius:11px`→`var(--r-card)`.
- 게이지 카드 컨테이너 `background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:18px` → `background:var(--bg-base);border:1px solid var(--border);border-radius:var(--r-card)` (히어로 안 서브 패널이므로 r-card).
- `toAnomaly` 링크 `color:#93B4EA` → `color:var(--brand)`.

- [ ] **Step B-3 — 게이지 SVG(다크→라이트, 레시피 게이지)**

Before (게이지 트랙 + 점수 숫자):
```html
                <svg width="230" height="129" sc-camel-view-box="0 0 200 110"><path d="M10,100 A90,90 0 0 1 190,100" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="16" stroke-linecap="round"></path><path d="M10,100 A90,90 0 0 1 190,100" fill="none" stroke="{{ dScoreColor }}" stroke-width="16" stroke-linecap="round" stroke-dasharray="{{ dScoreDash }}"></path></svg>
                <div style="position:absolute;left:0;right:0;top:38px;"><div style="font-size:68px;font-weight:800;color:#fff;letter-spacing:-.04em;font-variant-numeric:tabular-nums;line-height:1;">{{ dScore }}</div><div style="font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:{{ dScoreColor }};margin-top:4px;">{{ dScoreLabel }}</div></div>
```
After (트랙 라이트 hex, 점수 잉크; 전경 아크·라벨은 `{{ dScoreColor }}` JS 상태색 유지):
```html
                <svg width="230" height="129" sc-camel-view-box="0 0 200 110"><path d="M10,100 A90,90 0 0 1 190,100" fill="none" stroke="rgba(20,23,25,.1)" stroke-width="16" stroke-linecap="round"></path><path d="M10,100 A90,90 0 0 1 190,100" fill="none" stroke="{{ dScoreColor }}" stroke-width="16" stroke-linecap="round" stroke-dasharray="{{ dScoreDash }}"></path></svg>
                <div style="position:absolute;left:0;right:0;top:38px;"><div style="font-size:68px;font-weight:800;color:var(--ink);letter-spacing:-.04em;font-variant-numeric:tabular-nums;line-height:1;">{{ dScore }}</div><div style="font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:{{ dScoreColor }};margin-top:4px;">{{ dScoreLabel }}</div></div>
```

- [ ] **Step B-4 — 밴드 범례 칩(다크용 밝은 텍스트 → 라이트 상태 텍스트)**

Before:
```html
              <div style="display:flex;width:100%;gap:5px;"><div style="flex:1;text-align:center;background:rgba(22,163,74,.16);color:#86EFAC;font-size:10px;font-weight:700;padding:5px 0;border-radius:7px;">{{ T.band0 }}</div><div style="flex:1;text-align:center;background:rgba(217,119,6,.16);color:#FCD34D;font-size:10px;font-weight:700;padding:5px 0;border-radius:7px;">{{ T.band40 }}</div><div style="flex:1;text-align:center;background:rgba(220,38,38,.2);color:#FCA5A5;font-size:10px;font-weight:700;padding:5px 0;border-radius:7px;">{{ T.band70 }}</div></div>
```
After (저알파 상태 배경 유지, 텍스트를 라이트용 상태색으로; 반경 r-card):
```html
              <div style="display:flex;width:100%;gap:5px;"><div style="flex:1;text-align:center;background:rgba(22,163,74,.16);color:#16A34A;font-size:10px;font-weight:700;padding:5px 0;border-radius:var(--r-card);">{{ T.band0 }}</div><div style="flex:1;text-align:center;background:rgba(217,119,6,.16);color:#D97706;font-size:10px;font-weight:700;padding:5px 0;border-radius:var(--r-card);">{{ T.band40 }}</div><div style="flex:1;text-align:center;background:rgba(220,38,38,.2);color:#DC2626;font-size:10px;font-weight:700;padding:5px 0;border-radius:var(--r-card);">{{ T.band70 }}</div></div>
```

- [ ] **Step B-5 — 커넥티드 아이콘 타일 반경**: 히어로 좌상단 `width:34px;height:34px;border-radius:10px;background:#EAF1FF` → `border-radius:var(--r-card)` (사전 22). (브랜드 틴트 배경 유지.)

- [ ] **Step B-6 — 뉴트럴 흰 카드 3개 → `.cg-surface`** (히어로 아래: 추세 차트 카드, 공지 카드; "빠른 추세" 라벨 행 자체는 카드 아님):

카드 A (실시간 추이 차트):
- Before: `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:14px;">`
- After:  `<div class="cg-surface" style="padding:20px;display:flex;flex-direction:column;gap:14px;">`

카드 B (공지):
- Before: `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:12px;">`
- After:  `<div class="cg-surface" style="padding:20px;display:flex;flex-direction:column;gap:12px;">`

> 두 여는 태그는 gap 값(14px/12px)으로 구분되어 각각 유일하다.

- [ ] **Step B-7 — 상태 틴트 미니 카드 4개(V/A/T/SOC) 반경만 스냅**: 각 `linear-gradient(150deg,...)` 카드의 `border-radius:16px` → `var(--r-card)` (사전 18로 일괄). 틴트 배경·보더·값 색은 유지(비금지). 내부 `border-radius:99px` 배지 → `var(--r-pill)` (사전 28).

- [ ] **Step C — 사전 치환(대시보드 슬라이스 전량):** 항목 **1**(color:#6B7280 — 공지 부제/날짜), **2**(color:#9CA3AF — 차트 축 09:00…, 공지 날짜; ⚠️ 단 히어로 블록 3곳은 Step B-2에서 이미 처리됨, 남은 것만), **14**(stroke="#F3F4F6" — 실시간 차트 격자선 3줄 → #ECEAE8), **7**(border-bottom:1px solid #F9FAFB — 공지 행 구분선 2줄), **18**(border-radius:16px — 미니 카드/공지 아이콘 잔여), **28**(border-radius:99px — 공지 배지/미니카드 배지). 카드 A/B의 `#E5E7EB`·16px는 Step B-6에서 제거됨. 잔여 `#E5E7EB` 있으면 항목 **6**.

- [ ] **Step D/E/F** — 공통 절차. Step E 마커: `A="<!-- ===== DASHBOARD ===== -->"`, `B="<!-- ===== DEVICES ===== -->"`.
```bash
git commit --allow-empty -m "design(app-g4): dashboard to light glass tokens

히어로/게이지 다크→라이트 서피스(옵션 A), 뉴트럴 카드 .cg-surface, 미니카드·차트·
공지 금지색→토큰·반경 스냅. 상태 틴트/지표색 유지. check_region []+glass_misuse [].
번들은 gitignore라 마커 커밋 — 컨트롤러가 디코딩 마크업 diff로 리뷰."
```

---

### Task 2: DEVICES (디바이스)

**Files:** Modify — `<!-- ===== DEVICES ===== -->` ~ `<!-- ===== BATTERY ASSETS ===== -->`. **앵커:** `<sc-if value="{{ isDevices }}">` (1회).

**적용 컴포넌트:** 카드(KPI, 디바이스 카드 — 동적 보더) · 배지(상태 pill).

- [ ] **Step A** — `unpack > /tmp/cg_g4_devices.html`.

- [ ] **Step B-1 — KPI 카드(그라데이션 흰→오프화이트) → `.cg-surface`** (사전 8로 `#F9FAFB` stop을 살리기보다, 뉴트럴 카드이므로 레시피 카드 규칙대로 `.cg-surface`):
- Before: `<div style="background:linear-gradient(150deg,#fff,#F9FAFB);border:1px solid #E5E7EB;border-radius:12px;padding:12px 20px;">`
- After:  `<div class="cg-surface" style="padding:12px 20px;">`  (12px는 `.cg-surface`의 r-card로 흡수)

- [ ] **Step B-2 — 디바이스 카드(동적 보더 `{{ d.bd }}`) — `.cg-surface` 아님, in-place 토큰화:**
- Before: `<div style="background:#fff;border:1px solid {{ d.bd }};border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:14px;opacity:{{ d.op }};">`
- After:  `<div style="background:var(--surface);border:1px solid {{ d.bd }};border-radius:var(--r-card);padding:20px;display:flex;flex-direction:column;gap:14px;opacity:{{ d.op }};">`
  - 카드 안 아이콘 타일 `border-radius:12px`(허용, 유지), 상태 pill `border-radius:999px`(허용, 유지), 도트 `border-radius:50%` → `var(--r-pill)` (사전 29).

- [ ] **Step C — 사전 치환:** 항목 **1**(color:#6B7280 — KPI 라벨, SN, lastRecv/connBat/measMode 라벨 5곳), **6**(잔여 `#E5E7EB` — KPI 카드는 B-1에서 제거됨; 없으면 스킵), **29**(border-radius:50% — 상태 도트).

- [ ] **Step D/E/F** — 공통. Step E 마커: `DEVICES` ~ `BATTERY ASSETS`.
```bash
git commit --allow-empty -m "design(app-g4): devices to light glass tokens

KPI 카드 .cg-surface, 디바이스 카드 배경/반경 토큰화(동적 보더 유지), 뮤트 텍스트→
--ink-3, 도트 반경 스냅. check_region []+glass_misuse []. 마커 커밋."
```

---

### Task 3: BATTERY ASSETS (배터리 자산)

**Files:** Modify — `<!-- ===== BATTERY ASSETS ===== -->` ~ `<!-- ===== BATTERY DETAIL ===== -->`. **앵커:** `<sc-if value="{{ isBattery }}">` (1회).

**적용 컴포넌트:** 카드(팩 카드 — 동적 bg/border) · 필터(모드 필터 드롭다운) · 배지(상태 pill) · 브랜드 틴트 배너/버튼.

- [ ] **Step A** — `unpack > /tmp/cg_g4_assets.html`.

- [ ] **Step B-1 — "안내 배너"·"새 배터리" 카드·정렬 버튼(브랜드 틴트, 비금지 유지, 반경만):**
  - 안내 배너 `border-radius:14px` → `var(--r-card)` (사전 19). 아이콘 타일 `border-radius:10px` → `var(--r-card)` (사전 22).
  - "새 배터리 등록" 대시드 카드 `border-radius:16px` → `var(--r-card)` (사전 18). 아이콘 타일 `border-radius:14px` → `var(--r-card)`.
  - "정보 수정" 버튼 `border-radius:9px`(사전 23), 모드 필터 버튼 `border-radius:9px`, "최근 측정순" 버튼 `border-radius:9px`.

- [ ] **Step B-2 — 모드 필터 드롭다운(뉴트럴 팝오버):**
  - Before(여는 div): `<div style="position:absolute;top:40px;right:0;z-index:30;width:170px;background:#fff;border:1px solid #E5E7EB;border-radius:13px;box-shadow:0 14px 36px rgba(15,23,42,.15);padding:6px;animation:cgmodal .18s ease;">`
  - After: `<div style="position:absolute;top:40px;right:0;z-index:30;width:170px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-card);box-shadow:0 14px 36px rgba(15,23,42,.15);padding:6px;animation:cgmodal .18s ease;">`  (z-index 30 유지 — 셸 계약. box-shadow rgba(15,23,42,…)는 비금지, 유지.)
  - 드롭다운 항목 `border-radius:9px` → `var(--r-card)` (사전 23), hover 오브젝트 `'#F3F4F6'` → `'rgba(20,23,25,.04)'` (사전 13).

- [ ] **Step B-3 — 팩 카드(동적 bg/border `{{ p.selBg }}`/`{{ p.selBd }}`) — 반경만:**
  - `border-radius:16px` → `var(--r-card)` (사전 18). 상태 pill `border-radius:999px`(허용, 유지). 내부 구분선 `border-top:1px solid #F3F4F6` → 사전 10.

- [ ] **Step C — 사전 치환:** 항목 **1**(color:#6B7280 — savedBat 카운트, SOC, model·modeLabel, soc/lastMeas/anomScore 라벨 7곳), **6**(`#E5E7EB` — 필터 버튼·드롭다운·기타 보더), **10**(border-top:1px solid #F3F4F6 — 팩 카드 구분선), **12**(background:#F3F4F6 — 없으면 스킵), **13**(hover `'#F3F4F6'`), **18/19/22/23**(반경), **29**(50% 없으면 스킵).

> 주: 배터리 자산 슬라이스엔 `#F3F4F6`가 팩 구분선(border-top)과 hover 오브젝트로 등장한다. 항목 10·13이 각각 처리하므로 잔여 `background:#F3F4F6`는 없어야 한다(검증으로 확인).

- [ ] **Step D/E/F** — 공통. Step E 마커: `BATTERY ASSETS` ~ `BATTERY DETAIL`.
```bash
git commit --allow-empty -m "design(app-g4): battery assets to light glass tokens

팩 카드/드롭다운/배너/버튼 금지색→토큰·반경 스냅, 모드 필터 팝오버 서피스·hover
rgba(20,23,25,.04), z-index 30 유지(셸 계약). check_region []+glass_misuse []. 마커 커밋."
```

---

### Task 4: BATTERY DETAIL (배터리 상세)

**Files:** Modify — `<!-- ===== BATTERY DETAIL ===== -->` ~ `<!-- ===== ANOMALY ===== -->`. **앵커:** `<sc-if value="{{ isBatteryDetail }}">` (1회). (금지색·반경 위반 최다 화면.)

**적용 컴포넌트:** 카드(헤더/차트/SOH/히트맵/추세/세션표 — 뉴트럴 다수) · 차트(SVG 라인·격자선) · 테이블(grid 세션 이력) · 배지(세션 상태 pill) · 범례 스와치(3px) · 프로그레스 바.

- [ ] **Step A** — `unpack > /tmp/cg_g4_detail.html`.

- [ ] **Step B — 뉴트럴 흰 카드 → `.cg-surface`** (여는 태그가 `background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:...` 인 카드들). 각 카드 여는 태그의 trailing 레이아웃으로 구분해 개별 교체:
  1. 헤더 카드: Before `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:22px;display:flex;gap:20px;align-items:center;flex-wrap:wrap;">` → After `<div class="cg-surface" style="padding:22px;display:flex;gap:20px;align-items:center;flex-wrap:wrap;">`
  2. 점수 추세 카드: `...border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:14px;` (2fr 그리드 좌측) → `<div class="cg-surface" style="padding:20px;display:flex;flex-direction:column;gap:14px;">`  ⚠️ 이 여는 태그는 SOH 카드와 동일 패턴이므로, **둘 다 동일 after** 이며 `replace_all` 로 두 번 다 교체(개수 2 기대).
  3. 히트맵 카드: `...border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:16px;` → `<div class="cg-surface" style="padding:20px;display:flex;flex-direction:column;gap:16px;">`  ⚠️ 미니 추세(vitHead) 카드와 동일 패턴 → `replace_all`(개수 2 기대).
  4. 세션 이력 카드: `...border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:14px;` → 위 2번과 동일 after 문자열이므로 2번의 `replace_all`에 포함(개수 총 3 기대: 점수추세+SOH+세션표는 gap:14px 동일). 실제 개수는 검증 아닌 참고 — 최종 게이트는 `check_region==[]`.

> **주(카드 개수):** 배터리 상세엔 `background:#fff;border:1px solid #E5E7EB;border-radius:16px;` 카드가 여러 개고 일부는 여는 스타일이 완전히 동일하다. `.cg-surface` 변환은 **동일 before 문자열을 `replace_all`** 로 처리하면 되며(모두 같은 after), 유일성 걱정이 없다. 서로 다른 trailing(padding/gap)만 별도 교체.

- [ ] **Step B-2 — 내부 서브 요소 반경/구분선:**
  - 미니 추세 탭 래퍼 `background:#F3F4F6;border-radius:10px` → 사전 12 + 사전 22. 탭 칩 `border-radius:7px` → 사전 25.
  - 각 미니 추세 서브 카드 `border:1px solid #F3F4F6;border-radius:14px` → 사전 9 + 사전 19.
  - 범례 스와치 `border-radius:3px` → 사전 27 (⚠️ 근원형화, 보고 반영).
  - 차트 hover 점 `border-radius:50%` → 사전 29. hover 툴팁 `background:#161C2C`(비금지, 유지), `border-radius:7px` → 사전 25.
  - SOH/RUL 프로그레스 트랙 `background:#F3F4F6;border-radius:99px` → 사전 12 + 사전 28. 채움 바 `border-radius:99px` → 사전 28.
  - 셀 히트맵 셀 `border-radius:9px` → 사전 23 (배경 `{{ cell.bg }}` 동적 유지).
  - 온도 범례 그라데이션 바 `border-radius:99px` → 사전 28.
  - 헤더 칩(chemistry 등) `background:#F1F5F9`(비금지, 유지) `border-radius:999px`(허용, 유지).

- [ ] **Step B-3 — 세션 이력 테이블(grid) — 레시피 테이블:**
  - 헤더 행 구분선 `border-bottom:1px solid #F3F4F6` → 사전 11, 텍스트 `color:#6B7280` → 사전 1.
  - 본문 행 구분선 `border-bottom:1px solid #F9FAFB` → 사전 7 (2줄). 셀 `color:#4B5563` → 사전 3. 상태 pill(정상/주의/위험) 텍스트·배경(상태 hex + 틴트, 비금지) 유지, `border-radius:99px` → 사전 28.
  - **위험 행 배경:** 현재 세션표는 행 배경이 없다. 레시피의 "위험 등급 행만 `rgba(220,38,38,.06)`"는 **선택 개선**이나, 카피/데이터 변경 없이 위험 행(SES-2041, 상태=위험)에 배경을 추가하는 것은 **행 식별을 정적 마크업에서 해야 하므로** 이 화면에선 **적용 보류**(정의 필요 아님 — 레시피가 "위험 행만"이라 했고 정적 표라 안전하게 첫 행에만 인라인 배경 추가 가능하나, 시각 판단이 필요하므로 **이번 범위 밖으로 두고 그룹 7 반응형/폴리시에서 결정**). 색·반경 토큰화만 수행.

- [ ] **Step C — 사전 치환:** 항목 **1**(color:#6B7280 다수 — battery_id 라벨, cumCycle/intRes 라벨, y틱 등), **3**(color:#4B5563 — 세션 셀·SOH 라벨·"뒤로" 링크), **5**(color:#111827 — 히트맵 평균 온도), **2**(color:#9CA3AF — y틱/x라벨/날짜), **14**(stroke="#F3F4F6" — 점수추세 3줄 + 미니추세 각 4줄 = 다수 → #ECEAE8), **7/9/10/11**(구분선), **12**(background:#F3F4F6 트랙), **13**(hover 없음 — 스킵), **18~29**(반경). 카드의 `#E5E7EB`/16px는 Step B에서 제거.

> ⚠️ 이 화면은 `#F3F4F6` 14회(대부분 `stroke=`)가 핵심이다. **stroke(항목 14)를 먼저** 처리하고, 그 뒤 남은 `#F3F4F6`(트랙 배경·보더)를 항목 9/10/11/12로 처리해야 격자선이 `#ECEAE8`로, 트랙/보더가 `var(--border)`로 정확히 갈린다.

- [ ] **Step D/E/F** — 공통. Step E 마커: `BATTERY DETAIL` ~ `ANOMALY`.
```bash
git commit --allow-empty -m "design(app-g4): battery detail to light glass tokens

헤더/점수추세/SOH/히트맵/미니추세/세션표 카드 .cg-surface, 차트 격자선 #ECEAE8,
세션 grid 테이블·프로그레스·범례 금지색→토큰·반경 스냅. 지표색/상태 pill 유지.
check_region []+glass_misuse []. 마커 커밋."
```

---

### Task 5: ANOMALY (이상탐지)

**Files:** Modify — `<!-- ===== ANOMALY ===== -->` ~ `<!-- ===== TREND ===== -->`. **앵커:** `<sc-if value="{{ isAnomaly }}">` (1회).

**적용 컴포넌트:** 상태 틴트 KPI 카드(4) · 카드(위험분포/XAI/이벤트 — 뉴트럴) · 프로그레스 바(분포·XAI 기여도) · 이벤트 리스트 행.

> ✅ 이 화면엔 다크 히어로가 **없다**(모두 라이트 틴트/흰 카드). risk 변수(`riskColor` 등)도 등장하지 않는다 — 그 변수들은 랜딩 PRODUCT PREVIEW에만 있다(최종 보고 참조).

- [ ] **Step A** — `unpack > /tmp/cg_g4_anomaly.html`.

- [ ] **Step B-1 — 상태 틴트 KPI 카드 4개(모델상태/활성이상/오늘이상/피크점수) — 반경만:** 각 `linear-gradient(150deg,...)` 카드 `border-radius:16px` → `var(--r-card)` (사전 18). 틴트 배경·보더(`#C9EBD3`/`#C3E4F5`/`#F5DDB2`/`#F7B8AE` 비금지)·값 색 유지. 도트 `border-radius:50%` → 사전 29.

- [ ] **Step B-2 — 뉴트럴 흰 카드 3개 → `.cg-surface`** (위험 분포, XAI, 활성 이상 이벤트):
  - 위험 분포·XAI: Before `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:16px;">` → After `<div class="cg-surface" style="padding:20px;display:flex;flex-direction:column;gap:16px;">` (`replace_all`, 개수 2).
  - 이벤트 카드: Before `...gap:12px;` → After `<div class="cg-surface" style="padding:20px;display:flex;flex-direction:column;gap:12px;">`.

- [ ] **Step B-3 — 프로그레스 바·이벤트 아이콘:**
  - 분포 4행 트랙 `background:#F3F4F6;border-radius:99px` → 사전 12 + 28. 채움 `border-radius:99px` → 28.
  - XAI 4행 트랙 동일. **XAI 4번째 기여도**: 텍스트 `color:#6B7280`(사전 1) + 채움 `background:#9CA3AF`(⚠️ 이것은 배경색으로 쓰인 금지색 — 사전에 `background:#9CA3AF` 항목이 없다. 이 막대는 "낮은 기여" 뮤트 막대이므로 `background:var(--ink-3)`로 교체한다. **사전 확장 항목 2b**: `background:#9CA3AF` → `background:var(--ink-3)`).
  - 이벤트 3행 아이콘 타일 `border-radius:9px` → 사전 23(틴트 배경 `#FEECEC`/`#FEF3C7` 유지). 행 구분선 `border-bottom:1px solid #F9FAFB` → 사전 7.

> **사전 확장(항목 2b, 이 화면 한정 근거):** `background:#9CA3AF`(XAI 최저 기여 막대)는 마스터 사전에 없던 문맥이다. 뮤트 막대의 의미상 `var(--ink-3)`(=#8B9099, 뮤트 뉴트럴)로 간다 — 레시피 뉴트럴 매핑(`#9CA3AF`→뮤트)의 일관 적용이며 새 색을 만들지 않는다. 최종 보고에 명시.

- [ ] **Step C — 사전 치환:** 항목 **1**(color:#6B7280 — XAI 부제 PACK-001·점수, 이벤트 부제), **2**(color:#9CA3AF — 있으면), **2b**(background:#9CA3AF → var(--ink-3)), **12**(background:#F3F4F6 — 트랙 다수), **7**(border-bottom #F9FAFB — 이벤트 구분선), **18/23/28/29**(반경). 카드 `#E5E7EB`/16px는 B-2에서 제거. 잔여 `#E5E7EB`는 항목 6.

- [ ] **Step D/E/F** — 공통. Step E 마커: `ANOMALY` ~ `TREND`.
```bash
git commit --allow-empty -m "design(app-g4): anomaly to light glass tokens

KPI 틴트 카드 반경 스냅, 위험분포/XAI/이벤트 카드 .cg-surface, 프로그레스 트랙
var(--border)·최저기여 막대 var(--ink-3), 금지색→토큰. 상태색 유지. risk 변수 없음
(랜딩 프리뷰 전용). check_region []+glass_misuse []. 마커 커밋."
```

---

### Task 6: TREND (추세)

**Files:** Modify — `<!-- ===== TREND ===== -->` ~ `<!-- ===== EVENTS ===== -->`. **앵커:** `<sc-if value="{{ isTrend }}">` (1회).

**적용 컴포넌트:** 필터 바(기간 탭 + CSV/PDF 버튼) · 카드(차트 4 — 뉴트럴) · 차트(SVG 라인·격자선) · 범례 스와치(3px) · 비교 드롭다운(체크박스 5px).

- [ ] **Step A** — `unpack > /tmp/cg_g4_trend.html`.

- [ ] **Step B-1 — 상단 필터 바 카드 → `.cg-surface`:**
  - Before: `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:14px 18px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">`
  - After: `<div class="cg-surface" style="padding:14px 18px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">`
  - 기간 탭 래퍼 `background:#F3F4F6;border-radius:10px` → 사전 12 + 22. 탭 칩 `border-radius:7px` → 사전 25.
  - CSV/PDF 버튼 `border:1px solid #E5E7EB;border-radius:10px` → 사전 6 + 22(텍스트 `color:#4B5563`는 사전 3).

- [ ] **Step B-2 — 차트 카드 4개 → `.cg-surface`:**
  - Before: `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:12px;">`
  - After: `<div class="cg-surface" style="padding:18px;display:flex;flex-direction:column;gap:12px;">`  (`sc-for` 내부 1회 정의 → 교체 1회, 런타임 4개 렌더).
  - 범례 스와치 `border-radius:3px` → 사전 27(⚠️). hover 점 `border-radius:50%` → 사전 29, 툴팁 `background:#161C2C`(유지) `border-radius:7px` → 사전 25.

- [ ] **Step B-3 — 비교 카드 + 드롭다운:**
  - 비교 카드: `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:20px;display:flex;align-items:center;gap:14px;">` → `<div class="cg-surface" style="padding:20px;display:flex;align-items:center;gap:14px;">`. 아이콘 타일 `border-radius:11px` → 사전 21(틴트 `#EAF1FF` 유지). "비교 추가" 버튼 브랜드 틴트 `border-radius:10px` → 사전 22.
  - 드롭다운(비교 항목): Before `<div style="position:absolute;bottom:46px;right:0;z-index:20;width:220px;background:#fff;border:1px solid #E5E7EB;border-radius:14px;box-shadow:0 16px 40px rgba(15,23,42,.16);padding:8px;">` → After `<div style="position:absolute;bottom:46px;right:0;z-index:20;width:220px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-card);box-shadow:0 16px 40px rgba(15,23,42,.16);padding:8px;">` (z-index 20 유지). 항목 `border-radius:9px` → 사전 23, hover `'#F3F4F6'` → 사전 13, 체크박스 `border-radius:5px` → 사전 26(⚠️).

- [ ] **Step C — 사전 치환:** 항목 **1**(color:#6B7280 — cmpSel 부제), **2**(color:#9CA3AF — y틱/x라벨), **3**(color:#4B5563 — CSV/PDF 버튼 텍스트), **14**(stroke="#F3F4F6" — 각 차트 격자선 4줄×4 → #ECEAE8), **6**(잔여 `#E5E7EB`), **12/13**(F3F4F6 트랙/hover), **18~29**(반경). 카드의 `#E5E7EB`/16px/14px는 Step B에서 제거.

> ⚠️ 배터리 상세와 동일: **stroke(14)를 F3F4F6 다른 문맥보다 먼저** 처리.

- [ ] **Step D/E/F** — 공통. Step E 마커: `TREND` ~ `EVENTS`.
```bash
git commit --allow-empty -m "design(app-g4): trend to light glass tokens

필터 바·차트 4·비교 카드 .cg-surface, 격자선 #ECEAE8, 비교 드롭다운 서피스(z-index 20
유지)·hover rgba(20,23,25,.04), 금지색→토큰·반경 스냅. 지표색 유지. check_region []+
glass_misuse []. 마커 커밋."
```

---

### Task 7: EVENTS (이벤트)

**Files:** Modify — `<!-- ===== EVENTS ===== -->` ~ `<!-- ===== ALERT CENTER ===== -->`. **앵커:** `<sc-if value="{{ isEvents }}">` (1회).

**적용 컴포넌트:** 검색 필드 · 필터 칩(템플릿 색) · 테이블(grid 이벤트 목록, 위험 행 배경 `{{ e.rowBg }}`) · 페이지네이션.

- [ ] **Step A** — `unpack > /tmp/cg_g4_events.html`.

- [ ] **Step B-1 — 검색 필드:** Before `<div style="flex:1;min-width:220px;display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid #E5E7EB;border-radius:11px;padding:10px 14px;color:#6B7280;font-size:14px;">` → After `<div style="flex:1;min-width:220px;display:inline-flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-card);padding:10px 14px;color:var(--ink-3);font-size:14px;">`. 검색 아이콘 `stroke="#9CA3AF"` → 사전 16.

- [ ] **Step B-2 — 테이블 컨테이너(뉴트럴, overflow:hidden — `.cg-surface` 아님, 반경 유지 필요):**
  - Before: `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:16px;overflow:hidden;">` → After `<div class="cg-surface" style="overflow:hidden;">`  (`.cg-surface`가 배경/보더/반경 제공, `overflow:hidden` 유지).
  - 헤더 행: `background:#F9FAFB`(→사전 8) `border-bottom:1px solid #E5E7EB`(→사전 6) `color:#6B7280`(→사전 1).
  - 본문 행: `border-bottom:1px solid #F9FAFB`(→사전 7), `background:{{ e.rowBg }}`(동적 유지 — 위험 행 배경은 JS가 산출), hover `'#F9FAFB'`(→사전 13), 셀 `color:#4B5563`(→사전 3), 상태 pill 텍스트/배경 `{{ e.sColor }}`/`{{ e.sBg }}`(동적 유지) `border-radius:99px`(→사전 28), 점수 `color:{{ e.scoreColor }}`(동적 유지), "상세" 링크 `color:#2563EB`(브랜드, 유지).

> 주(위험 행 배경): 이벤트 테이블은 이미 `background:{{ e.rowBg }}` 로 행별 배경을 템플릿에서 받는다. 레시피의 "위험 행 rgba(220,38,38,.06)"는 이 JS(`e.rowBg`)가 산출하는데, **JS는 화면 마크업 슬라이스 밖**이라 check_region 대상이 아니다. 마크업 토큰화만 하고 JS는 그대로 둔다(그룹 3 레시피의 "JS가 값을 내도록 확인"은 확인 항목이며 이 그룹 린터 게이트와 무관).

- [ ] **Step B-3 — 페이지네이션:** 버튼들 `border:1px solid #E5E7EB;border-radius:9px`(→사전 6 + 23), 활성 페이지 `background:{{ evtPage1Bg }}`(동적 유지). 필터 칩 `border-radius:9px`(→사전 23, 배경/색 `{{ c.bg }}`/`{{ c.col }}`/`{{ c.bd }}` 동적 유지).

- [ ] **Step C — 사전 치환:** 항목 **1**(color:#6B7280 — 검색 힌트·헤더·페이지 라벨), **3**(color:#4B5563 — 셀 시간), **16**(stroke="#9CA3AF" — 검색 아이콘), **6**(`#E5E7EB`), **7/8**(F9FAFB 구분선/헤더 배경), **13**(hover `'#F9FAFB'`), **23/28**(반경). 테이블 컨테이너 16px는 B-2에서 `.cg-surface`로 흡수.

- [ ] **Step D/E/F** — 공통. Step E 마커: `EVENTS` ~ `ALERT CENTER`.
```bash
git commit --allow-empty -m "design(app-g4): events to light glass tokens

검색 필드/테이블 컨테이너(.cg-surface)/헤더·행 구분선/페이지네이션 금지색→토큰·반경
스냅, hover rgba(20,23,25,.04). 동적 행 배경/상태 pill/필터 칩 색은 JS 유지(스코프 밖).
check_region []+glass_misuse []. 마커 커밋."
```

---

### Task 8: ALERT CENTER (알림센터)  ⚠️ 다크 히어로 결정 필요 — 옵션 A로 작성

**Files:** Modify — `<!-- ===== ALERT CENTER ===== -->` ~ `<!-- ===== NOTICES (user) ===== -->`. **앵커:** `<sc-if value="{{ isAlertHistory }}">` (1회).

> ⚠️ 상단 "오늘의 알림 요약" 다크 히어로(`linear-gradient(120deg,#161C2C,#1E2438)`)를 포함한다. 아래는 **옵션 A(라이트 전환)**. 옵션 B면 Step B-1만 교체.

**적용 컴포넌트:** 요약 히어로(다크→라이트) · 요약 카운트 칩(3, 상태 틴트) · 타임라인 카드(동적 bg/border) · 배지(심각도) · 정보 칩.

- [ ] **Step A** — `unpack > /tmp/cg_g4_alert.html`.

- [ ] **Step B-1 — 요약 히어로 → 라이트(옵션 A):**
  - Before: `<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:linear-gradient(120deg,#161C2C,#1E2438);border-radius:18px;padding:20px 24px;">`
  - After: `<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-panel);padding:20px 24px;">`
  - 히어로 내부: `color:#9CA3AF`(요약 라벨) → `color:var(--ink-3)`; `color:#fff`(제목 "확인이 필요한 알림 1건") → `color:var(--ink)`.
  - 카운트 칩 3개(위험/경고/정상): 저알파 상태 배경 유지, **다크용 밝은 텍스트를 라이트 상태색으로**:
    - 위험: 숫자 `color:#FCA5A5`→`#DC2626`, 라벨 `color:#F3B4AC`→`#DC2626`; `border-radius:12px`(허용, 유지).
    - 경고: 숫자 `color:#FDBA74`→`#EA580C`, 라벨 `color:#F5C79A`→`#EA580C`.
    - 정상·점검: 숫자 `color:#86EFAC`→`#16A34A`, 라벨 `color:#A7E9BE`→`#16A34A`.
    - 칩 배경/보더 `rgba(220,38,38,.16)`/`rgba(234,88,12,.15)`/`rgba(22,163,74,.16)` 및 보더 유지(비금지, 라이트에서도 저채도 틴트로 동작).

- [ ] **Step B-2 — 타임라인 카드(동적 bg/border `{{ a.cardBg }}`/`{{ a.cardBd }}`) — 반경만:** `border-radius:16px` → 사전 18. 썸네일 타일 `border-radius:16px` → 사전 18(배경 `{{ a.thumbBg }}` 동적 유지). 타임라인 커넥터 `background:#E5E7EB` → 사전 6. 심각도 배지 `border-radius:99px` → 사전 28(색 `{{ a.sevColor }}`/`{{ a.sevBg }}` 동적 유지).

- [ ] **Step B-3 — 정보 칩·액션:**
  - 팩 칩 `color:#334155;background:#F1F5F9`(둘 다 비금지, 유지) `border-radius:8px` → 사전 24.
  - metrics 칩 `color:#374151;background:#F3F4F6` → `color:var(--ink-2)`(사전 4) + `background:var(--border)`(사전 12) `border-radius:8px` → 사전 24.
  - 채널 칩 `color:#6B7280`(사전 1), 체크 아이콘 `stroke="#9CA3AF"`(사전 16).
  - ACK 버튼 `background:#DC2626`(위험 액션, 유지) `border-radius:9px` → 사전 23; RAW 버튼 `color:#B91C1C;background:#fff;border:1px solid #F1B7AC`(비금지, 유지) `border-radius:9px` → 사전 23.
  - 디바이스 썸네일 아이콘 `stroke="#4B5563"` → 사전 17(⚠️ #8B9099).

- [ ] **Step C — 사전 치환:** 항목 **1**(color:#6B7280 — 채널 칩), **2**(color:#9CA3AF — 시간 라벨, 히어로 것은 B-1에서 처리됨), **3**(color:#4B5563 — desc 본문), **4**(color:#374151 — metrics 칩), **16**(stroke="#9CA3AF"), **17**(stroke="#4B5563"), **6**(`#E5E7EB` — 커넥터), **12**(background:#F3F4F6 — metrics 칩), **18/23/24/28**(반경).

- [ ] **Step D/E/F** — 공통. Step E 마커: `ALERT CENTER` ~ `NOTICES (user)`.
```bash
git commit --allow-empty -m "design(app-g4): alert center to light glass tokens

요약 히어로 다크→라이트(옵션 A)·카운트 칩 라이트 상태색, 타임라인 카드/배지/정보 칩
금지색→토큰·반경 스냅. 동적 카드/심각도 색 유지. check_region []+glass_misuse []. 마커 커밋."
```

---

### Task 9: NOTICES (공지 — 사용자)

**Files:** Modify — `<!-- ===== NOTICES (user) ===== -->` ~ `<!-- ===== RELAY ===== -->`. **앵커:** `<sc-if value="{{ isNotices }}">` (1회). (최소 화면.)

**적용 컴포넌트:** 필터 칩(템플릿 색) · 리스트 카드(뉴트럴, overflow:hidden) · 카테고리 배지.

- [ ] **Step A** — `unpack > /tmp/cg_g4_notices.html`.

- [ ] **Step B-1 — 리스트 컨테이너 → `.cg-surface`:** Before `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:16px;overflow:hidden;">` → After `<div class="cg-surface" style="overflow:hidden;">`.
  - 행: `border-bottom:1px solid #F9FAFB`(사전 7), hover `'#F9FAFB'`(사전 13), 카테고리 배지 `color:{{ n.color }}`/`background:{{ n.bg }}`(동적 유지) `border-radius:99px`(사전 28), 본문 `color:#4B5563`(사전 3), 날짜 `color:#9CA3AF`(사전 2).
  - 필터 칩 `border-radius:9px`(사전 23, 색 동적 유지).

- [ ] **Step C — 사전 치환:** 항목 **2**(color:#9CA3AF — 날짜), **3**(color:#4B5563 — 본문), **6**(`#E5E7EB`; 컨테이너는 B-1에서 제거, 잔여 없으면 스킵), **7**(border-bottom #F9FAFB), **13**(hover `'#F9FAFB'`), **23/28**(반경).

- [ ] **Step D/E/F** — 공통. Step E 마커: `NOTICES (user)` ~ `RELAY`.
```bash
git commit --allow-empty -m "design(app-g4): notices to light glass tokens

리스트 컨테이너 .cg-surface, 행 구분선·본문·날짜·필터 칩 금지색→토큰·반경 스냅,
hover rgba(20,23,25,.04). 카테고리 배지 색 동적 유지. check_region []+glass_misuse []. 마커 커밋."
```

---

### Task 10: RELAY (릴레이)  ⚠️ 다크 배너 결정 필요 — 옵션 A로 작성

**Files:** Modify — `<!-- ===== RELAY ===== -->` ~ `<!-- ===== SETTINGS ===== -->`. **앵커:** `<sc-if value="{{ isRelay }}">` (1회).

> ⚠️ 상단 Kill-Switch 배너(`background:#161C2C`)를 포함한다. 아래는 **옵션 A(라이트 전환)**. 옵션 B면 Step B-1만 교체.

**적용 컴포넌트:** 배너(다크→라이트) · 상태 pill(동적) · 실행 카드(위험 액션) · 최근 제어 이력 카드.

- [ ] **Step A** — `unpack > /tmp/cg_g4_relay.html`.

- [ ] **Step B-1 — Kill-Switch 배너 → 라이트(옵션 A):**
  - Before: `<div style="background:#161C2C;border-radius:18px;padding:26px 28px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;">`
  - After: `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-panel);padding:26px 28px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;">`
  - 배너 내부: `color:#9CA3AF`(relayCircuit 라벨·failsafeNote·curState 라벨 3곳) → `color:var(--ink-3)`; `color:#fff`(killCtrl 제목) → `color:var(--ink)`.
  - 상태 pill `color:{{ relayStatusColor }};background:{{ relayStatusBg }}`(동적 유지) `border-radius:12px`(허용, 유지), 도트 `border-radius:50%` → 사전 29.

- [ ] **Step B-2 — 실행 카드 + 이력 카드 → `.cg-surface`:**
  - 실행 카드: `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:22px;display:flex;flex-direction:column;gap:14px;align-items:center;text-align:center;">` → `<div class="cg-surface" style="padding:22px;display:flex;flex-direction:column;gap:14px;align-items:center;text-align:center;">`. 아이콘 타일 `background:#FEECEC;border-radius:16px` → `border-radius:var(--r-card)`(사전 18, 틴트 유지). 실행 버튼 `background:{{ relayActionColor }}`(동적 위험색 유지) `border-radius:12px`(허용, 유지).
  - 이력 카드: `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:22px;display:flex;flex-direction:column;gap:12px;">` → `<div class="cg-surface" style="padding:22px;display:flex;flex-direction:column;gap:12px;">`. 이력 아이콘 타일 3개 `border-radius:9px` → 사전 23(틴트 `#E9F8EE`/`#FEECEC`/`#EAF1FF` 유지).

- [ ] **Step C — 사전 치환:** 항목 **1**(color:#6B7280 — riskCtrlNote, 이력 메타 3곳), **2**(color:#9CA3AF — 배너 것은 B-1에서 처리; 잔여 없으면 스킵), **18/23/29**(반경). 카드 `#E5E7EB`/16px는 B-2에서 제거. 잔여 `#E5E7EB` 항목 6.

- [ ] **Step D/E/F** — 공통. Step E 마커: `RELAY` ~ `SETTINGS`.
```bash
git commit --allow-empty -m "design(app-g4): relay to light glass tokens

Kill-Switch 배너 다크→라이트(옵션 A), 실행/이력 카드 .cg-surface, 금지색→토큰·반경
스냅. 상태 pill·위험 실행 버튼 동적 색 유지. check_region []+glass_misuse []. 마커 커밋."
```

---

### Task 11: SETTINGS (설정)

**Files:** Modify — `<!-- ===== SETTINGS ===== -->` ~ `<!-- ===== ADMIN DASHBOARD ===== -->`. **앵커:** `<sc-if value="{{ isSettings }}">` (1회). (3개 서브탭: 알림/계정/테마 — 금지색 최다.)

**적용 컴포넌트:** 탭(세그먼트 컨트롤) · 카드(각 탭 패널 — 뉴트럴) · 토글 스위치 · 폼 필드(계정) · 캘리브레이션 이력 배지.

- [ ] **Step A** — `unpack > /tmp/cg_g4_settings.html`.

- [ ] **Step B-1 — 상단 탭 세그먼트:** 래퍼 `background:#F3F4F6;border-radius:12px`(→사전 12, 12px 허용 유지) `padding:5px`. 탭 칩 3개 `border-radius:8px` → 사전 24(선택/비선택 배경·색 `{{ tabAlBg }}` 등 동적 유지).

- [ ] **Step B-2 — 알림 탭 카드 → `.cg-surface`:** `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:24px;display:flex;flex-direction:column;gap:6px;">` → `<div class="cg-surface" style="padding:24px;display:flex;flex-direction:column;gap:6px;">`.
  - 채널 행 4개 `border-bottom:1px solid #F9FAFB`(→사전 7). 아이콘 타일: 카카오 `background:#FEE500`(비금지 유지) `border-radius:10px`→사전 22; 이메일 `background:#EAF1FF`(유지) `border-radius:10px`→22; SMS/푸시 `background:#F3F4F6`(→사전 12) `border-radius:10px`→22, 아이콘 `stroke="#4B5563"`→사전 17(⚠️). 토글 트랙 `border-radius:99px`(사전 28, 배경 `{{ kakaoBg }}` 동적), 노브 `border-radius:50%`→사전 29.
  - dedupe 노트 박스 `background:#F9FAFB;border-radius:11px`(→사전 8 + 21), 아이콘 `stroke="#6B7280"`(사전 15), 텍스트 `color:#6B7280`(사전 1).

- [ ] **Step B-3 — 계정 탭 카드 → `.cg-surface`:** `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:24px;display:flex;flex-direction:column;gap:18px;">` → `<div class="cg-surface" style="padding:24px;display:flex;flex-direction:column;gap:18px;">`.
  - 아바타 `border-radius:50%`→사전 29(그라데이션 유지). "사진 변경" 브랜드 틴트 버튼 `border-radius:9px`→사전 23.
  - 폼 필드 3개(이름/이메일/전화): 라벨 `color:#374151`(사전 4). 값 박스 `border:1px solid #E5E7EB;border-radius:11px;background:#F9FAFB`(→사전 6 + 21 + 8). 이메일 값 `color:#6B7280`(사전 1). 전화 아이콘 `stroke="#9CA3AF"`(사전 16), 전화번호 `color:#111827`(사전 5). 필드 노트 `color:#6B7280`(사전 1).
  - 비번 구획 `border-top:1px solid #F3F4F6`(사전 10), pwLast `color:#6B7280`(사전 1), 재설정 버튼 브랜드 틴트 `border-radius:10px`→사전 22.

- [ ] **Step B-4 — 테마 탭 카드 2개 → `.cg-surface`:** 두 카드 `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:22px;...">` — trailing으로 구분:
  - 테마 선택 카드: `...padding:22px;display:flex;align-items:center;justify-content:space-between;` → `<div class="cg-surface" style="padding:22px;display:flex;align-items:center;justify-content:space-between;">`. 세그먼트 래퍼 `background:#F3F4F6;border-radius:10px`(사전 12 + 22), 세그먼트 칩 `border-radius:7px`→사전 25(라이트 `background:#fff`→`var(--surface)` 선택칩, 비선택 `color:#6B7280`→사전 1).
  - 캘리브레이션 이력 카드: `...padding:22px;display:flex;flex-direction:column;gap:12px;` → `<div class="cg-surface" style="padding:22px;display:flex;flex-direction:column;gap:12px;">`. 행 `border-bottom:1px solid #F9FAFB`(사전 7), 메타 `color:#6B7280`(사전 1), 상태 배지(유효/만료임박) 색·틴트(비금지) 유지 `border-radius:99px`→사전 28.

- [ ] **Step C — 사전 치환(설정 슬라이스 전량):** 항목 **1**(color:#6B7280 다수 16회 — 각 채널 부제, 폼 노트, 메타 등), **4**(color:#374151 — 폼 라벨 3회), **5**(color:#111827 — 전화번호), **15**(stroke="#6B7280" — dedupe 아이콘), **16**(stroke="#9CA3AF" — 전화 아이콘), **17**(stroke="#4B5563" — SMS/푸시 아이콘 2회), **6**(`#E5E7EB` — 폼 값 박스 잔여), **7**(border-bottom #F9FAFB), **8**(background:#F9FAFB — 폼 박스·dedupe), **10**(border-top #F3F4F6), **12**(background:#F3F4F6 — 탭/세그먼트 래퍼·SMS/푸시 타일), **21/22/23/24/25/28/29**(반경). 카드 `#E5E7EB`/16px는 Step B에서 제거.

> ⚠️ 설정은 `#F9FAFB`가 폼 값 박스 **배경**(→var(--bg-base), 사전 8)과 행 **구분선**(→var(--border), 사전 7) 둘 다로 등장한다. 문맥 한정 문자열(사전 7·8)이라 정확히 갈린다. `#F3F4F6`도 탭 래퍼 배경(사전 12)과 SMS/푸시 타일 배경(사전 12)뿐(구분선 아님) — 모두 var(--border)로 통일.

- [ ] **Step D/E/F** — 공통. Step E 마커: `SETTINGS` ~ `ADMIN DASHBOARD`.
```bash
git commit --allow-empty -m "design(app-g4): settings to light glass tokens

3개 탭(알림/계정/테마) 카드 .cg-surface, 세그먼트 탭·토글·폼 필드·캘리브레이션 배지
금지색→토큰·반경 스냅. 토글/상태 배지 색 유지. check_region []+glass_misuse []. 마커 커밋."
```

---

### Task 12: 11개 화면 통합 브라우저 렌더 확인 (콘솔 에러 무)

**Files:** 편집 없음. 검증 전용(그룹 2의 통합 브라우저 확인 패턴).

이 태스크는 Task 1~11의 마크업 편집이 브라우저에서 정상 렌더되고 콘솔 에러가 없는지 **한 번에** 확인한다. 편집이 순수 색·반경·클래스 치환이라 파서 회귀 위험이 낮지만, 랜딩 `</` 버그 선례상 브라우저 확인은 필수다.

- [ ] **Step 1 — 로컬 서버 기동:**
```bash
cd "/Users/jungjeahwan/Desktop/claude/han/설계 산출물"
python3 -m http.server 8899 &
```

- [ ] **Step 2 — 앱 진입:** `http://localhost:8899/셀가드 프로토타입_v3.html` 열기 → 로그인 모달의 "로그인"(`doLogin`)으로 인앱 셸 진입. 좌측 내비로 11개 화면을 순회한다: 대시보드 → 디바이스 → 배터리 자산(→ 팩 선택 → 배터리 상세) → 이상탐지 → 추세 → 이벤트 → 알림센터 → 공지 → 릴레이 → 설정(3개 탭).

- [ ] **Step 3 — 화면별 확인(육안):**
  - **대시보드**: 히어로가 **라이트 서피스**(옵션 A)로 렌더되고 게이지 트랙이 옅은 웜 회색, 점수 숫자가 진한 잉크, 밴드 칩이 라이트 상태색. 미니 카드 틴트 유지. 실시간 차트 격자선이 웜(`#ECEAE8`). **게이지 4단계 확인**(그룹 1 정합): dScore 예시값 기준 색·라벨(정상 초록/주의 주황/경고 오렌지/위험 빨강)이 올바른지 확인(회귀 없음).
  - **배터리 상세/추세**: 차트 카드 흰 서피스 + 웜 격자선, 범례 스와치가 근원형(⚠️ 알려진 스냅 결과)로 보이는지 확인.
  - **이벤트**: 테이블 헤더/행 구분선 웜, 위험 행 배경(`e.rowBg`, JS) 유지, hover 시 옅은 웜 틴트.
  - **알림센터/릴레이**: 히어로/배너가 라이트(옵션 A), 카운트 칩·상태 pill 상태색 정상.
  - **설정**: 세그먼트 탭·토글·폼 박스가 웜 뉴트럴, 선택 탭만 브랜드/흰.
  - 전 화면: **글래스(반투명·블러)가 본문에 없어야** 한다(사이드바·상단바만 글래스).

- [ ] **Step 4 — 콘솔 에러 확인:** 브라우저 콘솔(또는 `read_console_messages`)에 에러가 없어야 한다. 특히 `Unterminated string`/템플릿 파싱 에러가 없어야 한다(`</` 회귀 방지). 에러가 있으면 해당 화면 태스크로 돌아가 원인을 수정한다.

- [ ] **Step 5 — 서버 내림:**
```bash
pkill -f "http.server 8899"
```

- [ ] **Step 6 — Commit:**
```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
git commit --allow-empty -m "design(app-g4): verify 11 user screens render in browser

11개 화면 통합 브라우저 확인 — 라이트 서피스/게이지 4단계/웜 격자선/본문 글래스 없음/
콘솔 에러 없음. 마커 커밋."
```

---

## 완료 기준

- Task 1~11 각각 왕복 diff 무차이(`왕복 OK`).
- **11개 화면 슬라이스 전부 `check_region == []` AND `glass_misuse == []`.** (편집 전 대비: 11개 화면 모두 금지색·비허용 반경 위반이 0이 됨. 편집 전 조사 기준 위반 요약은 아래 "화면별 위반 인벤토리" 참조.)
- 랜딩 린터 무회귀(`landing_lint.py` exit 0) — 매 태스크 확인.
- 뉴트럴 흰 카드가 `.cg-surface`로 치환되고, 동적/틴트 카드는 배경/반경만 토큰화(템플릿 바인딩·상태색 유지).
- 다크 히어로 3개(대시보드·알림센터·릴레이)가 승인된 옵션(기본 A=라이트)대로 처리됨.
- Task 12 통합 브라우저 확인에서 11개 화면 정상 렌더 + 콘솔 에러 없음 + 게이지 4단계 회귀 없음 + 본문 글래스 없음.
- 라우팅·상태·예시 데이터·버튼 동작·카피·모달 정의 무변경.

### 화면별 위반 인벤토리 (편집 전 조사 — 각 태스크가 0으로 만들 대상)

| 화면 | 금지색(회) | 비허용 반경 | 글래스 오남용 | 주 레시피 컴포넌트 |
|---|---|---|---|---|
| 대시보드 | #6B7280×3 #E5E7EB×2 #F9FAFB×2 #F3F4F6×3 #9CA3AF×7 | 10/11/16/18/22/50%/7/8/99px | 없음 | 카드·게이지·틴트 미니카드·차트·배지 (⚠️다크 히어로) |
| 디바이스 | #6B7280×5 #E5E7EB×1 #F9FAFB×1 | 16/50% | 없음 | 카드(동적 보더)·배지 |
| 배터리 자산 | #6B7280×7 #E5E7EB×3 #F3F4F6×2 | 9/10/13/14/16px | 없음 | 카드(동적)·필터 드롭다운·배지 |
| 배터리 상세 | #6B7280×6 #E5E7EB×6 #F9FAFB×2 #F3F4F6×14 #4B5563×6 #9CA3AF×3 #111827×1 | 3/7/9/10/11/14/16/50%/99px | 없음 | 카드·차트·grid 테이블·배지·프로그레스·범례(3px) |
| 이상탐지 | #6B7280×5 #E5E7EB×3 #F9FAFB×2 #F3F4F6×8 #9CA3AF×1 | 9/16/50%/99px | 없음 | 틴트 KPI·카드·프로그레스(+bg:#9CA3AF)·리스트 |
| 추세 | #6B7280×1 #E5E7EB×6 #F3F4F6×6 #4B5563×2 #9CA3AF×2 | 3/5/7/9/10/11/14/16/50%px | 없음 | 필터 바·카드·차트·범례(3px)·비교 드롭다운(체크박스 5px) |
| 이벤트 | #6B7280×3 #E5E7EB×7 #F9FAFB×3 #4B5563×1 #9CA3AF×1 | 9/11/16/99px | 없음 | 검색·grid 테이블(동적 행 bg)·페이지네이션·칩 |
| 알림센터 | #6B7280×1 #E5E7EB×1 #F3F4F6×1 #4B5563×2 #9CA3AF×3 #374151×1 | 8/9/16/18/99px | 없음 | 히어로(⚠️다크)·틴트 칩·타임라인 카드(동적)·배지 |
| 공지 | #E5E7EB×1 #F9FAFB×2 #4B5563×1 #9CA3AF×1 | 9/16/99px | 없음 | 리스트 카드·배지·필터 칩 |
| 릴레이 | #6B7280×4 #E5E7EB×2 #9CA3AF×3 | 9/16/18/50% | 없음 | 배너(⚠️다크)·상태 pill·카드 |
| 설정 | #6B7280×16 #E5E7EB×7 #F9FAFB×9 #F3F4F6×5 #4B5563×2 #9CA3AF×1 #374151×3 #111827×1 | 7/8/9/10/11/16/50%/99px | 없음 | 세그먼트 탭·카드·토글·폼 필드·배지 |

> `#4B5563`가 SVG `stroke=`로 쓰인 3곳(알림센터 디바이스 아이콘, 설정 SMS·푸시 아이콘)은 사전 항목 17로 `#8B9099`. `#9CA3AF`가 `background`로 쓰인 1곳(이상탐지 XAI 최저 기여 막대)은 항목 2b로 `var(--ink-3)`. 3px/5px 소형 반경은 항목 26·27로 `var(--r-card)`(근원형). — 세 건 모두 최종 보고에서 확인 요망 항목으로 표기.

## 이 그룹이 만든/확정한 것 (다음 그룹이 의존)

- **11개 일반 사용자 화면의 라이트 글래스 토큰화 완료.** 카드=`.cg-surface`, 색·반경=마스터 사전, 차트 격자선=`#ECEAE8`, 게이지=라이트(트랙 rgba(20,23,25,.1)), hover=rgba(20,23,25,.04). 그룹 5(관리자 6화면)는 이 사전과 카드 변환 규칙을 그대로 재사용한다(관리자 화면도 동일 인라인 스타일·grid 테이블 구조).
- **다크 히어로 처리 선례(옵션 A=라이트 전환).** 관리자 대시보드 등에 유사 다크 면이 있으면 이 선례를 따른다(단 그룹 5에서 재확인).
- **마스터 치환 사전의 실전 검증.** 문맥 한정 문자열 + `check_region==[]` 게이트 방식이 11개 화면에서 동작함을 확인 — 그룹 5·6이 동일 방식 사용.
- **미해결로 넘기는 것**: (1) 위험 등급 행 배경(`rgba(220,38,38,.06)`)의 정적 표 적용 — 이벤트 표는 JS(`e.rowBg`)가, 세션표는 정적이라 시각 판단 필요 → 그룹 7 폴리시/반응형에서 결정. (2) 3px/5px 소형 반경의 근원형화 — 소형 반경 허용목록 확장 여부는 사람 결정. (3) `#4B5563` SVG 아이콘의 진하기(#8B9099 vs #141719) 미세 선택.

## 다음 그룹

그룹 5(관리자 화면 6: 관리자 대시보드·이벤트 추이·유저 관리·배터리 운영·공지 관리·감사 로그). 화면별로 카드=`.cg-surface`, grid 테이블/게이지/차트/배지/탭/필터=이 그룹의 마스터 사전 그대로, 모달 트리거는 유지. 이 플랜이 완료되면 그룹 5 플랜을 작성한다.

## 부록 — 스펙 vs 실제 코드 불일치 (사람 확인 요망, 이 그룹 범위 밖)

- **스펙 L163~165 `riskColor`/`riskBg`/`riskLabel` 정합 주장은 stale.** 스펙은 이 블록의 하드코딩 색을 "그룹 4의 이상탐지/대시보드 화면 리디자인에서 토큰화하며 다룬다"고 했으나, 조사 결과 `riskColor`/`riskBg`/`riskLabel`/`riskPct`는 **랜딩 PRODUCT PREVIEW 블록(마케팅 목업, 이미 병합된 랜딩 리디자인 소관)의 마크업(1곳)과 그 JS(계산 1곳)에만** 등장하고, APP SHELL의 실제 대시보드·이상탐지 화면 어디에도 없다. 따라서 **그룹 4가 이 블록에 대해 할 일은 없다.** 또한 그 JS(`score>=70`/`>=40`, `#2563EB`/`#FEF3EA`/`#FEECEC`)는 여전히 옛 3단계·랜딩 프리뷰 전용이며 상태 게이지 4단계 정합(그룹 1)과 무관하다. 이 항목은 스펙 문구를 최신 코드에 맞춰 정정할지 사람이 결정할 사안이며, 그룹 4 태스크로 만들지 않았다.
