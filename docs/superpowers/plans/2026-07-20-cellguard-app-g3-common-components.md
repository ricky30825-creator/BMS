# 셀가드 앱 리디자인 — 그룹 3: 공통 컴포넌트 (모달 골격·버튼 클래스 + 컴포넌트 레시피) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 25개 화면·17개 모달이 공유할 재사용 프리미티브를 확정한다 — (1) 17개 모달이 verbatim 복제하던 오버레이/패널/헤더/닫기/액션·버튼을 `.cg-modal-*`/`.cg-btn-*` CSS 클래스로 추출하고, (2) 그 골격을 제네릭 상세 모달에 적용해 정본(canonical) 인스턴스로 브라우저 검증하며, (3) 카드·테이블(grid)·게이지·차트·배지·탭·필터의 **확정 인라인 토큰 레시피**를 참조 문서로 못박아 그룹 4~6이 판단 없이 in-place 적용하게 한다.

**Architecture:** 대상은 23MB 번들(`설계 산출물/셀가드 프로토타입_v3.html`)이며 실제 마크업은 JSON 문자열 한 줄 안에 있다. 편집은 `python3 tools/bundle_io.py unpack/pack` 왕복으로만 한다. 앱 화면 전체가 **인라인 스타일**로 짜여 있고(클래스는 `.cg-glass`/`.cg-surface`뿐), 테이블은 `<table>`이 아니라 CSS `grid`이며 배지·탭 색은 템플릿 계산값(`{{ b.bg }}`)이다. 이 현실 때문에 그룹 3은 **"verbatim 반복되는 정적 골격"만 클래스로 추출**(모달·버튼)하고, 색·컬럼이 화면마다 다른 컴포넌트는 클래스 대신 레시피로 확정한다. 이 그룹은 개별 사용자/관리자 **화면을 리디자인하지 않는다** — 그룹 4~6의 일이다. 유일한 마크업 편집은 골격의 정본인 **제네릭 상세 모달 1개**(검증용)다.

**Tech Stack:** HTML/CSS 인라인 스타일 + `.cg-*` 클래스, `sc-camel`/`x-dc` 템플릿, Pretendard, Python 3(도구·검증).

**실행 모델:** 이 플랜은 **Sonnet 5**가 실행한다. 각 스텝은 완전한 before/after 코드와 정확한 앵커 문자열을 담으며 판단을 요구하지 않는다. 설계 판단(토큰 매핑·값 결정)은 전부 이 플랜과 Task 3의 레시피 문서에 미리 확정돼 있다. 아래 Global Constraints의 "구현 함정"은 모든 태스크에 암묵적으로 적용된다.

## Global Constraints

스펙 `docs/superpowers/specs/2026-07-19-cellguard-app-screens-light-glass-design.md`와 그룹 1·2 계약에서 그대로 가져온다. **모든 태스크에 적용된다.**

- 대상 파일 `설계 산출물/셀가드 프로토타입_v3.html`은 **git 추적 대상이 아니다**(`.gitignore`의 `설계 산출물/`). 되돌리기가 불가능하므로 그룹 시작 시(Task 1 Step 1) 백업한다. 커밋은 도구/문서만 이동하는 마커다(번들 자체는 커밋되지 않음).
- 실제 마크업은 JSON 문자열 한 줄 안에 있다. **손으로 편집하지 않는다.** `python3 tools/bundle_io.py unpack/pack`으로만 편집한다. 202번 줄 base64 자산 매니페스트는 절대 건드리지 않는다.
- `bundle_io.pack`은 마크업 내 `</`를 `<\/`로 이스케이프한다(브라우저 HTML 파서의 스크립트 조기 종료 방지). 이 처리를 우회하지 않는다.
- **왕복 검증(unpack diff)은 브라우저 렌더를 보장하지 않는다.** readlines 기반이라 HTML 파서 경로를 안 탄다. 코드 편집이 있는 태스크(Task 2)는 로컬 HTTP 서버(`file://`는 확장이 차단)로 열어 육안 + 콘솔 에러를 확인한다.
- **SVG 속성에는 `var()`가 작동하지 않는다.** `stroke="..."`, `fill="..."`처럼 값이 SVG presentation **속성**에 직접 들어가면 CSS 변수는 무시된다. 이 경로는 **hex 문자열을 유지**하되 토큰과 **동일 값**으로 맞춘다: `--ink`=`#141719`, `--ink-3`=`#8B9099`, `--ok`=`#16A34A`, `--warn`=`#D97706`, `--alert`=`#EA580C`, `--danger`=`#DC2626`. 반대로 CSS **프로퍼티**(`color:`/`background:`/`border:`/`border-radius:` 등 인라인 style 속성과 `<style>` 블록의 클래스)에는 `var(--token)`을 쓴다.
- 라우팅·상태·예시 데이터·버튼 동작(`sc-camel-on-click`)·카피 텍스트를 변경하지 않는다. 이 그룹은 **색·보더·반경·글래스 구조만** 바꾼다.
- radius는 `12px`(`var(--r-card)`) / `20px`(`var(--r-panel)`) / `999px`(`var(--r-pill)`) 3개만 쓴다.
- 상태색 4개는 상태 표시에만 쓴다(장식 재사용 금지): `--ok`(정상)/`--warn`(주의)/`--alert`(경고)/`--danger`(위험), 임계값 30/60/80.
- **절제적 글래스**: 글래스(`.cg-glass`/`backdrop-filter`)는 크롬(사이드바·상단바·모달)에만. 이 그룹에서 글래스가 새로 들어가는 곳은 **모달 오버레이(`.cg-modal-overlay`의 `backdrop-filter`)뿐**이다. 모달 **패널은 불투명 서피스**(`.cg-modal`, `var(--surface)`)다 — 폼·밀집 정보 가독성 우선(그룹 2 알림 드롭다운=불투명 결정과 일관). 본문 화면(그룹 4~6)에는 글래스를 넣지 않는다.
- 금지 색(린터 `BANNED_COLORS`): `#6B7280 #E5E7EB #F9FAFB #F3F4F6 #4B5563 #9CA3AF #374151 #111827 #D1D5DB #EEF0F3`. 이 값들은 전부 토큰으로 교체한다. 브랜드 틴트(`#EAF1FF`/`#BFD3FF`/`#CFE0FF`/`#F5F9FF`)와 상태 틴트(`#E9F8EE`/`#FEF3C7`/`#FEECEC`/`#FEF7F5`)는 금지색이 아니므로 유지한다.
- Python은 `python3`, 표준 라이브러리만. 의존성 추가 없음.

