# 셀가드 앱 리디자인 — 그룹 1: 기반 (토큰·린터·상태색) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱 화면 리디자인의 기반을 만든다 — 사이드바·서피스 토큰 추가, 린터를 앱 구간까지 검사하도록 확장하고 본문 글래스 오남용 규칙을 추가, 상태색 계산 로직을 4단계로 정합.

**Architecture:** 대상은 23MB 번들(`설계 산출물/셀가드 프로토타입_v3.html`)이며 실제 마크업은 210번 줄 JSON 문자열 안에 있다. 편집은 `tools/bundle_io.py`의 unpack/pack으로만 한다. 이 그룹은 개별 화면을 건드리지 않고, 이후 모든 화면이 공유하는 계약(토큰·린터·상태 로직)만 확정한다.

**Tech Stack:** Python 3 표준 라이브러리(도구·테스트), HTML/CSS 인라인 스타일, `x-dc` 템플릿, Pretendard.

**실행 모델:** 이 플랜은 **Sonnet 5**가 실행한다. 각 단계는 완전한 before/after 코드를 담으며 추측을 요구하지 않는다. 아래 Global Constraints의 "구현 함정"은 모든 태스크에 암묵적으로 적용된다.

## Global Constraints

스펙 `docs/superpowers/specs/2026-07-19-cellguard-app-screens-light-glass-design.md`에서 그대로 가져온다.

- 대상 파일 `설계 산출물/셀가드 프로토타입_v3.html`은 **git 추적 대상이 아니다**(`.gitignore`의 `설계 산출물/`). 되돌리기가 불가능하므로 편집 전 백업한다.
- 실제 마크업은 210번 줄(0-기반 index 209) JSON 문자열 안에 있다. **손으로 편집하지 않는다.** `python3 tools/bundle_io.py unpack/pack`으로만 편집한다. 202번 줄은 22MB base64 자산 매니페스트이므로 절대 건드리지 않는다.
- `bundle_io.pack`은 마크업 내 `</`를 `<\/`로 이스케이프한다(브라우저 HTML 파서의 스크립트 조기 종료 방지). 이 처리를 우회하지 않는다.
- **왕복 검증(unpack)은 브라우저 렌더를 보장하지 않는다.** readlines 기반이라 HTML 파서 경로를 안 탄다. 각 그룹 끝에 로컬 HTTP 서버(`file://`는 확장이 차단)로 열어 육안 + 콘솔 에러를 확인한다.
- **SVG 속성에는 `var()`가 작동하지 않는다.** `stroke="{{ x }}"`처럼 값이 SVG presentation 속성에 직접 들어가면 CSS 변수는 무시된다. 이 경로는 hex 문자열을 유지하되 상태 토큰과 동일 값으로 맞춘다.
- 라우팅·상태·예시 데이터·버튼 동작(`sc-camel-on-click`)·카피를 변경하지 않는다. **예외: 상태색 계산 로직(`scoreColor`/`scoreLabel`/`riskColor`)은 Task 4에서 수정한다.**
- radius는 `12px`(`--r-card`) / `20px`(`--r-panel`) / `999px`(`--r-pill`) 3개만 쓴다.
- 상태색 4개는 상태 표시에만 쓴다: `--ok #16A34A`(정상) / `--warn #D97706`(주의) / `--alert #EA580C`(경고) / `--danger #DC2626`(위험). 임계값은 0–100 스케일에서 30/60/80.
- 이 그룹은 개별 화면(사이드바 마크업 제외)을 리디자인하지 않는다. 화면은 그룹 4~6의 일이다.
- Python은 `python3`(3.14.5), 표준 라이브러리만. 의존성 추가 없음.

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `설계 산출물/셀가드 프로토타입_v3.html` | 대상 번들. `<style>` 블록에 토큰 추가(Task 1), 상태색 JS 수정(Task 4) | 수정 |
| `tools/landing_lint.py` | 임의 구간 검사(`check_region`)로 일반화 + 본문 글래스 오남용 검사(`glass_misuse`) | 수정 |
| `tools/test_landing_lint.py` | 위 두 기능의 테스트 | 수정 |
| `tools/bundle_io.py` | 번들 왕복 도구. **변경 없음**, 재사용만 | 재사용 |

