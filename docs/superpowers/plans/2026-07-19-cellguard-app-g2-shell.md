# 셀가드 앱 리디자인 — 그룹 2: 공유 셸 (사이드바·상단바) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱 공유 셸을 웜 라이트 글래스 체계로 전환한다 — 사이드바(다크 네이비 → 라이트 웜 서피스), 상단바(차가운 반투명 → 라이트 글래스 스티키 + 본문 비침), 상단바의 알림 드롭다운(불투명 웜 서피스).

**Architecture:** 대상은 23MB 번들(`설계 산출물/셀가드 프로토타입_v3.html`)이며 실제 마크업은 JSON 문자열 한 줄 안에 있다. 편집은 `python3 tools/bundle_io.py unpack/pack` 왕복으로만 한다. 이 그룹은 개별 화면(본문)을 건드리지 않고, 25화면이 공유하는 셸(사이드바 + 상단바 + 알림 드롭다운)만 리디자인한다. 그룹 1이 만든 토큰(`--nav-*`, `.cg-surface`)과 린터(`check_region`, `app_region`, `glass_misuse`)를 **재사용**한다 — 새 토큰/규칙을 정의하지 않는다.

**Tech Stack:** HTML/CSS 인라인 스타일, `sc-camel` / `x-dc` 템플릿, Pretendard, Python 3(도구·검증).

**실행 모델:** 이 플랜은 **Sonnet 5**가 실행한다. 각 스텝은 완전한 before/after 코드와 정확한 앵커 문자열을 담으며 판단을 요구하지 않는다. 아래 Global Constraints의 "구현 함정"은 모든 태스크에 암묵적으로 적용된다.

## Global Constraints

스펙 `docs/superpowers/specs/2026-07-19-cellguard-app-screens-light-glass-design.md`와 그룹 1 계약에서 그대로 가져온다. **모든 태스크에 적용된다.**

- 대상 파일 `설계 산출물/셀가드 프로토타입_v3.html`은 **git 추적 대상이 아니다**(`.gitignore`의 `설계 산출물/`). 되돌리기가 불가능하므로 그룹 시작 시(Task 1 Step 1) 백업한다.
- 실제 마크업은 JSON 문자열 한 줄 안에 있다. **손으로 편집하지 않는다.** `python3 tools/bundle_io.py unpack/pack`으로만 편집한다.
- `bundle_io.pack`은 마크업 내 `</`를 `<\/`로 이스케이프한다(브라우저 HTML 파서의 스크립트 조기 종료 방지). 이 처리를 우회하지 않는다.
- **왕복 검증(unpack diff)은 브라우저 렌더를 보장하지 않는다.** readlines 기반이라 HTML 파서 경로를 안 탄다. 그룹 끝(Task 4)에 로컬 HTTP 서버(`file://`는 확장이 차단)로 열어 육안 + 콘솔 에러를 확인한다.
- **SVG 속성에는 `var()`가 작동하지 않는다.** `stroke="..."`, `fill="..."`처럼 값이 SVG presentation **속성**에 직접 들어가면 CSS 변수는 무시된다. 이 경로는 **hex 문자열을 유지**하되 토큰과 **동일 값**으로 맞춘다(`--ink`=`#141719`, `--ink-3`=`#8B9099`, `--ok`=`#16A34A`, `--warn`=`#D97706`, `--alert`=`#EA580C`, `--danger`=`#DC2626`). 반대로 CSS **프로퍼티**(`color:`, `background:`, `border:`, `border-radius:` 등 인라인 style 속성)에는 `var(--token)`을 쓴다.
- 라우팅·상태·예시 데이터·버튼 동작(`sc-camel-on-click`)·카피 텍스트를 변경하지 않는다. 이 그룹은 **색·보더·반경·글래스만** 바꾼다. 단 예외로, 사이드바 네비 항목의 **색 값 문자열**(`item()` 함수의 `color`/`hover`)은 다크→라이트 전환을 위해 수정한다(라우팅/로직은 그대로).
- radius는 `12px`(`var(--r-card)`) / `20px`(`var(--r-panel)`) / `999px`(`var(--r-pill)`) 3개만 쓴다. `6px`·`9px`·`10px`·`11px`·`16px`·`50%`·`99px`는 전부 이 3개 중 하나로 교체한다.
- **절제적 글래스**: 글래스(`.cg-glass`/`backdrop-filter`)는 크롬(사이드바·상단바·모달)에만. 이 그룹에서 **상단바만** 글래스이고, **사이드바는 불투명 웜 서피스**, **알림 드롭다운은 불투명 웜 서피스**다. 본문(그룹 4~6)에는 글래스를 새로 넣지 않는다.
- Python은 `python3`, 표준 라이브러리만. 의존성 추가 없음.

### 그룹 1이 만든 계약 (재사용, 재정의 금지)

- CSS 토큰(`:root`에 이미 정의됨): `--nav-bg:#EFEDE7` / `--nav-border:rgba(20,23,25,.08)` / `--nav-ink:#5A6068` / `--nav-ink-active:#FFFFFF`.
- 기존 뉴트럴/브랜드/상태 토큰: `--bg-base:#F7F6F4` / `--surface:#FFFFFF` / `--ink:#141719` / `--ink-2:#5A6068` / `--ink-3:#8B9099` / `--border:rgba(20,23,25,.08)` / `--brand:#2563EB` / `--brand-grad` / `--ok/--warn/--alert/--danger`.
- CSS 클래스: `.cg-glass`(글래스 패널), `.cg-surface`(불투명 서피스).
- 린터: `landing_lint.check_region(region)`, `landing_lint.app_region(markup)`, `landing_lint.glass_misuse(region)`.
- 상태 등급: 임계값 30/60/80, 라벨 정상/주의/경고/위험.

### 이번 그룹에서 확정된 설계 결정 (사용자 승인)