### 그룹 1·2가 만든 계약 (재사용, 재정의 금지)

- CSS 토큰(`:root`에 이미 정의됨): `--bg-base:#F7F6F4` / `--surface:#FFFFFF` / `--ink:#141719` / `--ink-2:#5A6068` / `--ink-3:#8B9099` / `--border:rgba(20,23,25,.08)` / `--brand:#2563EB` / `--brand-2:#3B82F6` / `--brand-grad:linear-gradient(135deg,#3B82F6,#2563EB)` / `--ok/--warn/--alert/--danger` / `--r-card:12px` / `--r-panel:20px` / `--r-pill:999px` / `--nav-*`.
- CSS 클래스(`<style>`에 이미 정의됨): `.cg-glass`(글래스 패널), `.cg-surface`(불투명 서피스, = 카드), `@supports` 폴백.
- 린터: `landing_lint.check_region(region)`(금지색·비허용 반경·도트·이모지·지어낸 지표), `landing_lint.app_region(markup)`, `landing_lint.glass_misuse(region)`(본문에 `backdrop-filter`/`cg-glass` 사용 시 위반). **그룹 3은 린터를 수정하지 않는다** — 재사용만 한다.
- 셸 스크롤 계약(그룹 2): 스크롤은 메인 컬럼(`overflow:auto`), 상단바 `position:sticky;top:0;z-index:20`, 알림 드롭다운 `z-index:30`. **그룹 3이 만드는 컴포넌트는 자체 `overflow:auto`를 새로 넣지 않는다**(모달 패널의 `overflow:auto`는 예외 — 모달 내부 스크롤이며 셸 스크롤과 무관). 모달 골격 z-index는 기존 스태킹 바닥(상단바 20·드롭다운 30·랜딩 nav 50)보다 높아야 한다.
- 셸 아이콘 스트로크 hex 규칙: 뉴트럴 `#141719`(=`--ink`), 뮤트 `#8B9099`(=`--ink-3`), 상태는 상태 토큰 값 hex. `currentColor`는 부모 `color`를 상속하므로 그대로 둔다.

### 이번 그룹에서 확정된 설계 결정 (사용자 승인)