---

### Task 1: 기반 토큰 추가 (사이드바 + 서피스)

**Files:**
- Modify: `설계 산출물/셀가드 프로토타입_v3.html` (디코딩 마크업의 `:root` 블록 끝 ~L117, `.cg-glass` 정의 ~L119)

**Interfaces:**
- Consumes: `tools/bundle_io.py`의 `unpack`/`pack`/`backup` (기존)
- Produces: 아래 CSS 토큰/클래스 — 그룹 2~7이 `var(--nav-*)`, `class="cg-surface"`로 참조한다
  - `--nav-bg` `--nav-border` `--nav-ink` `--nav-ink-active`
  - `.cg-surface` 클래스

- [ ] **Step 1: 백업하고 마크업을 꺼낸다**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py backup "설계 산출물/셀가드 프로토타입_v3.html"
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_g1.html
```

- [ ] **Step 2: `:root` 블록에 사이드바 토큰을 추가한다**

`/tmp/cg_g1.html`에서 이 줄을 찾는다(앵커: `--r-pill:999px;` 다음의 `:root` 닫는 `}`):

```css
    --r-pill:999px;
  }
```

다음으로 교체한다(닫는 `}` 앞에 nav 토큰 4줄 삽입):

```css
    --r-pill:999px;

    /* 사이드바(크롬) — 콘텐츠와 구분되는 라이트 웜 앵커 */
    --nav-bg:#EFEDE7;
    --nav-border:rgba(20,23,25,.08);
    --nav-ink:#5A6068;
    --nav-ink-active:#FFFFFF;
  }
```

- [ ] **Step 3: `.cg-surface` 클래스를 추가한다**

같은 파일에서 `.cg-glass{` 로 시작하는 블록을 찾는다. 그 블록의 닫는 `}` 다음(다음 줄이 `@supports`인 지점) 사이에 `.cg-surface`를 삽입한다. 즉 이 부분:

```css
  .cg-glass{
    background:var(--glass-bg);
    -webkit-backdrop-filter:var(--glass-blur);
    backdrop-filter:var(--glass-blur);
    border:1px solid var(--glass-border);
    box-shadow:var(--glass-shadow);
    border-radius:var(--r-panel);
  }
```

바로 다음 줄에 추가한다:

```css
  .cg-surface{
    background:var(--surface);
    border:1px solid var(--border);
    border-radius:var(--r-card);
  }
```

- [ ] **Step 4: 되쓰고 왕복 검증**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py pack "설계 산출물/셀가드 프로토타입_v3.html" < /tmp/cg_g1.html
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_g1_verify.html
diff /tmp/cg_g1.html /tmp/cg_g1_verify.html && echo "왕복 OK"
grep -c -- "--nav-bg:#EFEDE7" /tmp/cg_g1_verify.html
grep -c "\.cg-surface{" /tmp/cg_g1_verify.html
```

Expected: `왕복 OK`, 두 grep 모두 `1`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
git commit --allow-empty -m "design(app-g1): add sidebar and surface tokens