1. **사이드바 워드마크 "셀가드" 색 = `var(--ink)`**(#141719). 랜딩 상단 워드마크와 동일한 진한 잉크. (스펙 본문의 "--nav-ink 계열"보다 랜딩 일관성을 우선 — 사용자 승인.)
2. **상단바 = 스크롤 구조 재편.** 본문 스크롤을 메인 컬럼으로 올리고 상단바를 `position:sticky;top:0`으로. 본문이 상단바 뒤로 흘러 글래스에 살짝 비친다(스펙의 "콘텐츠가 살짝 비침" 구현 — 사용자 승인).
3. **알림 드롭다운 = 불투명 웜 서피스**(`var(--surface)`). 글래스 아님. 알림 목록 가독성 우선(사용자 승인).

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `설계 산출물/셀가드 프로토타입_v3.html` | 대상 번들. 사이드바 마크업 + `item()` JS 색(Task 1), 상단바 프레임/본문 래퍼/버튼(Task 2), 알림 드롭다운(Task 3) | 수정 |
| `tools/bundle_io.py` | 번들 왕복 도구. **변경 없음**, 재사용만 | 재사용 |
| `tools/landing_lint.py` | 구간 린터(`check_region`/`app_region`/`glass_misuse`). **변경 없음**, 검증에 호출만 | 재사용 |

> **셸 마크업 위치(참고, 실행 시점의 최신 unpack으로 재확인할 것):** 언패킹하면 사이드바는 `<!-- sidebar -->`~`<!-- main -->` 사이, 상단바+알림 드롭다운은 `<!-- main -->`~`<!-- ===== DASHBOARD ===== -->` 사이, `item()` 함수는 `const userNav = [` 직전에 있다. 줄 번호는 편집으로 이동하므로 아래 각 스텝의 **앵커 문자열**로 찾는다.

---

### Task 1: 사이드바 — 다크 네이비 → 라이트 웜 서피스

**Files:**
- Modify: `설계 산출물/셀가드 프로토타입_v3.html` (사이드바 마크업 `<!-- sidebar -->`~`<!-- main -->`, `item()` 함수 2줄)

**Interfaces:**
- Consumes: 그룹 1 토큰 `--nav-bg`/`--nav-border`/`--nav-ink`/`--nav-ink-active`, `--ink`/`--ink-3`/`--r-card`/`--r-pill`; `bundle_io.unpack/pack/backup`; `landing_lint.check_region/glass_misuse`.
- Produces: 없음(셸 전용 리디자인). 이후 그룹은 이 사이드바 위에 화면을 얹는다.

이 태스크는 사이드바 컨테이너·워드마크·로고마크·네비 항목·잠금 아이콘·관리자 나가기·유저 푸터의 색/보더/반경을 라이트 웜 체계로 바꾼다. 마크업은 템플릿 색(`{{ it.color }}` 등)을 쓰므로, 네비 항목의 **실제 색 값**은 `item()` JS 함수에서 바꾼다.

- [ ] **Step 1: 백업하고 마크업을 꺼낸다**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py backup "설계 산출물/셀가드 프로토타입_v3.html"
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_g2a.html
```

- [ ] **Step 2: 사이드바 컨테이너 배경/보더를 웜 서피스로 바꾼다**

`/tmp/cg_g2a.html`에서 이 줄(앵커: `background:linear-gradient(180deg,#161C2C,#11151F)`)을 찾는다.

Before:
```html
    <div style="width:{{ navW }};flex-shrink:0;background:linear-gradient(180deg,#161C2C,#11151F);border-right:1px solid #262E42;display:flex;flex-direction:column;transition:width .25s ease;overflow:hidden;">
```

After:
```html
    <div style="width:{{ navW }};flex-shrink:0;background:var(--nav-bg);border-right:1px solid var(--nav-border);display:flex;flex-direction:column;transition:width .25s ease;overflow:hidden;">
```

- [ ] **Step 3: 로고 헤더 하단 보더를 웜 보더로 바꾼다**

앵커: `padding:20px 18px;height:64px;flex-shrink:0;border-bottom:1px solid rgba(255,255,255,.06);`

Before:
```html
      <div style="display:flex;align-items:center;gap:10px;padding:20px 18px;height:64px;flex-shrink:0;border-bottom:1px solid rgba(255,255,255,.06);">
```

After:
```html
      <div style="display:flex;align-items:center;gap:10px;padding:20px 18px;height:64px;flex-shrink:0;border-bottom:1px solid var(--nav-border);">
```

- [ ] **Step 4: 로고 마크의 반경을 허용 값으로 바꾼다 (브랜드 그라데이션·흰 아이콘은 유지)**

앵커: `border-radius:9px;background:linear-gradient(135deg,#3B82F6,#2563EB);display:flex;align-items:center;justify-content:center;"><svg width="17"`

Before:
```html
        <div style="width:32px;height:32px;flex-shrink:0;border-radius:9px;background:linear-gradient(135deg,#3B82F6,#2563EB);display:flex;align-items:center;justify-content:center;"><svg width="17" height="17" sc-camel-view-box="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"></path></svg></div>
```

After (반경 `9px` → `var(--r-card)`; 브랜드 그라데이션·흰색 스트로크는 그대로 — 로고 마크는 랜딩과 동일하게 유지):
```html
        <div style="width:32px;height:32px;flex-shrink:0;border-radius:var(--r-card);background:linear-gradient(135deg,#3B82F6,#2563EB);display:flex;align-items:center;justify-content:center;"><svg width="17" height="17" sc-camel-view-box="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"></path></svg></div>
```

- [ ] **Step 5: 워드마크 색을 `var(--ink)`로, 모드 태그 반경을 허용 값으로 바꾼다**

앵커: `color:#fff;display:{{ labelDisp }};">셀가드`

Before:
```html
        <span style="font-size:17px;font-weight:800;letter-spacing:-.02em;white-space:nowrap;color:#fff;display:{{ labelDisp }};">셀가드<span style="font-size:11px;font-weight:700;color:{{ modeTagColor }};margin-left:7px;padding:2px 7px;border-radius:6px;background:{{ modeTagBg }};">{{ modeTag }}</span></span>
```

After (워드마크 `color:#fff` → `var(--ink)`; 모드 태그 `border-radius:6px` → `var(--r-pill)`; `{{ modeTagColor }}`/`{{ modeTagBg }}`는 JS 계산값이라 그대로 둔다):
```html
        <span style="font-size:17px;font-weight:800;letter-spacing:-.02em;white-space:nowrap;color:var(--ink);display:{{ labelDisp }};">셀가드<span style="font-size:11px;font-weight:700;color:{{ modeTagColor }};margin-left:7px;padding:2px 7px;border-radius:var(--r-pill);background:{{ modeTagBg }};">{{ modeTag }}</span></span>
```

> 참고: `modeTagColor`/`modeTagBg`(ADMIN 칩의 `#334155`/`#F1F5F9`)는 JS 계산값이며 금지색이 아니므로 이 그룹에서 건드리지 않는다. 마크업의 반경만 정합한다.

- [ ] **Step 6: 네비 항목 컨테이너 반경을 허용 값으로 바꾼다**

앵커: `data-comment-anchor="efb53a3240-div"`

Before:
```html
          <div sc-camel-on-click="{{ it.go }}" style="display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:11px;background:{{ it.bg }};color:{{ it.color }};font-weight:{{ it.weight }};cursor:pointer;white-space:nowrap;" style-hover="{{ it.hover }}" data-comment-anchor="efb53a3240-div">
```

After (`border-radius:11px` → `var(--r-card)`):
```html
          <div sc-camel-on-click="{{ it.go }}" style="display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:var(--r-card);background:{{ it.bg }};color:{{ it.color }};font-weight:{{ it.weight }};cursor:pointer;white-space:nowrap;" style-hover="{{ it.hover }}" data-comment-anchor="efb53a3240-div">
```

- [ ] **Step 7: 잠금 아이콘 스트로크를 웜 뉴트럴 hex로 바꾼다**

앵커: `stroke="#D1D5DB" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:{{ it.lockDisp }}`

Before:
```html
            <svg width="14" height="14" sc-camel-view-box="0 0 24 24" fill="none" stroke="#D1D5DB" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:{{ it.lockDisp }};flex-shrink:0;"><rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>
```

After (SVG 속성이라 `var()` 불가 → `#D1D5DB`(금지색)를 `#8B9099`(=`--ink-3` 값)로. 잠금 항목의 뮤트 톤과 통일):
```html
            <svg width="14" height="14" sc-camel-view-box="0 0 24 24" fill="none" stroke="#8B9099" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:{{ it.lockDisp }};flex-shrink:0;"><rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>
```

> 배지(`background:#EA580C` / `border-radius:999px`, 앵커 `{{ it.badge }}`)는 상태 표시라 그대로 둔다(`#EA580C`=`--alert` 값, 반경 999px 허용).

- [ ] **Step 8: 관리자 나가기(exitAdmin) 섹션을 웜 뉴트럴로 바꾼다**

앵커: `sc-camel-on-click="{{ exitAdmin }}"`

Before:
```html
      <div style="padding:10px 12px;border-top:1px solid rgba(255,255,255,.06);"><div sc-camel-on-click="{{ exitAdmin }}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:11px;color:#93B4EA;font-weight:600;cursor:pointer;white-space:nowrap;"><svg width="18" height="18" style="flex-shrink:0" sc-camel-view-box="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"></path></svg><span style="display:{{ labelDisp }};">{{ exitAdminLabel }}</span></div></div>
```

After (상단 보더 → `var(--nav-border)`; 링크 색 `#93B4EA` → `var(--nav-ink)`; 반경 `11px` → `var(--r-card)`; 아이콘 스트로크는 `currentColor`라 링크 색을 상속 — 그대로 둔다):
```html
      <div style="padding:10px 12px;border-top:1px solid var(--nav-border);"><div sc-camel-on-click="{{ exitAdmin }}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--r-card);color:var(--nav-ink);font-weight:600;cursor:pointer;white-space:nowrap;"><svg width="18" height="18" style="flex-shrink:0" sc-camel-view-box="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"></path></svg><span style="display:{{ labelDisp }};">{{ exitAdminLabel }}</span></div></div>
```

- [ ] **Step 9: 유저 푸터를 웜 뉴트럴로 바꾼다 (아바타 그라데이션은 유지)**

앵커: `background:linear-gradient(135deg,#93C5FD,#2563EB)` (유저 푸터에만 존재)

Before:
```html
      <div style="padding:14px 12px;border-top:1px solid rgba(255,255,255,.06);display:flex;align-items:center;gap:10px;flex-shrink:0;"><div style="width:34px;height:34px;flex-shrink:0;border-radius:50%;background:linear-gradient(135deg,#93C5FD,#2563EB);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px;">{{ userInitial }}</div><div style="display:{{ labelDisp }};flex-direction:column;min-width:0;"><span style="font-size:13px;font-weight:700;white-space:nowrap;color:#fff;">{{ userName }}</span><span style="font-size:12px;color:#7C8598;white-space:nowrap;">{{ userRole }}</span></div></div>
```

After (상단 보더 → `var(--nav-border)`; 아바타 반경 `50%` → `var(--r-pill)`(34px 정사각이라 완전 원 동일); 아바타 그라데이션·이니셜 흰색은 유지; 유저명 `#fff` → `var(--ink)`; 역할 `#7C8598` → `var(--nav-ink)`):
```html
      <div style="padding:14px 12px;border-top:1px solid var(--nav-border);display:flex;align-items:center;gap:10px;flex-shrink:0;"><div style="width:34px;height:34px;flex-shrink:0;border-radius:var(--r-pill);background:linear-gradient(135deg,#93C5FD,#2563EB);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px;">{{ userInitial }}</div><div style="display:{{ labelDisp }};flex-direction:column;min-width:0;"><span style="font-size:13px;font-weight:700;white-space:nowrap;color:var(--ink);">{{ userName }}</span><span style="font-size:12px;color:var(--nav-ink);white-space:nowrap;">{{ userRole }}</span></div></div>
```

- [ ] **Step 10: 네비 항목 텍스트 색을 라이트 체계로 바꾼다 (`item()` JS)**

앵커: `color: route === r ? '#fff' : (locked` (파일에 1회)

Before:
```js
        color: route === r ? '#fff' : (locked ? '#454F66' : '#9AA4BC'),
```

After (선택=흰색(브랜드 그라데이션 위) → `var(--nav-ink-active)`; 잠금=뮤트 → `var(--ink-3)`; 기본=`var(--nav-ink)`. 이 값들은 인라인 style의 `color:` 프로퍼티로 들어가므로 `var()` 사용 가능):
```js
        color: route === r ? 'var(--nav-ink-active)' : (locked ? 'var(--ink-3)' : 'var(--nav-ink)'),
```

> 선택 항목 배경(`bg: route === r ? G : 'transparent'`, `G = 'linear-gradient(135deg,#3B82F6,#2563EB)'`)은 브랜드 그라데이션으로 이미 스펙과 일치하므로 건드리지 않는다.

- [ ] **Step 11: 네비 항목 hover 배경을 라이트 체계로 바꾼다 (`item()` JS)**

앵커: `hover: (route === r || locked) ? {} : { background: 'rgba(255,255,255,.06)' },` (파일에 1회)

Before:
```js
        hover: (route === r || locked) ? {} : { background: 'rgba(255,255,255,.06)' },
```

After (다크용 흰 알파 → 라이트용 잉크 알파. 스펙의 hover 값 `rgba(20,23,25,.04)`):
```js
        hover: (route === r || locked) ? {} : { background: 'rgba(20,23,25,.04)' },
```

- [ ] **Step 12: 되쓰고 왕복 검증(diff)**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py pack "설계 산출물/셀가드 프로토타입_v3.html" < /tmp/cg_g2a.html
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_g2a_verify.html
diff /tmp/cg_g2a.html /tmp/cg_g2a_verify.html && echo "왕복 OK"
```

Expected: `왕복 OK`(무차이).

- [ ] **Step 13: 사이드바 구간 린터 검증 (check_region == [] AND glass_misuse == [])**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 - <<'PY'
import sys; sys.path.insert(0,'tools')
import bundle_io, landing_lint
m = bundle_io.unpack("설계 산출물/셀가드 프로토타입_v3.html")
side = m[m.find("<!-- sidebar -->"):m.find("<!-- main -->")]
cr = landing_lint.check_region(side)
gm = landing_lint.glass_misuse(side)
print("check_region:", cr if cr else "[] 통과")
print("glass_misuse:", gm if gm else "[] 통과 (사이드바는 글래스 아님)")
assert cr == [], "사이드바에 금지색/비허용 반경이 남아 있다"
assert gm == [], "사이드바에 글래스가 들어갔다 — 사이드바는 불투명 웜 서피스여야 한다"
print("Task 1 사이드바 검증 통과")
PY
```

Expected: `check_region: [] 통과`, `glass_misuse: [] 통과`, `Task 1 사이드바 검증 통과`.

- [ ] **Step 14: Commit**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
git commit --allow-empty -m "design(app-g2): sidebar to warm light surface

다크 네이비 그라데이션 → var(--nav-bg) 웜 서피스, 보더 var(--nav-border).
워드마크 var(--ink), 네비 텍스트/hover/잠금 라이트 체계, 반경 토큰 정합.
사이드바는 글래스 아님(glass_misuse []). 번들은 gitignore라 마커 커밋 —
컨트롤러가 unpack diff로 리뷰."
```

---

### Task 2: 상단바 — 라이트 글래스 스티키 + 본문 스크롤 재편

**Files:**
- Modify: `설계 산출물/셀가드 프로토타입_v3.html` (메인 컬럼 래퍼, 상단바 프레임, 상단바 버튼 4종, 본문 컨테이너)

**Interfaces:**
- Consumes: `.cg-glass`(글래스), 토큰 `--bg-base`/`--surface`/`--border`/`--ink-2`/`--ink-3`/`--brand`/`--r-card`/`--r-pill`; `bundle_io`; `landing_lint.glass_misuse`.
- Produces: 없음.

이 태스크는 (1) 메인 컬럼을 스크롤 컨테이너로 만들고 도트 패턴을 제거해 `--bg-base`로, (2) 상단바를 `.cg-glass` 스티키로(랜딩 NAV와 동일 패턴), (3) 상단바 버튼(햄버거·페이지 부제·종·언어·로그아웃)을 웜 토큰으로 바꾼다. 결과적으로 본문이 상단바 뒤로 흘러 글래스에 비친다. **알림 드롭다운은 Task 3에서** 다루므로 여기서 건드리지 않는다.

- [ ] **Step 1: 마크업을 꺼낸다**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_g2b.html
```

- [ ] **Step 2: 메인 컬럼을 스크롤 컨테이너로 만들고 도트 패턴을 제거한다**

앵커: `background-color:#F9FAFB;background-image:radial-gradient`

Before:
```html
    <div style="flex:1;min-width:0;display:flex;flex-direction:column;background-color:#F9FAFB;background-image:radial-gradient(circle,#EEF0F3 1px,transparent 1px);background-size:22px 22px;">
```

After (`overflow:auto` 추가 — 이제 이 컬럼이 스크롤한다; 도트 패턴(`background-image`/`background-size`) 제거; 배경 `#F9FAFB` → `var(--bg-base)`):
```html
    <div style="flex:1;min-width:0;display:flex;flex-direction:column;overflow:auto;background:var(--bg-base);">
```

- [ ] **Step 3: 상단바 프레임을 `.cg-glass` 스티키로 바꾼다**

앵커: `background:rgba(249,250,251,.9);backdrop-filter:blur(8px)`

Before:
```html
      <div style="height:64px;flex-shrink:0;display:flex;align-items:center;gap:16px;padding:0 28px;background:rgba(249,250,251,.9);backdrop-filter:blur(8px);border-bottom:1px solid #E5E7EB;">
```

After (`class="cg-glass"`가 배경·블러·보더·그림자를 제공. 랜딩 NAV와 동일하게 반경 0 + 좌/우/상 보더 제거(하단 보더만 남김). `position:sticky;top:0;z-index:20`으로 스크롤 시 고정 + 본문 비침):
```html
      <div class="cg-glass" style="height:64px;flex-shrink:0;position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:16px;padding:0 28px;border-radius:0;border-left:none;border-right:none;border-top:none;">
```

- [ ] **Step 4: 햄버거(사이드바 토글) 버튼을 웜 토큰으로 바꾼다**

앵커: `sc-camel-on-click="{{ toggleNav }}"`

Before:
```html
        <span sc-camel-on-click="{{ toggleNav }}" style="cursor:pointer;width:38px;height:38px;border-radius:10px;border:1px solid #E5E7EB;background:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="18" height="18" sc-camel-view-box="0 0 24 24" fill="none" stroke="#1F2937" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"></path></svg></span>
```

After (반경 `10px` → `var(--r-card)`; 보더 `#E5E7EB` → `var(--border)`; 배경 `#fff` → `var(--surface)`; 아이콘 스트로크는 SVG 속성이라 hex 유지, `#1F2937` → `#141719`(=`--ink` 값)):
```html
        <span sc-camel-on-click="{{ toggleNav }}" style="cursor:pointer;width:38px;height:38px;border-radius:var(--r-card);border:1px solid var(--border);background:var(--surface);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="18" height="18" sc-camel-view-box="0 0 24 24" fill="none" stroke="#141719" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"></path></svg></span>
```

- [ ] **Step 5: 페이지 부제 색을 웜 뉴트럴로 바꾼다**

앵커: `font-size:12px;color:#6B7280;">{{ pageSub }}`

Before:
```html
        <div style="display:flex;flex-direction:column;flex-shrink:0;white-space:nowrap;"><span style="font-size:17px;font-weight:800;letter-spacing:-.01em;">{{ pageTitle }}</span><span style="font-size:12px;color:#6B7280;">{{ pageSub }}</span></div>
```

After (`#6B7280`(금지색) → `var(--ink-3)`):
```html
        <div style="display:flex;flex-direction:column;flex-shrink:0;white-space:nowrap;"><span style="font-size:17px;font-weight:800;letter-spacing:-.01em;">{{ pageTitle }}</span><span style="font-size:12px;color:var(--ink-3);">{{ pageSub }}</span></div>
```

- [ ] **Step 6: 종(알림) 버튼과 미읽음 점을 웜 토큰으로 바꾼다**

앵커: `sc-camel-on-click="{{ toggleNotif }}"`

Before:
```html
          <span sc-camel-on-click="{{ toggleNotif }}" style="position:relative;width:38px;height:38px;border-radius:10px;border:1px solid #E5E7EB;background:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;"><svg width="18" height="18" sc-camel-view-box="0 0 24 24" fill="none" stroke="#1F2937" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.7 21a2 2 0 0 1-3.4 0"></path></svg><span style="position:absolute;top:8px;right:9px;width:7px;height:7px;border-radius:50%;background:#EA580C;border:1.5px solid #fff;"></span></span>
```

After (버튼 반경 `10px` → `var(--r-card)`, 보더 → `var(--border)`, 배경 → `var(--surface)`, 아이콘 스트로크 `#1F2937` → `#141719`; 미읽음 점 반경 `50%` → `var(--r-pill)`, 점 배경 `#EA580C`(=`--alert` 값, 상태색)와 `#fff` 보더는 유지):
```html
          <span sc-camel-on-click="{{ toggleNotif }}" style="position:relative;width:38px;height:38px;border-radius:var(--r-card);border:1px solid var(--border);background:var(--surface);display:flex;align-items:center;justify-content:center;cursor:pointer;"><svg width="18" height="18" sc-camel-view-box="0 0 24 24" fill="none" stroke="#141719" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.7 21a2 2 0 0 1-3.4 0"></path></svg><span style="position:absolute;top:8px;right:9px;width:7px;height:7px;border-radius:var(--r-pill);background:#EA580C;border:1.5px solid #fff;"></span></span>
```

- [ ] **Step 7: 언어 전환 버튼을 웜/브랜드 토큰으로 바꾼다**

앵커: `sc-camel-on-click="{{ toggleLang }}"`

Before:
```html
        <span sc-camel-on-click="{{ toggleLang }}" style="cursor:pointer;font-size:13px;font-weight:700;color:#2563EB;padding:9px 12px;border-radius:10px;border:1px solid #BFD3FF;background:#EAF1FF;flex-shrink:0;display:inline-flex;align-items:center;gap:6px;"><svg width="15" height="15" sc-camel-view-box="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"></path></svg>{{ langBtn }}</span>
```

After (색 `#2563EB` → `var(--brand)`; 반경 `10px` → `var(--r-card)`; 브랜드 틴트 보더/배경 `#BFD3FF`/`#EAF1FF`는 금지색이 아니므로 유지; 아이콘 스트로크는 `currentColor`라 브랜드 색 상속):
```html
        <span sc-camel-on-click="{{ toggleLang }}" style="cursor:pointer;font-size:13px;font-weight:700;color:var(--brand);padding:9px 12px;border-radius:var(--r-card);border:1px solid #BFD3FF;background:#EAF1FF;flex-shrink:0;display:inline-flex;align-items:center;gap:6px;"><svg width="15" height="15" sc-camel-view-box="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"></path></svg>{{ langBtn }}</span>
```

- [ ] **Step 8: 로그아웃 버튼을 웜 토큰으로 바꾼다**

앵커: `sc-camel-on-click="{{ logout }}"`

Before:
```html
        <span sc-camel-on-click="{{ logout }}" style="cursor:pointer;font-size:14px;font-weight:600;color:#4B5563;padding:9px 14px;border-radius:10px;border:1px solid #E5E7EB;background:#fff;flex-shrink:0;">{{ logoutLabel }}</span>
```

After (색 `#4B5563`(금지색) → `var(--ink-2)`; 반경 `10px` → `var(--r-card)`; 보더 `#E5E7EB` → `var(--border)`; 배경 `#fff` → `var(--surface)`):
```html
        <span sc-camel-on-click="{{ logout }}" style="cursor:pointer;font-size:14px;font-weight:600;color:var(--ink-2);padding:9px 14px;border-radius:var(--r-card);border:1px solid var(--border);background:var(--surface);flex-shrink:0;">{{ logoutLabel }}</span>
```

- [ ] **Step 9: 본문 컨테이너에서 자체 스크롤을 제거한다 (스크롤은 이제 메인 컬럼이 담당)**

앵커: `flex:1;overflow:auto;padding:24px 28px` (파일에 1회)

Before:
```html
      <div style="flex:1;overflow:auto;padding:24px 28px;">
```

After (`flex:1;overflow:auto` 제거 — 메인 컬럼이 스크롤하므로 본문은 일반 흐름. 패딩은 유지):
```html
      <div style="padding:24px 28px;">
```

- [ ] **Step 10: 되쓰고 왕복 검증(diff)**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py pack "설계 산출물/셀가드 프로토타입_v3.html" < /tmp/cg_g2b.html
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_g2b_verify.html
diff /tmp/cg_g2b.html /tmp/cg_g2b_verify.html && echo "왕복 OK"
```

Expected: `왕복 OK`.

- [ ] **Step 11: 상단바 글래스 검증 (glass_misuse로 크롬 글래스 불변식 확인)**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 - <<'PY'
import sys; sys.path.insert(0,'tools')
import bundle_io, landing_lint
m = bundle_io.unpack("설계 산출물/셀가드 프로토타입_v3.html")
top = m[m.find("<!-- main -->"):m.find("<!-- ===== DASHBOARD ===== -->")]
gm = landing_lint.glass_misuse(top)
print("glass_misuse(상단바 구간):", gm)
# 상단바는 크롬이므로 .cg-glass가 정확히 1개 있어야 하고(의도된 글래스),
# 인라인 backdrop-filter는 0이어야 한다(클래스로 이전됨).
assert any("cg-glass" in i for i in gm), "상단바에 cg-glass가 없다"
assert not any("backdrop-filter" in i for i in gm), "인라인 backdrop-filter가 남아 있다 — .cg-glass 클래스로 이전해야 한다"
# 도트 패턴 제거 확인
assert "radial-gradient(circle,#EEF0F3" not in m, "본문 래퍼 도트 패턴이 남아 있다"
print("Task 2 상단바 글래스/도트 검증 통과")
PY
```

Expected: `glass_misuse(상단바 구간)`에 cg-glass 1건만(백드롭필터 0건), `Task 2 상단바 글래스/도트 검증 통과`.

> 참고: 이 구간에는 아직 알림 드롭다운의 차가운 색/비허용 반경이 남아 있어 `check_region`은 통과하지 않는다. 구간 전체 `check_region == []` 검증은 Task 3 끝에서 한다.

- [ ] **Step 12: Commit**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
git commit --allow-empty -m "design(app-g2): topbar to light glass sticky + scroll restructure

상단바 .cg-glass 스티키(랜딩 NAV 패턴), 메인 컬럼 overflow:auto로 본문이
상단바 뒤로 비침. 도트 패턴 제거·본문 배경 var(--bg-base). 버튼 4종 웜 토큰화.
번들은 gitignore라 마커 커밋."
```

---

### Task 3: 상단바 알림 드롭다운 — 불투명 웜 서피스

**Files:**
- Modify: `설계 산출물/셀가드 프로토타입_v3.html` (알림 드롭다운 패널·헤더·행 3개·푸터)

**Interfaces:**
- Consumes: 토큰 `--surface`/`--border`/`--bg-base`/`--ink-3`/`--brand`/`--alert`/`--r-panel`/`--r-pill`/`--r-card`; `bundle_io`; `landing_lint.check_region/glass_misuse`.
- Produces: 없음.

이 태스크는 종 아이콘의 알림 드롭다운 팝오버를 불투명 웜 서피스로 토큰화한다(글래스 아님 — 알림 목록 가독성 우선). 상태 틴트(`#FEECEC`/`#FEF7F5`/`#FEF3C7`/`#E9F8EE`)와 상태 스트로크(`#DC2626`/`#D97706`/`#16A34A`)는 유지하고, 차가운 뉴트럴·비허용 반경만 바꾼다.

- [ ] **Step 1: 마크업을 꺼낸다**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_g2c.html
```

- [ ] **Step 2: 드롭다운 패널을 불투명 웜 서피스로 바꾼다**

앵커: `top:46px;right:0;z-index:30;width:340px`

Before:
```html
          <div style="position:absolute;top:46px;right:0;z-index:30;width:340px;background:#fff;border:1px solid #E5E7EB;border-radius:16px;box-shadow:0 18px 44px rgba(15,23,42,.16);overflow:hidden;animation:cgmodal .2s ease;">
```

After (배경 `#fff` → `var(--surface)`; 보더 `#E5E7EB` → `var(--border)`; 반경 `16px` → `var(--r-panel)`; box-shadow 유지 — 글래스 아님):
```html
          <div style="position:absolute;top:46px;right:0;z-index:30;width:340px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-panel);box-shadow:0 18px 44px rgba(15,23,42,.16);overflow:hidden;animation:cgmodal .2s ease;">
```

- [ ] **Step 3: 드롭다운 헤더(미읽음 배지)를 토큰화한다**

앵커: `{{ T.alertCenter }}`

Before:
```html
            <div style="display:flex;align-items:center;justify-content:space-between;padding:15px 18px;border-bottom:1px solid #F3F4F6;"><span style="font-size:14px;font-weight:800;">{{ T.alertCenter }}</span><span style="font-size:11px;font-weight:700;color:#EA580C;background:#FEECEC;padding:2px 9px;border-radius:99px;">{{ T.unread1 }}</span></div>
```

After (하단 보더 `#F3F4F6` → `var(--border)`; 배지 색 `#EA580C` → `var(--alert)`; 배지 반경 `99px` → `var(--r-pill)`; 배지 배경 `#FEECEC`(상태 틴트)는 유지):
```html
            <div style="display:flex;align-items:center;justify-content:space-between;padding:15px 18px;border-bottom:1px solid var(--border);"><span style="font-size:14px;font-weight:800;">{{ T.alertCenter }}</span><span style="font-size:11px;font-weight:700;color:var(--alert);background:#FEECEC;padding:2px 9px;border-radius:var(--r-pill);">{{ T.unread1 }}</span></div>
```

- [ ] **Step 4: 알림 행 1(위험)을 토큰화한다**

앵커: `{{ T.ev1 }}` (드롭다운 행에만 존재)

Before:
```html
              <div style="display:flex;gap:11px;align-items:flex-start;padding:13px 18px;border-bottom:1px solid #F9FAFB;background:#FEF7F5;"><span style="width:30px;height:30px;border-radius:9px;background:#FEECEC;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="15" height="15" sc-camel-view-box="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2.2"><path d="M12 9v4M12 17h.01"></path><circle cx="12" cy="12" r="9"></circle></svg></span><div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:700;">{{ T.ev1 }}</div><div style="font-size:11px;color:#6B7280;">PACK-001 · {{ T.justNow }}</div></div></div>
```

After (하단 보더 `#F9FAFB` → `var(--border)`; 아이콘 반경 `9px` → `var(--r-card)`; 부가텍스트 `#6B7280` → `var(--ink-3)`; 행 배경 `#FEF7F5`·아이콘 배경 `#FEECEC`·스트로크 `#DC2626`(위험 상태)는 유지):
```html
              <div style="display:flex;gap:11px;align-items:flex-start;padding:13px 18px;border-bottom:1px solid var(--border);background:#FEF7F5;"><span style="width:30px;height:30px;border-radius:var(--r-card);background:#FEECEC;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="15" height="15" sc-camel-view-box="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2.2"><path d="M12 9v4M12 17h.01"></path><circle cx="12" cy="12" r="9"></circle></svg></span><div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:700;">{{ T.ev1 }}</div><div style="font-size:11px;color:var(--ink-3);">PACK-001 · {{ T.justNow }}</div></div></div>
```

- [ ] **Step 5: 알림 행 2(경고)를 토큰화한다**

앵커: `{{ T.ev2 }}`

Before:
```html
              <div style="display:flex;gap:11px;align-items:flex-start;padding:13px 18px;border-bottom:1px solid #F9FAFB;"><span style="width:30px;height:30px;border-radius:9px;background:#FEF3C7;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="15" height="15" sc-camel-view-box="0 0 24 24" fill="none" stroke="#D97706" stroke-width="2.2"><path d="M12 8v5"></path><circle cx="12" cy="12" r="9"></circle></svg></span><div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:700;">{{ T.ev2 }}</div><div style="font-size:11px;color:#6B7280;">PACK-004 · {{ T.m8 }}</div></div></div>
```

After (하단 보더 `#F9FAFB` → `var(--border)`; 아이콘 반경 `9px` → `var(--r-card)`; 부가텍스트 `#6B7280` → `var(--ink-3)`; 아이콘 배경 `#FEF3C7`·스트로크 `#D97706`(주의 상태)는 유지):
```html
              <div style="display:flex;gap:11px;align-items:flex-start;padding:13px 18px;border-bottom:1px solid var(--border);"><span style="width:30px;height:30px;border-radius:var(--r-card);background:#FEF3C7;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="15" height="15" sc-camel-view-box="0 0 24 24" fill="none" stroke="#D97706" stroke-width="2.2"><path d="M12 8v5"></path><circle cx="12" cy="12" r="9"></circle></svg></span><div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:700;">{{ T.ev2 }}</div><div style="font-size:11px;color:var(--ink-3);">PACK-004 · {{ T.m8 }}</div></div></div>
```

- [ ] **Step 6: 알림 행 3(완료)을 토큰화한다**

앵커: `{{ T.rl1done }}`

Before:
```html
              <div style="display:flex;gap:11px;align-items:flex-start;padding:13px 18px;"><span style="width:30px;height:30px;border-radius:9px;background:#E9F8EE;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="15" height="15" sc-camel-view-box="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg></span><div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:700;">{{ T.rl1done }}</div><div style="font-size:11px;color:#6B7280;">{{ T.min38 }}</div></div></div>
```

After (아이콘 반경 `9px` → `var(--r-card)`; 부가텍스트 `#6B7280` → `var(--ink-3)`; 아이콘 배경 `#E9F8EE`·스트로크 `#16A34A`(정상 상태)는 유지):
```html
              <div style="display:flex;gap:11px;align-items:flex-start;padding:13px 18px;"><span style="width:30px;height:30px;border-radius:var(--r-card);background:#E9F8EE;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="15" height="15" sc-camel-view-box="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg></span><div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:700;">{{ T.rl1done }}</div><div style="font-size:11px;color:var(--ink-3);">{{ T.min38 }}</div></div></div>
```

- [ ] **Step 7: 드롭다운 푸터("전체 보기")를 토큰화한다**

앵커: `sc-camel-on-click="{{ goAlerts }}"`

Before:
```html
            <div sc-camel-on-click="{{ goAlerts }}" style="cursor:pointer;text-align:center;padding:13px;border-top:1px solid #F3F4F6;font-size:13px;font-weight:700;color:#2563EB;background:#F9FAFB;">{{ T.viewAllAlerts }}</div>
```

After (상단 보더 `#F3F4F6` → `var(--border)`; 색 `#2563EB` → `var(--brand)`; 배경 `#F9FAFB` → `var(--bg-base)`):
```html
            <div sc-camel-on-click="{{ goAlerts }}" style="cursor:pointer;text-align:center;padding:13px;border-top:1px solid var(--border);font-size:13px;font-weight:700;color:var(--brand);background:var(--bg-base);">{{ T.viewAllAlerts }}</div>
```

- [ ] **Step 8: 되쓰고 왕복 검증(diff)**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py pack "설계 산출물/셀가드 프로토타입_v3.html" < /tmp/cg_g2c.html
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_g2c_verify.html
diff /tmp/cg_g2c.html /tmp/cg_g2c_verify.html && echo "왕복 OK"
```

Expected: `왕복 OK`.

- [ ] **Step 9: 상단바 구간 전체 린터 검증 (check_region == [] AND 드롭다운 glass_misuse == [])**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 - <<'PY'
import sys; sys.path.insert(0,'tools')
import bundle_io, landing_lint
m = bundle_io.unpack("설계 산출물/셀가드 프로토타입_v3.html")
top = m[m.find("<!-- main -->"):m.find("<!-- ===== DASHBOARD ===== -->")]
drop = m[m.find("top:46px;right:0"):m.find("viewAllAlerts")]
cr = landing_lint.check_region(top)
gm_drop = landing_lint.glass_misuse(drop)
print("check_region(상단바 구간):", cr if cr else "[] 통과")
print("glass_misuse(드롭다운):", gm_drop if gm_drop else "[] 통과 (드롭다운은 불투명 서피스)")
assert cr == [], "상단바 구간에 금지색/비허용 반경이 남아 있다"
assert gm_drop == [], "드롭다운에 글래스가 들어갔다 — 불투명 웜 서피스여야 한다"
print("Task 3 알림 드롭다운 + 상단바 구간 검증 통과")
PY
```

Expected: `check_region(상단바 구간): [] 통과`, `glass_misuse(드롭다운): [] 통과`, `Task 3 ... 검증 통과`.

- [ ] **Step 10: Commit**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
git commit --allow-empty -m "design(app-g2): alert dropdown to opaque warm surface

종 알림 팝오버를 var(--surface) 불투명 서피스로 토큰화(글래스 아님, 가독성 우선).
차가운 뉴트럴·비허용 반경 정합, 상태 틴트/스트로크 유지. 상단바 구간
check_region [] 통과. 번들은 gitignore라 마커 커밋."
```

---

### Task 4: 셸 브라우저 렌더 검증

**Files:**
- 편집 없음(검증 전용). 마지막에 마커 커밋만.

**Interfaces:**
- Consumes: 로컬 HTTP 서버, 브라우저(claude-in-chrome 또는 수동), 콘솔.

왕복 검증(unpack diff)은 HTML 파서 경로를 안 타므로 브라우저 렌더를 보장하지 않는다(랜딩에서 `</` 이스케이프 버그가 브라우저에서만 드러난 전례). 셸은 로그인해야 보이므로(기본 라우트는 `landing`), 로그인 모달을 거쳐 인앱 화면에서 사이드바·상단바·드롭다운을 육안 확인하고 콘솔 에러가 없는지 본다.

- [ ] **Step 1: 로컬 HTTP 서버를 띄운다**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han/설계 산출물"
python3 -m http.server 8899 &
```

- [ ] **Step 2: 브라우저로 열고 인앱 셸로 진입한다 (일반 사용자)**

`http://localhost:8899/셀가드 프로토타입_v3.html`을 연다. 랜딩이 뜨면 우측 상단 **"로그인"**(또는 "무료로 시작") 버튼을 눌러 로그인 모달을 연 뒤, 모달의 **"로그인"** 버튼(`doLogin`)을 누른다 → **배터리 관리** 화면과 함께 공유 셸이 나타난다.

확인 사항(일반 사용자 셸):
- **사이드바**: 다크 네이비가 아니라 **웜 라이트 서피스**(#EFEDE7). 로고 마크는 브랜드 그라데이션 타일 유지, 워드마크 "셀가드"는 **진한 잉크**(#141719). 선택된 메뉴만 브랜드 그라데이션 + 흰 텍스트, 비선택 메뉴는 웜 그레이(#5A6068), hover 시 아주 옅은 잉크 틴트. 하단 유저 푸터의 이름/역할이 라이트 배경에서 잘 읽힘.
- **상단바**: **프로스티드 라이트 글래스** 스티키. 본문을 **스크롤하면 콘텐츠가 상단바 뒤로 흘러 살짝 비친다**. 하단 얇은 보더만 있고 좌/우/상 보더·모서리 둥글기 없음.
- **본문 배경**: 도트 패턴이 사라지고 웜 뉴트럴(#F7F6F4) 평면.
- **버튼**: 햄버거·종·로그아웃 버튼이 흰 서피스 + 웜 보더, 언어 버튼은 브랜드 블루.

- [ ] **Step 3: 알림 드롭다운을 확인한다**

상단바 우측 **종 아이콘**을 눌러 알림 드롭다운을 연다.

확인 사항:
- 팝오버가 **불투명 흰 서피스**(배경 비침 없음)로 알림 목록 텍스트가 선명하다.
- 미읽음 배지는 오렌지(경고/알림), 행별 아이콘은 위험(빨강)/주의(주황)/정상(초록) 상태색 유지, 부가 텍스트는 웜 그레이.
- 모서리·아이콘 타일이 부드러운 라운드(토큰 반경).

- [ ] **Step 4: 관리자 셸도 확인한다 (선택)**

우측 상단 로그아웃 → 다시 로그인 모달 → **"관리자로 로그인"**(`doLoginAdmin`)을 누른다 → 관리자 대시보드 셸. 사이드바 하단에 **"일반 사용자 화면"**(exitAdmin) 링크가 웜 뉴트럴로 보이고, 워드마크 옆 **ADMIN** 칩이 렌더되는지 확인한다.

- [ ] **Step 5: 콘솔 에러를 확인한다**

브라우저 콘솔(또는 `read_console_messages`)에 에러가 없는지 본다. 특히 `Unterminated string`/템플릿 파싱 관련 에러가 없어야 한다(`</` 이스케이프 회귀 방지). 에러가 있으면 해당 Task로 돌아가 원인을 수정한다.

- [ ] **Step 6: 서버를 내리고, 본문에 글래스 누출이 없었는지 확인한다**

```bash
pkill -f "http.server 8899"
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 - <<'PY'
import sys; sys.path.insert(0,'tools')
import bundle_io, landing_lint
m = bundle_io.unpack("설계 산출물/셀가드 프로토타입_v3.html")
side = m[m.find("<!-- sidebar -->"):m.find("<!-- main -->")]
# 그룹 2가 추가한 유일한 글래스는 상단바뿐이어야 한다: 사이드바 0.
assert landing_lint.glass_misuse(side) == [], "사이드바에 글래스 누출"
# 본문(대시보드~문서끝)의 backdrop-filter 개수 — 그룹 4~6이 줄여나갈 기준선(그룹 2가 늘리지 않음).
body = m[m.find("<!-- ===== DASHBOARD ===== -->"):]
n = len(__import__("re").findall(r"backdrop-filter\s*:", body))
print(f"본문 backdrop-filter 잔존(그룹 4~6 대상): {n}건 — 그룹 2는 이 수를 늘리지 않았다")
print("Task 4 셸 렌더 검증 완료")
PY
```

Expected: 사이드바 글래스 누출 없음, 본문 backdrop-filter 잔존 수 출력(그룹 2 진입 전과 동일), `Task 4 셸 렌더 검증 완료`.

- [ ] **Step 7: Commit**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
git commit --allow-empty -m "design(app-g2): verify shared shell renders in browser

사이드바(웜 라이트)·상단바(라이트 글래스 스티키+본문 비침)·알림 드롭다운(불투명)을
로컬 서버로 열어 일반/관리자 셸 육안 확인, 콘솔 에러 없음. 그룹 2(공유 셸) 완료."
```

---

## 완료 기준

- Task 1~3의 왕복 검증(diff) 무차이.
- `check_region(사이드바 구간) == []` AND `glass_misuse(사이드바 구간) == []` (사이드바는 불투명 웜 서피스).
- `check_region(상단바 구간) == []` (상단바 프레임·버튼·알림 드롭다운 전부 웜 토큰화).
- 상단바에 `.cg-glass`가 정확히 1개(의도된 크롬 글래스), 인라인 `backdrop-filter` 0개, 도트 패턴 제거.
- `glass_misuse(알림 드롭다운) == []` (불투명 서피스).
- 브라우저에서 일반/관리자 셸이 정상 렌더, 콘솔 에러 없음, 본문이 상단바 뒤로 비침.
- 라우팅·버튼 동작·카피 무회귀.

## 이 그룹이 만든/확정한 것 (다음 그룹이 의존)

- **공유 셸이 웜 라이트 글래스 체계로 완성**: 사이드바(웜 서피스) + 상단바(라이트 글래스 스티키) + 알림 드롭다운(불투명 서피스). 그룹 3~6의 본문/모달은 이 셸 안에서 렌더된다.
- **본문 스크롤 모델**: 스크롤은 메인 컬럼(`overflow:auto`)이 담당하고 상단바는 `position:sticky;top:0;z-index:20`. 그룹 4~6의 화면은 자체 `overflow:auto`를 두지 않는다(본문 컨테이너는 `padding:24px 28px`만).
- **셸 아이콘 스트로크 hex 규칙**: SVG 속성은 `var()` 불가 → 뉴트럴 아이콘은 `#141719`(=`--ink`), 뮤트는 `#8B9099`(=`--ink-3`), 상태는 상태 토큰 값 hex.
- 그룹 1 계약(토큰·린터·상태 등급)은 이 그룹에서 그대로 재사용됐고 변경 없음.

## 다음 그룹

그룹 3(공통 컴포넌트: 카드 `.cg-surface` 표준화·테이블·게이지·차트·배지·필터·탭·모달 골격). 이 플랜이 완료되면 그룹 3 플랜을 작성한다.