1. **범위 = 모달 골격 + 버튼만 클래스.** 17개 모달이 verbatim 복제하는 오버레이/패널/헤더/닫기/액션과 버튼 3종을 `.cg-modal-*`/`.cg-btn-*` 클래스로 추출한다. 카드는 기존 `.cg-surface`를 재사용한다. 테이블(grid)·게이지·차트·배지·탭·필터는 색·컬럼이 화면마다 달라 클래스 대신 **확정 인라인 토큰 레시피**(Task 3 문서)로 못박고, 그룹 4~6이 화면별 in-place 토큰화한다(그룹 2 패턴 승계).
2. **모달 = 불투명 패널 + 글래스 오버레이.** 오버레이(`.cg-modal-overlay`)가 배경 dim + `backdrop-filter:blur(4px)`(글래스 백드롭)을 담당하고, 패널(`.cg-modal`)은 불투명 `var(--surface)`. 스펙의 "`.cg-glass` 패널" 문구보다 폼·밀집 정보 가독성과 그룹 2의 불투명 드롭다운 결정을 우선(사용자 승인).
3. **모달 오버레이 z-index = 100.** 현재 모달 z-index가 40~48로 뒤죽박죽이고, 특히 로그인 모달이 `z-index:40` < 랜딩 상단바 `z-index:50`이라 랜딩 위에서 잘못 깔리는 잠재 버그가 있다. 골격을 100으로 통일해 이를 함께 해소한다.
4. **오버레이 dim = `rgba(20,23,25,.5)`**(차가운 `rgba(15,23,42,.5)`의 웜 뉴트럴 정합), **blur(4px) 유지**.
5. **비선택 상호작용 hover = `rgba(20,23,25,.04)`**(그룹 2 사이드바/닫기 hover와 통일). 선택 상태는 브랜드로 한정.
6. **테이블(grid) 위험 행 배경 = `rgba(220,38,38,.06)`**(스펙 예시 채택, **위험 등급 행만**). **차트 격자선 = `#ECEAE8`**(=`--border`를 흰 서피스 위에 렌더한 SVG-safe hex; SVG 속성이라 `var()` 불가), **차트 면적 = 선 상태색 `.08` 알파**.
7. **검증은 제네릭 상세 모달 1개에만 골격 적용.** 개별 화면은 안 건드린다. 제네릭 상세 모달은 이름 그대로 골격의 정본이며, 이 한 개를 완전히 정리해 그룹 6이 나머지 16개에 복제할 참조로 삼는다.

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `설계 산출물/셀가드 프로토타입_v3.html` | 대상 번들. `<style>` 블록에 모달/버튼 클래스 추가(Task 1), 제네릭 상세 모달 마크업에 골격 클래스 적용(Task 2) | 수정 |
| `docs/superpowers/references/2026-07-20-cellguard-app-component-recipes.md` | 카드·테이블·게이지·차트·배지·탭·필터·모달의 확정 인라인 토큰 레시피. 그룹 4~6이 참조 | 신규 |
| `tools/bundle_io.py` | 번들 왕복 도구. **변경 없음**, 재사용만 | 재사용 |
| `tools/landing_lint.py` | 구간 린터(`check_region`/`glass_misuse`). **변경 없음**, 검증에 호출만 | 재사용 |

> **삽입 위치(참고, 실행 시점의 최신 unpack으로 앵커 재확인):** 새 CSS 클래스는 `<style>` 블록의 `.cg-surface{...}` 정의 **직후**, `@supports` 규칙 **직전**에 들어간다. 제네릭 상세 모달은 `<!-- ============ GENERIC DETAIL MODAL ============ -->`부터 `<!-- ============ USER DETAIL (INFO + LOGS) MODAL ============ -->` 사이에 있다. 줄 번호는 편집으로 이동하므로 각 스텝의 **앵커 문자열**로 찾는다.

---

### Task 1: 모달 골격 + 버튼 CSS 클래스 추가 (`<style>` 블록)

**Files:**
- Modify: `설계 산출물/셀가드 프로토타입_v3.html` (`<style>` 블록의 `.cg-surface{...}` 정의 직후)

**Interfaces:**
- Consumes: 그룹 1·2 토큰 `--surface`/`--border`/`--ink-2`/`--ink-3`/`--brand-grad`/`--danger`/`--r-card`/`--r-panel`; `cgmodal` 키프레임(이미 존재); `bundle_io.unpack/pack/backup`; `landing_lint.check_region`.
- Produces (그룹 6이 `class="..."`로 참조):
  - `.cg-modal-overlay` — 고정 오버레이(dim + `backdrop-filter:blur(4px)`, `z-index:100`)
  - `.cg-modal` — 불투명 패널(`var(--surface)`, 기본 width 480px, `max-height:88vh`, `overflow:auto`, `padding:26px`, `gap:16px`, `animation:cgmodal .3s ease`)
  - `.cg-modal-head` — 헤더 flex row
  - `.cg-modal-title` — 제목 타이포(19px/800)
  - `.cg-modal-close` — 닫기 X 버튼(34×34, `color:var(--ink-3)`, hover 틴트)
  - `.cg-modal-actions` — 액션 버튼 row(`display:flex;gap:10px`)
  - `.cg-btn-primary` / `.cg-btn-ghost` / `.cg-btn-danger` — 버튼 우선순위 3종(자기완결형 단일 클래스)

이 태스크는 CSS 클래스만 추가하며 화면 마크업은 건드리지 않는다. 렌더 변화는 없다(아직 아무 데도 적용 안 됨). 검증은 왕복 diff + 새 블록의 `check_region == []` + "글래스는 오버레이에만" 불변식이다.