--nav-bg/border/ink/ink-active 사이드바 토큰 + .cg-surface 본문 서피스 클래스.
번들은 gitignore라 마커 커밋 — 컨트롤러가 디코딩 마크업 diff로 리뷰."
```

---

### Task 2: 린터를 임의 구간 검사로 일반화

현재 `check(markup)`은 랜딩 구간만 검사한다. 앱 화면을 하나씩 리디자인하며 그 화면 구간만 검사할 수 있도록 `check_region`을 추가한다. 앱 구간은 아직 리디자인 전이라 위반이 많으므로 이 태스크는 통과를 강제하지 않고 함수만 추가한다.

**Files:**
- Modify: `tools/landing_lint.py`
- Modify: `tools/test_landing_lint.py`

**Interfaces:**
- Consumes: 기존 `check`, `landing_region`, `BANNED_COLORS`, `ALLOWED_RADII`, `EMOJI`, `FABRICATED_METRIC_LABELS`
- Produces:
  - `check_region(region: str) -> list[str]` — 이미 잘라낸 마크업 조각을 받아 규칙 위반 리스트 반환(구간 추출 없음)
  - `SIGNUP_MARK: str = "<!-- ============ SIGNUP ============ -->"`
  - `app_region(markup: str) -> str` — SIGNUP 마커부터 문서 끝까지

- [ ] **Step 1: Write the failing test**

`tools/test_landing_lint.py`의 `TestCheck` 클래스 끝(마지막 메서드 다음)에 추가한다:

```python
class TestCheckRegion(unittest.TestCase):
    def test_check_region_flags_banned_color(self):
        from landing_lint import check_region
        issues = check_region('<div style="color:#6B7280">가</div>')
        self.assertTrue(any("#6B7280" in i for i in issues))

    def test_check_region_clean_passes(self):
        from landing_lint import check_region
        self.assertEqual(check_region('<div style="color:var(--ink)">가</div>'), [])

    def test_app_region_extracts_after_signup(self):
        from landing_lint import app_region, LANDING_START_MARK, SIGNUP_MARK
        doc = (
            LANDING_START_MARK + "\n<div>랜딩</div>\n"
            + SIGNUP_MARK + "\n<div>앱화면</div>\n"
        )
        region = app_region(doc)
        self.assertIn("앱화면", region)
        self.assertNotIn("랜딩", region)

    def test_check_uses_check_region(self):
        # 기존 check(랜딩)은 여전히 동작해야 한다(하위호환)
        from landing_lint import check, LANDING_START_MARK, LANDING_END_MARK
        doc = LANDING_START_MARK + '\n<div style="color:#6B7280">가</div>\n' + LANDING_END_MARK
        self.assertTrue(any("#6B7280" in i for i in check(doc)))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools && python3 -m unittest test_landing_lint.TestCheckRegion -v`
Expected: FAIL — `ImportError: cannot import name 'check_region'`

- [ ] **Step 3: 린터를 리팩터한다**

`tools/landing_lint.py`에서 마커 상수 근처에 SIGNUP 마커를 추가한다. 기존:

```python
LANDING_START_MARK = "<!-- ============ LANDING (v3) ============ -->"
LANDING_END_MARK = "<!-- ============ SIGNUP ============ -->"
```

다음으로 바꾼다(SIGNUP 마커는 랜딩 끝 == 앱 시작이므로 별칭):

```python
LANDING_START_MARK = "<!-- ============ LANDING (v3) ============ -->"
LANDING_END_MARK = "<!-- ============ SIGNUP ============ -->"
SIGNUP_MARK = LANDING_END_MARK
```

그 다음, 현재 `check(markup)` 함수를 두 개로 분리한다. 기존 `check`는 이렇다:

```python
def check(markup):
    region = landing_region(markup)
    issues = []
    for color in BANNED_COLORS:
        ...
    return issues