- [ ] **Step 1: 백업하고 마크업을 꺼낸다**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py backup "설계 산출물/셀가드 프로토타입_v3.html"
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_g3a.html
```

- [ ] **Step 2: `.cg-surface` 정의 직후에 모달/버튼 클래스를 삽입한다**

`/tmp/cg_g3a.html`에서 이 블록(앵커: `.cg-surface{` 로 시작하고 `border-radius:var(--r-card);` 로 닫히는 정의)을 찾는다.

Before:
```css
  .cg-surface{
    background:var(--surface);
    border:1px solid var(--border);
    border-radius:var(--r-card);
  }
  @supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
```

After (`.cg-surface` 블록은 그대로 두고, 그 닫는 `}`와 `@supports` 사이에 아래 클래스들을 삽입한다):
```css
  .cg-surface{
    background:var(--surface);
    border:1px solid var(--border);
    border-radius:var(--r-card);
  }
  /* ===== 모달 골격 (크롬) — 17개 모달이 공유. 글래스는 오버레이(백드롭)에만, 패널은 불투명. ===== */
  .cg-modal-overlay{
    position:fixed;
    inset:0;
    z-index:100;
    background:rgba(20,23,25,.5);
    -webkit-backdrop-filter:blur(4px);
    backdrop-filter:blur(4px);
    display:flex;
    align-items:center;
    justify-content:center;
    padding:24px;
  }
  .cg-modal{
    width:480px;
    max-width:100%;
    max-height:88vh;
    overflow:auto;
    background:var(--surface);
    border:1px solid var(--border);
    border-radius:var(--r-panel);
    padding:26px;
    display:flex;
    flex-direction:column;
    gap:16px;
    animation:cgmodal .3s ease;
  }
  .cg-modal-head{
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    gap:12px;
  }
  .cg-modal-title{
    font-size:19px;
    font-weight:800;
    letter-spacing:-.01em;
    line-height:1.3;
  }
  .cg-modal-close{
    cursor:pointer;
    width:34px;
    height:34px;
    flex-shrink:0;
    border-radius:var(--r-card);
    display:flex;
    align-items:center;
    justify-content:center;
    color:var(--ink-3);
  }
  .cg-modal-close:hover{ background:rgba(20,23,25,.04); }
  .cg-modal-actions{
    display:flex;
    gap:10px;
  }
  /* ===== 공용 버튼 — 우선순위 3종. flex:1 등 레이아웃은 인라인으로 얹는다. ===== */
  .cg-btn-primary{
    cursor:pointer;
    text-align:center;
    font-size:14px;
    font-weight:700;
    padding:13px;
    border-radius:var(--r-card);
    border:1px solid transparent;
    color:#fff;
    background:var(--brand-grad);
  }
  .cg-btn-ghost{
    cursor:pointer;
    text-align:center;
    font-size:14px;
    font-weight:700;
    padding:13px;
    border-radius:var(--r-card);
    color:var(--ink-2);
    background:var(--surface);
    border:1px solid var(--border);
  }
  .cg-btn-danger{
    cursor:pointer;
    text-align:center;
    font-size:14px;
    font-weight:700;
    padding:13px;
    border-radius:var(--r-card);
    border:1px solid transparent;
    color:#fff;
    background:var(--danger);
  }
  @supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
```

> 주의: `.cg-modal`은 패널에 **얇은 보더**(`1px solid var(--border)`)를 준다 — 기존 모달 패널엔 없던 것으로, 라이트 서피스 위 가장자리를 또렷하게 하는 의도된 미세 개선이다. width/gap/padding 기본값(480/16/26)은 제네릭 상세 모달과 동일하므로 그 모달은 인라인 오버라이드가 필요 없다. 더 넓은 모달(520/560px)은 그룹 6에서 `style="width:560px;"`로 인라인 오버라이드한다.

- [ ] **Step 3: 되쓰고 왕복 검증(diff)**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py pack "설계 산출물/셀가드 프로토타입_v3.html" < /tmp/cg_g3a.html
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_g3a_verify.html
diff /tmp/cg_g3a.html /tmp/cg_g3a_verify.html && echo "왕복 OK"
```

Expected: `왕복 OK`(무차이).

- [ ] **Step 4: 새 클래스가 존재하고, 토큰 규칙을 지키며, 글래스가 오버레이에만 있는지 검증한다**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 - <<'PY'
import sys, re; sys.path.insert(0,'tools')
import bundle_io, landing_lint
m = bundle_io.unpack("설계 산출물/셀가드 프로토타입_v3.html")

# 1) 새 클래스 8종이 모두 정의됐는지
for cls in [".cg-modal-overlay{", ".cg-modal{", ".cg-modal-head{", ".cg-modal-title{",
            ".cg-modal-close{", ".cg-modal-actions{", ".cg-btn-primary{",
            ".cg-btn-ghost{", ".cg-btn-danger{"]:
    assert m.count(cls) == 1, f"{cls} 가 1회가 아니다 ({m.count(cls)}회)"

# 2) 삽입 블록(.cg-modal-overlay ~ @supports 직전)만 잘라 토큰 규칙 검사
blk = m[m.find(".cg-modal-overlay{"):m.find("@supports not ((backdrop-filter")]
cr = landing_lint.check_region(blk)
print("check_region(새 클래스 블록):", cr if cr else "[] 통과")
assert cr == [], "새 클래스 블록에 금지색/비허용 반경이 있다"