```

이것을 다음으로 교체한다(본문 검사 로직을 `check_region`으로 옮기고, `check`는 랜딩 구간을 잘라 위임):

```python
def check_region(region):
    """이미 잘라낸 마크업 조각의 토큰 규칙 위반을 반환한다."""
    issues = []

    for color in BANNED_COLORS:
        pattern = re.escape(color) + r"(?![0-9A-Fa-f])"
        n = len(re.findall(pattern, region, re.IGNORECASE))
        if n:
            issues.append(f"차가운 Tailwind 색 {color} {n}회 — 웜 뉴트럴 var(--ink*) 토큰으로 교체")

    radius_violations = set()
    for decl in re.findall(r"border-radius:\s*([^;\"'}]+)", region):
        for token in decl.split():
            if not re.fullmatch(r"[0-9]+(?:px|%)?", token):
                continue
            if token in ("0", "0px", "0%"):
                continue
            if token not in ALLOWED_RADII:
                radius_violations.add(token)
    for radius in sorted(radius_violations):
        issues.append(f"허용되지 않은 border-radius {radius} — 12px/20px/999px 만 사용")

    if re.search(r"radial-gradient\(\s*circle\s*,\s*#EEF0F3", region, re.IGNORECASE):
        issues.append("배경 도트 패턴이 남아 있다 — 제거 대상")

    for m in set(EMOJI.findall(region)):
        issues.append(f"이모지 {m} 사용 — SVG 아이콘으로 교체")

    if "TRUSTED IN THE FIELD" in region:
        issues.append("STATS 트러스트 섹션이 남아 있다 — 지어낸 수치이므로 제거 대상")

    for label in FABRICATED_METRIC_LABELS:
        if label in region:
            issues.append(f"지어낸 지표 라벨 '{label}' 이 남아 있다 — 실제 운영 배포가 없으므로 제거 대상")

    return issues


def check(markup):
    """랜딩 구간을 검사한다(하위호환)."""
    return check_region(landing_region(markup))


def app_region(markup):
    """SIGNUP 마커부터 문서 끝까지(앱 구간)를 반환한다."""
    start = markup.find(SIGNUP_MARK)
    if start == -1:
        raise ValueError("SIGNUP 마커를 찾을 수 없다")
    return markup[start:]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tools && python3 -m unittest test_landing_lint -v`
Expected: PASS — 기존 테스트 전부 + 새 `TestCheckRegion` 4개 OK.

- [ ] **Step 5: 앱 구간 기준선을 기록한다**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 - <<'PY'
import sys; sys.path.insert(0,'tools')
import bundle_io, landing_lint
m = bundle_io.unpack("설계 산출물/셀가드 프로토타입_v3.html")
issues = landing_lint.check_region(landing_lint.app_region(m))
print(f"앱 구간 위반 기준선: {len(issues)}건")
PY
```

Expected: 수백 건(앱 아직 리디자인 전). 이 수는 그룹 4~6이 화면별로 줄여나갈 기준선이다. 통과 강제 없음.

- [ ] **Step 6: Commit**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
git add tools/landing_lint.py tools/test_landing_lint.py
git commit -m "feat(lint): generalize to check_region + app_region