# 3) 절제적 글래스 불변식: backdrop-filter 는 .cg-modal-overlay 안에만.
overlay = blk[blk.find(".cg-modal-overlay{"):blk.find(".cg-modal{")]
panel   = blk[blk.find(".cg-modal{"):blk.find(".cg-modal-head{")]
assert "backdrop-filter" in overlay, "오버레이에 backdrop-filter 가 없다"
assert "backdrop-filter" not in panel, "패널에 backdrop-filter 가 있다 — 패널은 불투명이어야 한다"
# 블록 전체의 backdrop-filter 는 오버레이의 2건(webkit + 표준)뿐이어야 한다.
assert len(re.findall(r"backdrop-filter\s*:", blk)) == 2, "오버레이 외에 backdrop-filter 가 더 있다"

# 4) z-index 100 (스태킹 바닥 20/30/50 위)
assert "z-index:100;" in overlay, "오버레이 z-index 가 100 이 아니다"
print("Task 1 모달/버튼 클래스 검증 통과")
PY
```

Expected: `check_region(새 클래스 블록): [] 통과`, `Task 1 모달/버튼 클래스 검증 통과`.

- [ ] **Step 5: 랜딩 무회귀 확인(기존 린터 CLI)**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/landing_lint.py "설계 산출물/셀가드 프로토타입_v3.html"
```

Expected: `토큰 규칙 통과`(exit 0). 스타일 블록에 클래스만 추가했으므로 랜딩 구간 규칙은 그대로다.

- [ ] **Step 6: Commit**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
git commit --allow-empty -m "design(app-g3): add modal skeleton + button classes

.cg-modal-overlay(z-index:100, dim rgba(20,23,25,.5)+blur(4px))/.cg-modal(불투명
var(--surface) 패널)/.cg-modal-head/-title/-close/-actions + .cg-btn-primary/ghost/danger.
글래스는 오버레이에만, 패널 불투명. 화면 마크업 미변경. 번들은 gitignore라 마커 커밋 —
컨트롤러가 디코딩 마크업 diff로 리뷰."
```

---

### Task 2: 제네릭 상세 모달에 골격 클래스 적용 (정본 인스턴스 + 브라우저 검증)

**Files:**
- Modify: `설계 산출물/셀가드 프로토타입_v3.html` (제네릭 상세 모달 마크업 `<!-- GENERIC DETAIL MODAL -->` 블록)

**Interfaces:**
- Consumes: Task 1의 `.cg-modal-overlay`/`.cg-modal`/`.cg-modal-head`/`.cg-modal-title`/`.cg-modal-close`/`.cg-btn-primary`; 토큰 `--r-pill`/`--ink-3`/`--ink-2`/`--bg-base`/`--border`/`--ink`; `bundle_io`; `landing_lint.check_region/glass_misuse`.
- Produces: 그룹 6이 나머지 16개 모달에 복제할 정본(canonical) 골격 인스턴스.

이 태스크는 제네릭 상세 모달의 오버레이·패널·헤더·닫기·액션을 Task 1 클래스로 치환하고, 그 본문(배지·부제·본문 박스·행 리스트)의 금지색·비허용 반경을 토큰으로 정합한다. 결과적으로 이 한 개 모달이 완전히 라이트 웜 체계로 정리돼 `check_region == []` + `glass_misuse == []`가 된다. 라우팅·닫기 동작·카피는 그대로다.

- [ ] **Step 1: 마크업을 꺼낸다**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_g3b.html
```

- [ ] **Step 2: 제네릭 상세 모달 전체를 골격 클래스 + 토큰으로 교체한다**

`/tmp/cg_g3b.html`에서 이 블록(앵커: `sc-camel-on-click="{{ closeDetail }}" style="position:fixed;inset:0;z-index:47;`)을 찾는다. `<!-- ============ GENERIC DETAIL MODAL ============ -->` 주석 바로 아래, `<sc-if value="{{ detail }}">` 다음의 `<div>`부터 그 닫는 `</div>`까지다.

Before:
```html
  <div sc-camel-on-click="{{ closeDetail }}" style="position:fixed;inset:0;z-index:47;background:rgba(15,23,42,.5);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:24px;">
    <div style="width:480px;max-width:100%;max-height:88vh;overflow:auto;background:#fff;border-radius:20px;padding:26px;display:flex;flex-direction:column;gap:16px;animation:cgmodal .3s ease;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div style="flex:1;"><span style="display:inline-block;font-size:11px;font-weight:700;color:{{ detail.badgeColor }};background:{{ detail.badgeBg }};padding:3px 10px;border-radius:99px;margin-bottom:8px;">{{ detail.badge }}</span><div style="font-size:19px;font-weight:800;letter-spacing:-.01em;line-height:1.3;">{{ detail.title }}</div><div style="font-size:13px;color:#6B7280;margin-top:4px;">{{ detail.sub }}</div></div>
        <span sc-camel-on-click="{{ closeDetail }}" style="cursor:pointer;width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;color:#6B7280;flex-shrink:0;"><svg width="18" height="18" sc-camel-view-box="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"></path></svg></span>
      </div>
      <sc-if value="{{ detail.body }}"><div style="font-size:14px;color:#374151;line-height:1.65;background:#F9FAFB;border-radius:12px;padding:16px 18px;">{{ detail.body }}</div></sc-if>
      <sc-if value="{{ detail.rows }}">
      <div style="display:flex;flex-direction:column;gap:2px;border:1px solid #F3F4F6;border-radius:12px;overflow:hidden;">
        <sc-for list="{{ detail.rows }}" as="r" hint-placeholder-count="4"><div style="display:grid;grid-template-columns:110px 1fr;gap:12px;padding:12px 16px;border-bottom:1px solid #F9FAFB;font-size:13px;"><span style="color:#6B7280;font-weight:600;">{{ r.k }}</span><span style="font-weight:600;color:#111827;">{{ r.v }}</span></div></sc-for>
      </div>
      </sc-if>
      <span sc-camel-on-click="{{ closeDetail }}" style="cursor:pointer;text-align:center;font-size:14px;font-weight:700;color:#fff;padding:13px;border-radius:11px;background:linear-gradient(135deg,#3B82F6,#2563EB);">닫기</span>
    </div>
  </div>
```