임의 구간 검사 check_region 분리, 앱 구간 추출 app_region 추가.
check(랜딩)은 하위호환 유지. 화면별 구간 검사의 기반."
```

---

### Task 3: 본문 글래스 오남용 검사

절제적 글래스 원칙(글래스는 크롬에만, 본문은 불투명 서피스)을 기계 강제한다. 본문 화면 구간에 `backdrop-filter` 또는 `class="cg-glass"`가 있으면 위반이다. 적용은 그룹 4~6의 화면 태스크에서 하며, 이 태스크는 검사 함수와 테스트만 추가한다.

**Files:**
- Modify: `tools/landing_lint.py`
- Modify: `tools/test_landing_lint.py`

**Interfaces:**
- Produces: `glass_misuse(region: str) -> list[str]` — 구간에 글래스가 쓰였으면 위반 리스트 반환

- [ ] **Step 1: Write the failing test**

`tools/test_landing_lint.py`에 클래스를 추가한다:

```python
class TestGlassMisuse(unittest.TestCase):
    def test_flags_backdrop_filter_in_body(self):
        from landing_lint import glass_misuse
        issues = glass_misuse('<div style="backdrop-filter:blur(20px)">표</div>')
        self.assertTrue(any("글래스" in i for i in issues))

    def test_flags_cg_glass_class_in_body(self):
        from landing_lint import glass_misuse
        issues = glass_misuse('<div class="cg-surface cg-glass">표</div>')
        self.assertTrue(any("글래스" in i for i in issues))

    def test_opaque_surface_passes(self):
        from landing_lint import glass_misuse
        issues = glass_misuse('<div class="cg-surface" style="background:var(--surface)">표</div>')
        self.assertEqual(issues, [])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools && python3 -m unittest test_landing_lint.TestGlassMisuse -v`
Expected: FAIL — `ImportError: cannot import name 'glass_misuse'`

- [ ] **Step 3: `glass_misuse`를 구현한다**

`tools/landing_lint.py`의 `check_region` 함수 다음에 추가한다:

```python
def glass_misuse(region):
    """본문 구간에 글래스가 쓰였는지 검사한다.
    절제적 글래스 원칙: 글래스는 크롬(사이드바·상단바·모달·카드 헤더)에만.
    본문 화면 구간을 이 함수로 검사하고, 크롬/모달 구간에는 적용하지 않는다.
    """
    issues = []
    n_bf = len(re.findall(r"backdrop-filter\s*:", region, re.IGNORECASE))
    if n_bf:
        issues.append(f"본문에 backdrop-filter {n_bf}회 — 글래스는 크롬(사이드바·상단바·모달)에만, 본문은 .cg-surface")
    n_cg = len(re.findall(r'class="[^"]*\bcg-glass\b', region))
    if n_cg:
        issues.append(f"본문에 cg-glass 클래스 {n_cg}회 — 글래스는 크롬에만, 본문은 .cg-surface")
    return issues
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tools && python3 -m unittest test_landing_lint -v`
Expected: PASS — 전체 테스트 OK.

- [ ] **Step 5: Commit**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
git add tools/landing_lint.py tools/test_landing_lint.py
git commit -m "feat(lint): add glass_misuse check for body regions

본문에 backdrop-filter/cg-glass 사용 시 위반. 절제적 글래스 원칙을
기계 강제. 화면 구간에 적용은 그룹 4~6에서."
```

---

### Task 4: 상태색 4단계 로직 정합

게이지(`scoreColor`/`scoreLabel`)와 이벤트 tone 계산을 `CLAUDE.md`의 4단계 등급(정상/주의/경고/위험, 임계값 30/60/80)으로 정합한다. hex 값은 상태 토큰과 동일 값으로 유지한다(SVG 속성에 들어가므로 `var()` 불가). **예측 리스크(`riskColor`/`riskBg`/`riskLabel`)는 다른 축이므로 제외한다**(스펙 (b) 참조).

**Files:**
- Modify: `설계 산출물/셀가드 프로토타입_v3.html` (디코딩 마크업의 상태색 계산 JS 3곳)

**Interfaces:**
- Consumes: `tools/bundle_io.py`

- [ ] **Step 1: 마크업을 꺼낸다**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_g1b.html
```

- [ ] **Step 2: 게이지 계산을 4단계로 바꾼다**

`/tmp/cg_g1b.html`에서 이 3줄(앵커: `let scoreColor = '#16A34A', scoreLabel = '정상';`)을 찾는다:

```js
let scoreColor = '#16A34A', scoreLabel = '정상';
    if (score >= 70) { scoreColor = '#DC2626'; scoreLabel = '위험'; }
    else if (score >= 40) { scoreColor = '#EA580C'; scoreLabel = '주의'; }
```

다음으로 교체한다:

```js
let scoreColor = '#16A34A', scoreLabel = '정상';
    if (score >= 80) { scoreColor = '#DC2626'; scoreLabel = '위험'; }
    else if (score >= 60) { scoreColor = '#EA580C'; scoreLabel = '경고'; }
    else if (score >= 30) { scoreColor = '#D97706'; scoreLabel = '주의'; }