After (오버레이/패널/헤더/닫기 → 골격 클래스; 배지 반경 `99px`→`var(--r-pill)` + 템플릿 색 유지; 부제 `#6B7280`→`var(--ink-3)`; 제목 → `.cg-modal-title`; 본문 박스 `#374151`→`var(--ink-2)`·`#F9FAFB`→`var(--bg-base)`·`12px`→`var(--r-card)`; 행 컨테이너 `#F3F4F6`→`var(--border)`·`12px`→`var(--r-card)`; 행 `#F9FAFB`→`var(--border)`·키 `#6B7280`→`var(--ink-3)`·값 `#111827`→`var(--ink)`; 닫기 버튼 → `.cg-btn-primary`. 닫기 X의 `stroke="currentColor"`는 `.cg-modal-close`의 `color:var(--ink-3)`를 상속하므로 그대로 둔다):
```html
  <div sc-camel-on-click="{{ closeDetail }}" class="cg-modal-overlay">
    <div class="cg-modal">
      <div class="cg-modal-head">
        <div style="flex:1;"><span style="display:inline-block;font-size:11px;font-weight:700;color:{{ detail.badgeColor }};background:{{ detail.badgeBg }};padding:3px 10px;border-radius:var(--r-pill);margin-bottom:8px;">{{ detail.badge }}</span><div class="cg-modal-title">{{ detail.title }}</div><div style="font-size:13px;color:var(--ink-3);margin-top:4px;">{{ detail.sub }}</div></div>
        <span sc-camel-on-click="{{ closeDetail }}" class="cg-modal-close"><svg width="18" height="18" sc-camel-view-box="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"></path></svg></span>
      </div>
      <sc-if value="{{ detail.body }}"><div style="font-size:14px;color:var(--ink-2);line-height:1.65;background:var(--bg-base);border-radius:var(--r-card);padding:16px 18px;">{{ detail.body }}</div></sc-if>
      <sc-if value="{{ detail.rows }}">
      <div style="display:flex;flex-direction:column;gap:2px;border:1px solid var(--border);border-radius:var(--r-card);overflow:hidden;">
        <sc-for list="{{ detail.rows }}" as="r" hint-placeholder-count="4"><div style="display:grid;grid-template-columns:110px 1fr;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);font-size:13px;"><span style="color:var(--ink-3);font-weight:600;">{{ r.k }}</span><span style="font-weight:600;color:var(--ink);">{{ r.v }}</span></div></sc-for>
      </div>
      </sc-if>
      <span sc-camel-on-click="{{ closeDetail }}" class="cg-btn-primary">닫기</span>
    </div>
  </div>
```

> 참고: 제네릭 상세 모달 패널은 원래 stop-propagation(`sc-camel-on-click="{{ stop }}"`)이 **없었다**(패널 클릭도 닫힘). 동작 무회귀를 위해 그대로 두지 않는다 — 즉 `.cg-modal`에 stop을 **추가하지 않는다**. `border-radius:12px`→`var(--r-card)`는 값 동일(12px), `border-radius:11px`(닫기 버튼)은 `.cg-btn-primary`의 `var(--r-card)`(12px)로 흡수된다.

- [ ] **Step 3: 되쓰고 왕복 검증(diff)**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py pack "설계 산출물/셀가드 프로토타입_v3.html" < /tmp/cg_g3b.html
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_g3b_verify.html
diff /tmp/cg_g3b.html /tmp/cg_g3b_verify.html && echo "왕복 OK"
```

Expected: `왕복 OK`.

- [ ] **Step 4: 제네릭 상세 모달 구간 린터 검증 (check_region == [] AND glass_misuse == [])**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 - <<'PY'
import sys; sys.path.insert(0,'tools')
import bundle_io, landing_lint
m = bundle_io.unpack("설계 산출물/셀가드 프로토타입_v3.html")
gen = m[m.find("<!-- ============ GENERIC DETAIL MODAL"):m.find("<!-- ============ USER DETAIL (INFO")]
cr = landing_lint.check_region(gen)
gm = landing_lint.glass_misuse(gen)
print("check_region(제네릭 상세 모달):", cr if cr else "[] 통과")
print("glass_misuse(제네릭 상세 모달):", gm if gm else "[] 통과")
assert cr == [], "제네릭 상세 모달에 금지색/비허용 반경이 남아 있다"
# 오버레이 backdrop-filter 는 이제 .cg-modal-overlay 클래스(스타일 블록) 안에 있고
# 마크업엔 인라인 backdrop-filter 도 cg-glass 클래스도 없으므로 glass_misuse 는 [].
assert gm == [], "제네릭 상세 모달 마크업에 인라인 글래스가 남아 있다"
# 골격 클래스가 실제로 적용됐는지
assert 'class="cg-modal-overlay"' in gen, "오버레이 클래스 미적용"
assert 'class="cg-modal"' in gen, "패널 클래스 미적용"
assert 'class="cg-btn-primary"' in gen, "닫기 버튼 클래스 미적용"
print("Task 2 제네릭 상세 모달 골격 검증 통과")
PY
```

Expected: `check_region(제네릭 상세 모달): [] 통과`, `glass_misuse(제네릭 상세 모달): [] 통과`, `Task 2 제네릭 상세 모달 골격 검증 통과`.

- [ ] **Step 5: 로컬 HTTP 서버로 브라우저 렌더 확인**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han/설계 산출물"
python3 -m http.server 8899 &
```

`http://localhost:8899/셀가드 프로토타입_v3.html`을 연다. 랜딩 → 로그인 모달의 **"로그인"**(`doLogin`)으로 인앱 셸에 진입한다.

**제네릭 상세 모달을 여는 트리거 찾기:** 이 모달은 `{{ detail }}` 상태가 truthy일 때 뜬다. 무엇이 `detail`을 세팅하는지 unpack 마크업에서 확인한다:

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" | grep -oE "sc-camel-on-click=\"\{\{ [a-zA-Z]+ \}\}\"" | sort -u | grep -iE "detail|view|open" | head
```

찾은 액션(예: 이벤트/이상탐지/감사 로그 목록의 "상세 보기" 항목)을 눌러 제네릭 상세 모달을 연다.

확인 사항:
- **오버레이**: 배경이 웜하게 dim 되고 살짝 blur 된다(글래스 백드롭). 모달이 랜딩/셸 위(z-index:100)로 확실히 뜬다.
- **패널**: **불투명 흰 서피스**(배경 비침 없음) — 제목·부제·본문·행 텍스트가 선명하다. 얇은 웜 보더 + `--r-panel`(20px) 라운드.
- **본문/행**: 본문 박스는 웜 뉴트럴 배경(`--bg-base`), 행 구분선은 웜 보더, 키는 뮤트 그레이·값은 진한 잉크.
- **버튼/닫기**: "닫기" 버튼은 브랜드 그라데이션(`.cg-btn-primary`), 우상단 X는 뮤트 톤이며 hover 시 옅은 틴트. 클릭하면 모달이 닫힌다(동작 무회귀).

> 트리거를 못 찾으면: 최소한 아무 모달(로그인 모달 등, 같은 오버레이 패턴)을 열어 오버레이 dim+blur가 정상인지 보고, 제네릭 상세 모달 골격 자체는 Step 4의 `check_region`/`glass_misuse` `[]` + 왕복검증으로 보증한다(마크업 편집이 작고 새 `</` 도입이 없어 파서 회귀 위험이 낮다).

- [ ] **Step 6: 콘솔 에러 확인 후 서버를 내린다**

브라우저 콘솔(또는 `read_console_messages`)에 에러가 없는지 본다. 특히 `Unterminated string`/템플릿 파싱 에러가 없어야 한다(`</` 이스케이프 회귀 방지). 에러가 있으면 Task 2로 돌아가 원인을 수정한다.

```bash
pkill -f "http.server 8899"
```

- [ ] **Step 7: Commit**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
git commit --allow-empty -m "design(app-g3): apply modal skeleton to generic detail modal

제네릭 상세 모달(골격 정본)을 .cg-modal-overlay/.cg-modal/.cg-modal-head/-title/
-close + .cg-btn-primary 로 치환하고 본문·행을 토큰 정합. check_region [] + glass_misuse [].
불투명 패널 + 글래스 오버레이 브라우저 확인, 콘솔 에러 없음. 그룹 6이 이걸 나머지
16개 모달에 복제. 번들은 gitignore라 마커 커밋."
```

---

### Task 3: 컴포넌트 인라인 토큰 레시피 참조 문서 작성

**Files:**
- Create: `docs/superpowers/references/2026-07-20-cellguard-app-component-recipes.md`

**Interfaces:**
- Consumes: 그룹 1·2 토큰/클래스, Task 1의 모달/버튼 클래스, 이 그룹의 확정 값(z-index 100·dim·위험행 `.06`·격자선 `#ECEAE8`·hover `.04`).
- Produces: 그룹 4~6이 화면별 in-place 토큰화 시 **판단 없이 복사할 레시피**. 카드·테이블(grid)·게이지·차트·배지·탭·필터·모달의 before(금지색 인라인)→after(토큰) 매핑을 못박는다.