```

> 참고: 원문의 들여쓰기(줄 앞 공백)를 정확히 맞춰야 교체가 된다. 위 `if`/`else if` 줄 앞에는 공백 4칸이 있다. 실제 파일의 들여쓰기를 그대로 따른다(Edit는 정확 일치를 요구한다).

> **예측 리스크(`riskColor`/`riskBg`/`riskLabel`, L1826–1864)는 건드리지 않는다.** 이것은 현재 상태 게이지와 다른 축(향후 위험 예측, 어휘가 높음/주의/낮음)이며 4단계 정합 대상이 아니다. 그 블록의 색 토큰화는 그룹 4에서 다룬다.

- [ ] **Step 3: 이벤트 tone의 데이터-없음 색을 교체한다**

같은 파일에서 이 앵커를 찾는다: `scoreColor: e.tone === '정상' ? '#16A34A'`. 이 표현식 안에 `'#6B7280'`(데이터 없음, `e.score === '—'`일 때)이 있다. 그 `'#6B7280'` **하나만** `'#8B9099'`로 바꾼다(금지색 → `--ink-3` 값). 같은 줄의 다른 tone 색(`#16A34A`/`#D97706`/`#EA580C`/`#DC2626`)은 이미 정합이므로 건드리지 않는다.

- [ ] **Step 4: 되쓰고 검증**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py pack "설계 산출물/셀가드 프로토타입_v3.html" < /tmp/cg_g1b.html
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_g1b_v.html
# 4단계가 들어갔는지
grep -c "scoreLabel = '경고'" /tmp/cg_g1b_v.html
grep -c "score >= 80" /tmp/cg_g1b_v.html
# 랜딩 린터가 여전히 통과하는지(상태색 변경이 랜딩 구간 규칙을 깨지 않아야)
python3 tools/landing_lint.py "설계 산출물/셀가드 프로토타입_v3.html"
```

Expected: `scoreLabel = '경고'` ≥ 1, `score >= 80` ≥ 1(게이지), 린터 `토큰 규칙 통과`. (예측 리스크는 건드리지 않았으므로 L1826의 `score >= 70`은 그대로 남아 있다.)

- [ ] **Step 5: 브라우저로 게이지 무회귀를 확인한다**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han/설계 산출물"
python3 -m http.server 8899 &
```

`http://localhost:8899/셀가드 프로토타입_v3.html`을 열어, 랜딩 히어로의 이상점수 게이지가 정상 렌더되고 콘솔 에러가 없는지 확인한다. (score 예시값을 바꿔 4등급을 모두 보려면 그룹 4의 대시보드 작업에서 확인한다 — 이 태스크는 로직 정합과 무회귀가 목적이다.) 확인 후 `pkill -f "http.server 8899"`.

- [ ] **Step 6: Commit**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
git commit --allow-empty -m "design(app-g1): align status color logic to 4 grades

게이지/예측리스크/이벤트tone을 정상·주의·경고·위험 4단계(임계 30/60/80)로 정합.
누락됐던 '경고' 등급 노출. hex는 상태 토큰 값 유지(SVG 속성 var() 불가).
번들은 gitignore라 마커 커밋."
```

---

## 완료 기준

- `cd tools && python3 -m unittest discover` 전부 PASS
- `python3 tools/landing_lint.py "설계 산출물/셀가드 프로토타입_v3.html"` exit 0 (랜딩 무회귀)
- 토큰(`--nav-*`, `.cg-surface`)이 번들에 존재
- 상태색 계산에 '경고' 등급과 30/60/80 임계값이 존재
- 브라우저에서 랜딩이 정상 렌더, 콘솔 에러 없음
- 앱 구간 위반 기준선이 기록됨(그룹 4~6의 감소 목표)

## 이 그룹이 만든 계약 (다음 그룹이 의존)

- CSS 토큰: `--nav-bg #EFEDE7` / `--nav-border` / `--nav-ink #5A6068` / `--nav-ink-active #FFFFFF`
- CSS 클래스: `.cg-surface`(본문 불투명 서피스)
- 린터: `check_region(region)`, `app_region(markup)`, `glass_misuse(region)`
- 상태 등급: 30/60/80 임계값, 라벨 정상/주의/경고/위험, hex `#16A34A`/`#D97706`/`#EA580C`/`#DC2626`

## 다음 그룹

그룹 2(공유 셸: 사이드바 라이트 웜 전환 + 상단바 라이트 글래스). 이 플랜이 완료되면 그룹 2 플랜을 작성한다.