이 태스크는 코드가 아니라 문서다. 아래 전체 내용을 그대로 파일에 쓴다(설계 판단은 이미 확정됨 — 실행자는 추가 결정을 하지 않는다). `references/` 디렉터리가 없으면 함께 생성된다.

- [ ] **Step 1: 참조 문서를 작성한다**

`docs/superpowers/references/2026-07-20-cellguard-app-component-recipes.md`에 아래 내용을 그대로 쓴다:

````markdown
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
````

- [ ] **Step 2: 문서가 생성됐고 내부 참조가 일관되는지 확인한다**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
test -f docs/superpowers/references/2026-07-20-cellguard-app-component-recipes.md && echo "파일 존재"
grep -c "rgba(220,38,38,.06)" docs/superpowers/references/2026-07-20-cellguard-app-component-recipes.md
grep -c "#ECEAE8" docs/superpowers/references/2026-07-20-cellguard-app-component-recipes.md
grep -c "rgba(20,23,25,.04)" docs/superpowers/references/2026-07-20-cellguard-app-component-recipes.md
grep -c "cg-modal-overlay" docs/superpowers/references/2026-07-20-cellguard-app-component-recipes.md
```

Expected: `파일 존재`, 각 grep ≥ 1(확정 값들이 문서에 박혀 있음).

- [ ] **Step 3: Commit**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
git add docs/superpowers/references/2026-07-20-cellguard-app-component-recipes.md
git commit -m "docs: lock CellGuard app component inline token recipes (group 3)

카드(.cg-surface)/테이블(grid)/게이지/차트/배지/탭/필터/모달(.cg-modal-*)의
금지색→토큰 인라인 레시피 확정. 위험행 rgba(220,38,38,.06)·격자선 #ECEAE8·
hover rgba(20,23,25,.04) 등 그룹 3 결정 포함. 그룹 4~6이 판단 없이 복사."
```

---

## 완료 기준

- Task 1~2의 왕복 검증(diff) 무차이.
- 새 클래스 9종(`.cg-modal-overlay`/`.cg-modal`/`.cg-modal-head`/`.cg-modal-title`/`.cg-modal-close`/`.cg-modal-actions`/`.cg-btn-primary`/`.cg-btn-ghost`/`.cg-btn-danger`)이 각각 1회 정의됨.
- 새 클래스 블록 `check_region == []`, `backdrop-filter`는 `.cg-modal-overlay`에만(2건), 오버레이 `z-index:100`.
- 제네릭 상세 모달 구간 `check_region == []` AND `glass_misuse == []`(불투명 패널, 인라인 글래스 없음), 골격 클래스 3종 적용됨.
- 브라우저에서 제네릭 상세 모달(또는 최소한 오버레이 패턴)이 불투명 패널 + 글래스 오버레이로 정상 렌더, 콘솔 에러 없음, 닫기 동작 무회귀.
- 컴포넌트 레시피 문서가 생성·커밋되고 그룹 3 확정 값(위험행 `.06`·격자선 `#ECEAE8`·hover `.04`·z-index 100)을 담음.
- 랜딩 린터 무회귀(`landing_lint.py` exit 0).

## 이 그룹이 만든/확정한 것 (다음 그룹이 의존)

- **모달 골격 클래스** `.cg-modal-overlay`(z-index 100, dim+blur 오버레이)/`.cg-modal`(불투명 패널)/`.cg-modal-head`/`.cg-modal-title`/`.cg-modal-close`/`.cg-modal-actions`. **그룹 6**이 나머지 16개 모달을 이걸로 통일한다(정본 = 제네릭 상세 모달).
- **버튼 클래스** `.cg-btn-primary`/`.cg-btn-ghost`/`.cg-btn-danger`. 모달·화면 공용.
- **컴포넌트 인라인 레시피 문서**: 카드(`.cg-surface`)·테이블(grid)·게이지·차트·배지·탭·필터의 금지색→토큰 매핑. **그룹 4~5**가 화면별 in-place 토큰화 시 판단 없이 복사한다.
- **확정 값**: 위험 행 배경 `rgba(220,38,38,.06)`, 차트 격자선 `#ECEAE8`, 차트 면적 `.08` 알파, 상호작용 hover `rgba(20,23,25,.04)`, 모달 오버레이 dim `rgba(20,23,25,.5)`+blur(4px)/z-index 100.
- 그룹 1·2 계약(토큰·린터·상태 등급·셸 스크롤)은 이 그룹에서 그대로 재사용됐고 변경 없음.

## 다음 그룹

그룹 4(일반 사용자 화면 11: 대시보드~설정). 화면별로 카드=`.cg-surface`, 테이블/게이지/차트/배지/탭/필터=레시피 문서 인라인 토큰화, 모달 트리거는 그대로. 이 플랜이 완료되면 그룹 4 플랜을 작성한다.
