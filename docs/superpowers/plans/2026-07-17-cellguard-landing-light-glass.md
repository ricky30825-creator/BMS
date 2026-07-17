# 셀가드 랜딩 라이트 글래스 리디자인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `설계 산출물/셀가드 프로토타입_v3.html`의 랜딩 페이지를 웜 뉴트럴 베이스 + 라이트 글래스모피즘으로 재디자인한다. 유저플로우와 버튼 동작은 그대로 둔다.

**Architecture:** 대상 파일은 23MB 번들이고 실제 마크업은 210번 줄의 JSON 문자열 안에 인라인 스타일로 들어 있다. 손으로 편집하면 JSON 이스케이프가 깨지므로, 먼저 **번들 왕복 도구**(`tools/bundle_io.py`)를 만들어 `unpack → 편집 → pack` 사이클을 안전하게 만든다. 그 다음 디자인 토큰을 `<helmet>` CSS 변수로 심고, 섹션을 하나씩 교체한다. 각 디자인 태스크는 **린터**(`tools/landing_lint.py`)가 토큰 준수를 기계적으로 검증한다 — 이 프로토타입은 React 구현이 따라갈 기준이므로 토큰 규칙이 실제로 지켜지는지 자동 확인이 필요하다.

**Tech Stack:** Python 3 (표준 라이브러리만, 의존성 추가 없음), HTML/CSS 인라인 스타일, `x-dc` 템플릿, Pretendard(번들 내장)

## Global Constraints

- 대상 파일: `설계 산출물/셀가드 프로토타입_v3.html` — **git이 추적하지 않는다**(`.gitignore:16`이 `설계 산출물/` 제외). git으로 되돌릴 수 없으니 편집 전 반드시 백업한다.
- `scripts/`도 gitignore 대상이다. 커밋할 도구는 **`tools/`**에 만든다.
- 라우팅·상태·예시 데이터·버튼 동작(`sc-camel-on-click` 값)을 변경하지 않는다.
- 카피 문구를 변경하지 않는다. "1초 단위 실시간 수집"이 실제 스펙(100ms)과 어긋나지만 이번 범위 밖이다.
- 요금제/가격표를 추가하지 않는다. 셀가드에 가격 모델이 없다.
- 트러스트 배지를 추가하지 않는다. 실제 고객사·인증이 없다.
- 로고는 기존 자산 유지: 파란 라운드 스퀘어(`#2563EB`) + 흰 번개 볼트 + "셀가드" 워드마크.
- 이모지를 아이콘으로 쓰지 않는다. SVG(Lucide 계열)만 쓴다.
- 외부 라이브러리·프레임워크 전환·파일 분리 없음.
- 작업 범위는 **랜딩 구간(디코딩 기준 116–354줄)만**이다. 355줄 이후(`SIGNUP`, `FIND`, `APP SHELL` 등 20개 라우트)는 건드리지 않는다.
- radius는 `12px` / `20px` / `999px` 3개만 쓴다.
- 상태색 4개는 상태 표시에만 쓴다: `--ok #16A34A`(정상) / `--warn #D97706`(주의) / `--alert #EA580C`(경고) / `--danger #DC2626`(위험).
- 모션은 150–300ms, `transform`/`opacity`만. `prefers-reduced-motion` 존중.

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `tools/bundle_io.py` | 번들 210번 줄 JSON ↔ 마크업 왕복(unpack/pack), 백업 | 생성 |
| `tools/test_bundle_io.py` | 왕복 무결성 테스트 | 생성 |
| `tools/landing_lint.py` | 랜딩 구간 토큰 준수 검사(색·radius·이모지·이스케이프) | 생성 |
| `tools/test_landing_lint.py` | 린터 자체 테스트 | 생성 |
| `설계 산출물/셀가드 프로토타입_v3.html` | 대상 번들 | 수정 |
| `설계 산출물/아카이브/셀가드 프로토타입_v3 백업_2026-07-17.html` | 편집 전 백업 | 생성 |

`bundle_io.py`와 `landing_lint.py`는 책임이 다르다 — 전자는 파일 입출력, 후자는 규칙 검사다. `landing_lint.check()`는 마크업 문자열만 받으므로 `bundle_io`에 의존하지 않는다(그래서 번들 없이 테스트할 수 있다). `landing_lint`의 CLI 진입점만 편의를 위해 `bundle_io.unpack`을 쓴다.

---

### Task 1: 번들 왕복 도구

편집 사이클의 토대. 이게 깨지면 23MB 파일이 복구 불능이 되므로 가장 먼저, 테스트와 함께 만든다.

**Files:**
- Create: `tools/bundle_io.py`
- Test: `tools/test_bundle_io.py`

**Interfaces:**
- Produces:
  - `unpack(bundle_path: str) -> str` — 번들에서 마크업 HTML 문자열을 반환
  - `pack(bundle_path: str, markup: str) -> None` — 마크업을 JSON 인코딩해 210번 줄에 되쓴다
  - `backup(bundle_path: str) -> str` — 백업 경로를 반환
  - `TEMPLATE_LINE_INDEX: int = 209` — 0-기반 인덱스(1-기반 210번 줄)

- [ ] **Step 1: Write the failing test**

`tools/test_bundle_io.py`:

```python
import json
import os
import tempfile
import unittest

from bundle_io import TEMPLATE_LINE_INDEX, backup, pack, unpack

MARKUP = '<html><body><div style="color:#6B7280">가 / 나</div></body></html>'


def make_fake_bundle(path):
    lines = ["<!DOCTYPE html>\n"] * TEMPLATE_LINE_INDEX
    lines.append(json.dumps(MARKUP) + "\n")
    lines.append("</html>\n")
    with open(path, "w", encoding="utf-8") as f:
        f.writelines(lines)


class TestBundleIO(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.bundle = os.path.join(self.dir, "b.html")
        make_fake_bundle(self.bundle)

    def test_unpack_returns_markup(self):
        self.assertEqual(unpack(self.bundle), MARKUP)

    def test_roundtrip_is_identity(self):
        pack(self.bundle, unpack(self.bundle))
        self.assertEqual(unpack(self.bundle), MARKUP)

    def test_pack_preserves_other_lines(self):
        with open(self.bundle, encoding="utf-8") as f:
            before = f.readlines()
        pack(self.bundle, "<html>새</html>")
        with open(self.bundle, encoding="utf-8") as f:
            after = f.readlines()
        self.assertEqual(len(before), len(after))
        self.assertEqual(before[0], after[0])
        self.assertEqual(before[-1], after[-1])
        self.assertEqual(unpack(self.bundle), "<html>새</html>")

    def test_pack_rejects_non_ascii_escape_corruption(self):
        pack(self.bundle, MARKUP)
        with open(self.bundle, encoding="utf-8") as f:
            line = f.readlines()[TEMPLATE_LINE_INDEX]
        self.assertEqual(json.loads(line.strip()), MARKUP)

    def test_backup_creates_copy(self):
        dest = backup(self.bundle)
        self.assertTrue(os.path.exists(dest))
        with open(dest, encoding="utf-8") as f:
            self.assertEqual(json.loads(f.readlines()[TEMPLATE_LINE_INDEX].strip()), MARKUP)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools && python3 -m unittest test_bundle_io -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'bundle_io'`

- [ ] **Step 3: Write minimal implementation**

`tools/bundle_io.py`:

```python
"""셀가드 프로토타입 번들의 마크업 레이어를 안전하게 읽고 쓴다.

번들은 23MB 단일 HTML이며 실제 마크업은 210번 줄(1-기반)의 JSON 문자열
하나에 들어 있다. 202번 줄은 22MB base64 자산 매니페스트이므로 절대 건드리지
않는다. 파일 전체를 문자열로 다루면 메모리를 크게 쓰므로 줄 단위로 처리한다.
"""

import json
import os
import shutil
from datetime import date

TEMPLATE_LINE_INDEX = 209  # 0-기반. 1-기반 210번 줄.


def _read_lines(bundle_path):
    with open(bundle_path, encoding="utf-8") as f:
        return f.readlines()


def unpack(bundle_path):
    """번들에서 마크업 HTML 문자열을 꺼낸다."""
    lines = _read_lines(bundle_path)
    if len(lines) <= TEMPLATE_LINE_INDEX:
        raise ValueError(f"번들에 {TEMPLATE_LINE_INDEX + 1}번째 줄이 없다")
    raw = lines[TEMPLATE_LINE_INDEX].strip()
    if raw.endswith(";"):
        raw = raw[:-1]
    return json.loads(raw)


def pack(bundle_path, markup):
    """마크업을 JSON 인코딩해 210번 줄에 되쓴다. 다른 줄은 보존한다."""
    lines = _read_lines(bundle_path)
    if len(lines) <= TEMPLATE_LINE_INDEX:
        raise ValueError(f"번들에 {TEMPLATE_LINE_INDEX + 1}번째 줄이 없다")
    lines[TEMPLATE_LINE_INDEX] = json.dumps(markup, ensure_ascii=False) + "\n"
    tmp = bundle_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.writelines(lines)
    os.replace(tmp, bundle_path)


def backup(bundle_path):
    """편집 전 백업. 대상 파일은 git 추적 대상이 아니므로 필수다."""
    base = os.path.basename(bundle_path)
    stem = base[:-5] if base.endswith(".html") else base
    dest_dir = os.path.join(os.path.dirname(bundle_path), "아카이브")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, f"{stem} 백업_{date.today().isoformat()}.html")
    shutil.copy2(bundle_path, dest)
    return dest


if __name__ == "__main__":
    import sys

    cmd, path = sys.argv[1], sys.argv[2]
    if cmd == "unpack":
        sys.stdout.write(unpack(path))
    elif cmd == "pack":
        pack(path, sys.stdin.read())
    elif cmd == "backup":
        print(backup(path))
    else:
        raise SystemExit(f"알 수 없는 명령: {cmd}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tools && python3 -m unittest test_bundle_io -v`
Expected: PASS — 5 tests OK

- [ ] **Step 5: 실제 번들로 왕복 검증**

`ensure_ascii=False`가 실제 파일에서도 안전한지 확인한다. 원본 바이트가 바뀌면 안 된다.

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py backup "설계 산출물/셀가드 프로토타입_v3.html"
cp "설계 산출물/셀가드 프로토타입_v3.html" /tmp/cg_before.html
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_markup.html
wc -l /tmp/cg_markup.html
python3 tools/bundle_io.py pack "설계 산출물/셀가드 프로토타입_v3.html" < /tmp/cg_markup.html
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_markup2.html
diff /tmp/cg_markup.html /tmp/cg_markup2.html && echo "왕복 무결성 OK"
```

Expected: `/tmp/cg_markup.html`이 2250줄, `왕복 무결성 OK` 출력.

원본 210번 줄은 `/` 같은 이스케이프를 쓰지만 `json.dumps`는 `/`를 그대로 쓴다. 두 표현 모두 유효한 JSON이고 브라우저에서 동일하게 파싱되므로 바이트 차이는 문제없다. 단 **디코딩 결과**는 동일해야 하며 위 `diff`가 그것을 확인한다.

- [ ] **Step 6: Commit**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
git add tools/bundle_io.py tools/test_bundle_io.py
git commit -m "feat: add bundle markup roundtrip tool

23MB 번들의 210번 줄 JSON 마크업을 안전하게 unpack/pack한다.
대상 파일이 gitignore 대상이라 백업 기능을 포함한다."
```

---

### Task 2: 랜딩 토큰 린터

디자인 토큰이 실제로 지켜지는지 기계적으로 검사한다. 이 프로토타입은 React 구현이 따라갈 기준이므로 규칙이 문서에만 있으면 의미가 없다.

**Files:**
- Create: `tools/landing_lint.py`
- Test: `tools/test_landing_lint.py`

**Interfaces:**
- Consumes: `bundle_io.unpack` (CLI 진입점에서만. `check()` 자체는 마크업 문자열만 받는다)
- Produces:
  - `landing_region(markup: str) -> str` — 랜딩 구간만 잘라 반환
  - `check(markup: str) -> list[str]` — 위반 메시지 리스트. 빈 리스트면 통과
  - `LANDING_START_MARK: str`, `LANDING_END_MARK: str`

- [ ] **Step 1: Write the failing test**

`tools/test_landing_lint.py`:

```python
import unittest

from landing_lint import LANDING_END_MARK, LANDING_START_MARK, check, landing_region


def wrap(landing_body):
    return (
        "<html>\n"
        + LANDING_START_MARK
        + "\n"
        + landing_body
        + "\n"
        + LANDING_END_MARK
        + "\n<div>앱 화면 style=\"border-radius:11px;color:#6B7280\"</div>\n</html>"
    )


CLEAN = '<div style="border-radius:12px;color:var(--ink);background:var(--surface)">셀가드</div>'


class TestLandingRegion(unittest.TestCase):
    def test_region_excludes_app_shell(self):
        region = landing_region(wrap(CLEAN))
        self.assertIn("셀가드", region)
        self.assertNotIn("앱 화면", region)


class TestCheck(unittest.TestCase):
    def test_clean_landing_passes(self):
        self.assertEqual(check(wrap(CLEAN)), [])

    def test_flags_tailwind_gray_hardcode(self):
        issues = check(wrap('<div style="color:#6B7280">가</div>'))
        self.assertTrue(any("#6B7280" in i for i in issues))

    def test_flags_disallowed_radius(self):
        issues = check(wrap('<div style="border-radius:11px">가</div>'))
        self.assertTrue(any("11px" in i for i in issues))

    def test_allows_the_three_radii(self):
        for r in ("12px", "20px", "999px"):
            body = f'<div style="border-radius:{r}">가</div>'
            self.assertEqual(
                [i for i in check(wrap(body)) if "radius" in i], [], f"radius {r} 는 허용"
            )

    def test_flags_dot_pattern_background(self):
        body = '<div style="background-image:radial-gradient(circle,#EEF0F3 1px,transparent 1px)">가</div>'
        issues = check(wrap(body))
        self.assertTrue(any("도트" in i for i in issues))

    def test_flags_emoji_icon(self):
        issues = check(wrap("<div>🔥 위험</div>"))
        self.assertTrue(any("이모지" in i for i in issues))

    def test_app_shell_violations_are_ignored(self):
        # 랜딩 밖의 #6B7280 / radius:11px 는 이번 범위가 아니다
        self.assertEqual(check(wrap(CLEAN)), [])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools && python3 -m unittest test_landing_lint -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'landing_lint'`

- [ ] **Step 3: Write minimal implementation**

`tools/landing_lint.py`:

```python
"""랜딩 구간이 디자인 토큰 규칙을 지키는지 검사한다.

설계 근거: docs/superpowers/specs/2026-07-17-cellguard-landing-light-glass-design.md
랜딩 밖(앱 화면 20개 라우트)은 이번 범위가 아니므로 검사하지 않는다.
"""

import re

LANDING_START_MARK = "<!-- ============ LANDING (v3) ============ -->"
LANDING_END_MARK = "<!-- ============ SIGNUP ============ -->"

# 차가운 Tailwind 기본 팔레트. 웜 뉴트럴 토큰으로 대체해야 한다.
BANNED_COLORS = [
    "#6B7280", "#E5E7EB", "#F9FAFB", "#F3F4F6", "#4B5563",
    "#9CA3AF", "#374151", "#111827", "#D1D5DB", "#EEF0F3",
]
# 스펙의 3단계만 허용. 원형은 999px(--r-pill)로 만든다.
ALLOWED_RADII = {"12px", "20px", "999px"}
# 그림문자 블록 + 딩뱃(✓ ✗ 등). 현재 랜딩 구간에는 해당 문자가 0개이므로
# 이 검사는 새로 유입되는 이모지만 잡는다.
EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿]")


def landing_region(markup):
    start = markup.find(LANDING_START_MARK)
    if start == -1:
        raise ValueError("랜딩 시작 마커를 찾을 수 없다")
    end = markup.find(LANDING_END_MARK, start)
    if end == -1:
        raise ValueError("랜딩 끝 마커(SIGNUP)를 찾을 수 없다")
    return markup[start:end]


def check(markup):
    region = landing_region(markup)
    issues = []

    for color in BANNED_COLORS:
        n = len(re.findall(re.escape(color), region, re.IGNORECASE))
        if n:
            issues.append(f"차가운 Tailwind 색 {color} {n}회 — 웜 뉴트럴 var(--ink*) 토큰으로 교체")

    for radius in set(re.findall(r"border-radius:\s*([0-9]+(?:px|%))", region)):
        if radius not in ALLOWED_RADII:
            issues.append(f"허용되지 않은 border-radius {radius} — 12px/20px/999px 만 사용")

    if re.search(r"radial-gradient\(\s*circle\s*,\s*#EEF0F3", region, re.IGNORECASE):
        issues.append("배경 도트 패턴이 남아 있다 — 제거 대상")

    for m in set(EMOJI.findall(region)):
        issues.append(f"이모지 {m} 사용 — SVG 아이콘으로 교체")

    if "TRUSTED IN THE FIELD" in region:
        issues.append("STATS 트러스트 섹션이 남아 있다 — 지어낸 수치이므로 제거 대상")

    return issues


if __name__ == "__main__":
    import sys

    import bundle_io

    problems = check(bundle_io.unpack(sys.argv[1]))
    for p in problems:
        print(f"  ✗ {p}")
    print(f"\n{len(problems)}건" if problems else "\n토큰 규칙 통과")
    raise SystemExit(1 if problems else 0)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tools && python3 -m unittest test_landing_lint -v`
Expected: PASS — 7 tests OK

- [ ] **Step 5: 현재 번들의 위반 건수를 기준선으로 기록**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/landing_lint.py "설계 산출물/셀가드 프로토타입_v3.html"
```

Expected: 실패(exit 1). 차가운 색·radius 위반·도트 패턴·STATS 섹션이 다수 보고된다. 이것이 기준선이며, Task 3–7이 이 목록을 0으로 만든다.

- [ ] **Step 6: Commit**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
git add tools/landing_lint.py tools/test_landing_lint.py
git commit -m "feat: add landing design token linter

랜딩 구간의 Tailwind 기본 색·radius 난립·도트 패턴·이모지·
지어낸 트러스트 수치를 기계적으로 검사한다."
```

---

### Task 3: 토큰 정의와 배경 정리

`<helmet>` CSS 변수를 심고 도트 패턴을 제거한다. 이후 모든 태스크가 이 변수를 참조한다.

**Files:**
- Modify: `설계 산출물/셀가드 프로토타입_v3.html` (마크업 88–115줄 `<style>` 블록, 116줄 앱 루트 div)

**Interfaces:**
- Consumes: `bundle_io.unpack` / `bundle_io.pack` (Task 1)
- Produces: 아래 CSS 변수 이름 — Task 4–7이 `var(--토큰)`으로 참조한다
  - 뉴트럴: `--bg-base --surface --ink --ink-2 --ink-3 --border`
  - 브랜드: `--brand --brand-2 --brand-grad`
  - 상태: `--ok --warn --alert --danger`
  - 글래스: `--glass-bg --glass-border --glass-shadow --glass-blur`
  - 형태: `--r-card --r-panel --r-pill`

- [ ] **Step 1: 마크업을 꺼낸다**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_markup.html
```

- [ ] **Step 2: 기존 `<style>` 블록에 토큰을 추가한다**

`/tmp/cg_markup.html`에서 `  *{box-sizing:border-box;}` 로 시작하는 `<style>` 블록(약 88줄)의 `*{box-sizing:border-box;}` **바로 앞**에 다음을 삽입한다:

```css
  :root{
    /* 뉴트럴 — 웜 슬레이트. Tailwind 기본 회색의 차가운 톤을 버린다. */
    --bg-base:#F7F6F4;
    --surface:#FFFFFF;
    --ink:#141719;
    --ink-2:#5A6068;
    --ink-3:#8B9099;
    --border:rgba(20,23,25,.08);

    /* 브랜드 — 로고에서 추출 */
    --brand:#2563EB;
    --brand-2:#3B82F6;
    --brand-grad:linear-gradient(135deg,#3B82F6,#2563EB);

    /* 상태 — CLAUDE.md 4단계 등급. 장식에 재사용 금지. */
    --ok:#16A34A;
    --warn:#D97706;
    --alert:#EA580C;
    --danger:#DC2626;

    /* 글래스 */
    --glass-bg:rgba(255,255,255,.55);
    --glass-border:rgba(255,255,255,.7);
    --glass-shadow:0 0 0 1px rgba(15,23,42,.06),0 8px 32px rgba(15,23,42,.06);
    --glass-blur:blur(20px) saturate(1.4);

    /* 형태 */
    --r-card:12px;
    --r-panel:20px;
    --r-pill:999px;
  }
  .cg-glass{
    background:var(--glass-bg);
    -webkit-backdrop-filter:var(--glass-blur);
    backdrop-filter:var(--glass-blur);
    border:1px solid var(--glass-border);
    box-shadow:var(--glass-shadow);
    border-radius:var(--r-panel);
  }
  @supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
    .cg-glass{background:rgba(255,255,255,.92);}
  }
  @media (prefers-reduced-motion:reduce){
    *,*::before,*::after{
      animation-duration:.001ms!important;
      animation-iteration-count:1!important;
      transition-duration:.001ms!important;
      scroll-behavior:auto!important;
    }
  }
```

- [ ] **Step 3: 앱 루트의 도트 패턴 배경을 제거한다**

같은 파일에서 이 줄을 찾는다:

```html
<div style="height:100vh;overflow:hidden;background-color:#F9FAFB;background-image:radial-gradient(circle,#EEF0F3 1px,transparent 1px);background-size:22px 22px;color:#111827;font-size:14px;display:flex;flex-direction:column;">
```

다음으로 교체한다:

```html
<div style="height:100vh;overflow:hidden;background-color:var(--bg-base);color:var(--ink);font-size:14px;display:flex;flex-direction:column;">
```

- [ ] **Step 4: 되쓰고 왕복 검증**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py pack "설계 산출물/셀가드 프로토타입_v3.html" < /tmp/cg_markup.html
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" | grep -c "\-\-glass-blur"
```

Expected: `1` 출력. 토큰이 들어갔고 JSON 왕복이 깨지지 않았다.

- [ ] **Step 5: 도트 패턴이 사라졌는지 린트로 확인**

```bash
python3 tools/landing_lint.py "설계 산출물/셀가드 프로토타입_v3.html" 2>&1 | grep -c "도트"
```

Expected: `0` 출력. (다른 위반은 아직 남아 있는 게 정상 — Task 4–7이 처리한다.)

- [ ] **Step 6: Commit**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
git add docs/
git commit --allow-empty -m "design: define landing warm-neutral glass tokens

번들 파일은 gitignore 대상이라 커밋에 포함되지 않는다.
토큰: 웜 뉴트럴 6 / 브랜드 3 / 상태 4 / 글래스 4 / radius 3.
앱 루트의 도트 패턴 배경 제거."
```

---

### Task 4: STATS 제거와 NAV·HERO 재디자인

**Files:**
- Modify: `설계 산출물/셀가드 프로토타입_v3.html` (마크업 120–188줄 NAV·HERO, 189–212줄 STATS 제거)

**Interfaces:**
- Consumes: Task 3의 CSS 변수, `.cg-glass` 클래스
- Produces: 없음 (섹션 시각 처리만)

- [ ] **Step 1: 마크업을 꺼낸다**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_markup.html
```

- [ ] **Step 2: STATS 섹션을 통째로 제거한다**

`<!-- ============ STATS ============ -->` 주석부터 `<!-- ============ HOW IT WORKS (dark) ============ -->` 주석 **직전**까지를 삭제한다. "TRUSTED IN THE FIELD", "숫자로 증명하는 신뢰", `모니터링 중 배터리`, `평균 조기 경고 리드타임`, `관제 가동률 · 무중단 운영`이 전부 사라져야 한다. 실제 운영 배포가 없는 상태의 지어낸 수치다.

확인:

```bash
grep -c "TRUSTED IN THE FIELD" /tmp/cg_markup.html
```

Expected: `0`

- [ ] **Step 3: HERO 배경에 그라데이션 블룸을 넣는다**

HERO 최상위 컨테이너(`<!-- ============ HERO ============ -->` 다음 첫 `<div style=...>`)의 배경을 다음으로 설정한다. 라이트 배경 위 글래스는 뒤에 색이 있어야 굴절이 보인다.

```css
background:
  radial-gradient(60% 50% at 78% 18%, rgba(59,130,246,.18), transparent 70%),
  radial-gradient(45% 45% at 12% 72%, rgba(37,99,235,.10), transparent 70%),
  var(--bg-base);
```

기존의 장식용 빈 div(HERO 첫 자식 `<div style=…></div>`)가 도트/그라데이션 장식이면 제거한다.

- [ ] **Step 4: NAV를 글래스 스티키 바로 바꾼다**

NAV 컨테이너에 `class="cg-glass"`를 주고 인라인 스타일을 다음 규칙에 맞춘다:

- `position:sticky;top:0;z-index:50;border-radius:0;border-left:none;border-right:none;border-top:none;`
- 로고 마크: 기존 SVG 볼트 유지, 컨테이너 `background:var(--brand-grad);border-radius:var(--r-card);`
- 워드마크 "셀가드": `color:var(--ink);font-weight:800;letter-spacing:-.02em;`
- 메뉴(제품/실시간 관제/AI 이상탐지/문의): `color:var(--ink-2);font-size:15px;font-weight:500;` + `transition:color 180ms;` hover 시 `var(--ink)`
- `로그인`: 고스트 — `color:var(--ink);background:transparent;border:1px solid var(--border);border-radius:var(--r-pill);padding:10px 18px;`
- `무료로 시작`: `background:var(--brand-grad);color:#fff;border-radius:var(--r-pill);padding:10px 18px;font-weight:700;`

**`sc-camel-on-click="{{ openLogin }}"`을 두 버튼 모두 그대로 유지한다.**

- [ ] **Step 5: HERO 좌측 컬럼**

- 상태 배지("AI 열폭주 예측 · 실시간"): `.cg-glass` + `border-radius:var(--r-pill);padding:8px 16px;font-size:13px;font-weight:600;color:var(--ink-2);` 안의 라이브 도트는 `background:var(--ok);animation:cgpulse 2s infinite;`
- h1("먼저 알고, / 먼저 막는다."): `font-size:56px;line-height:1.05;letter-spacing:-.03em;font-weight:800;color:var(--ink);` — "먼저 알고,"에 걸린 기존 강조 span은 `background:var(--brand-grad);-webkit-background-clip:text;-webkit-text-fill-color:transparent;`
- 본문 p: `font-size:16px;line-height:1.6;color:var(--ink-2);`
- `무료로 시작하기`: `background:var(--brand-grad);color:#fff;border-radius:var(--r-pill);padding:15px 28px;font-weight:700;box-shadow:none;` — 기존의 `box-shadow:0 14px 30px -12px rgba(37,99,235,.55)`를 제거한다(과한 그림자).
- `라이브 데모 보기`: `.cg-glass` + `border-radius:var(--r-pill);padding:15px 28px;color:var(--ink);font-weight:700;`
- 센서 칩(온도·전압): `.cg-glass` + `border-radius:var(--r-pill);font-size:13px;color:var(--ink-2);`

h1은 860px 이하에서 `font-size:36px`로 줄인다 — Step 8의 미디어 쿼리에서 처리한다.

- [ ] **Step 6: HERO 우측 실시간 데이터 카드**

기존 카드 컨테이너에 `class="cg-glass"`를 주고 `border-radius:var(--r-panel);padding:24px;`로 맞춘다. 내부:

- `실시간 관제 중` 라벨: `font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:var(--ink-3);`
- `PACK-001 · NCM-72Ah`: `font-size:13px;color:var(--ink-2);font-variant-numeric:tabular-nums;`
- `현재 이상점수` 게이지: 값에 따라 `--ok/--warn/--alert/--danger` 중 하나. 큰 수치는 `font-size:44px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.02em;`
- 스파크라인 SVG: stroke는 상태색, 면적 채움은 같은 색 8% 알파.

**모든 수치 요소에 `font-variant-numeric:tabular-nums`를 넣는다.** 실시간 갱신 시 폭이 흔들리지 않게 한다.

- [ ] **Step 7: 되쓰고 검증**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py pack "설계 산출물/셀가드 프로토타입_v3.html" < /tmp/cg_markup.html
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" | grep -c "openLogin"
```

Expected: `3` 이상 — 로그인·무료로 시작·무료로 시작하기 버튼 동작이 살아 있다.

- [ ] **Step 8: 브라우저로 육안 확인**

`file://`은 확장이 차단하므로 로컬 서버로 연다.

```bash
cd "/Users/jungjeahwan/Desktop/claude/han/설계 산출물"
python3 -m http.server 8899 &
```

`http://localhost:8899/셀가드 프로토타입_v3.html` 를 열어 확인한다:
- NAV 글래스가 탁하지 않고 뒤 블룸이 비쳐 보이는가
- h1과 실시간 카드가 웜 베이스 위에서 선명한가
- STATS 섹션이 사라졌는가
- `무료로 시작하기` 클릭 시 로그인 모달이 뜨는가

확인 후 `pkill -f "http.server 8899"`로 정리한다.

- [ ] **Step 9: Commit**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
git commit --allow-empty -m "design: rebuild landing NAV and HERO with light glass

STATS(\"숫자로 증명하는 신뢰\") 섹션 제거 — 지어낸 수치.
NAV 글래스 스티키 바, HERO 블룸 배경 + 실시간 데이터 글래스 카드.
버튼 동작(openLogin) 유지."
```

---

### Task 5: HOW IT WORKS 라이트 전환

기존 다크 섹션을 라이트 글래스로 바꾼다.

**Files:**
- Modify: `설계 산출물/셀가드 프로토타입_v3.html` (마크업 213–250줄, STATS 제거 후 줄 번호가 앞당겨진다 — 주석 마커로 찾는다)

**Interfaces:**
- Consumes: Task 3의 CSS 변수, `.cg-glass`

- [ ] **Step 1: 마크업을 꺼낸다**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_markup.html
```

- [ ] **Step 2: 섹션 배경을 라이트로 전환한다**

`<!-- ============ HOW IT WORKS (dark) ============ -->` 주석을 `<!-- ============ HOW IT WORKS ============ -->` 로 바꾸고(더 이상 다크가 아니다), 섹션 컨테이너 배경을 다음으로 바꾼다:

```css
background:
  radial-gradient(50% 60% at 50% 0%, rgba(59,130,246,.10), transparent 70%),
  var(--bg-base);
padding:120px 24px;
```

- [ ] **Step 3: 섹션 헤더**

- 라벨 "HOW IT WORKS": `font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:var(--brand);`
- h2 "데이터 수집부터 자동 차단까지, 3단계": `font-size:36px;line-height:1.2;letter-spacing:-.02em;font-weight:700;color:var(--ink);`
- 부제: `font-size:16px;line-height:1.6;color:var(--ink-2);`

기존 다크 배경용 흰색 텍스트(`#fff`, `rgba(255,255,255,...)`)를 전부 위 토큰으로 교체한다.

- [ ] **Step 4: 3단계 카드**

각 카드에 `class="cg-glass"` + `padding:32px;`. 3컬럼 그리드 `gap:24px`.

- 단계 번호: `font-size:11px;letter-spacing:.12em;font-weight:700;color:var(--ink-3);` (`01` / `02` / `03`)
- 카드 제목: `font-size:20px;line-height:1.4;letter-spacing:-.01em;font-weight:700;color:var(--ink);`
- 카드 본문: `font-size:16px;line-height:1.6;color:var(--ink-2);`
- 아이콘 컨테이너: `width:48px;height:48px;border-radius:var(--r-card);background:var(--brand-grad);display:flex;align-items:center;justify-content:center;`

아이콘은 Lucide 계열 SVG를 쓴다(`stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"`, 24×24 viewBox). **이모지 금지.**

1. **1초 단위 실시간 수집** — `activity` 아이콘:
```html
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
```

2. **AI 열폭주 조기 경고** — `alert-triangle` 아이콘:
```html
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>
```

3. **위험 시 자동 릴레이 차단** — `power-off` 아이콘:
```html
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>
```

카드 본문 카피는 그대로 둔다. "1초 단위 실시간 수집"이 실제 스펙(100ms)과 어긋나지만 이번 범위 밖이다.

- [ ] **Step 5: 되쓰고 린트**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py pack "설계 산출물/셀가드 프로토타입_v3.html" < /tmp/cg_markup.html
python3 tools/landing_lint.py "설계 산출물/셀가드 프로토타입_v3.html" 2>&1 | grep -E "이모지|TRUSTED" | wc -l
```

Expected: `0` — 이모지 없음, STATS 없음.

- [ ] **Step 6: Commit**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
git commit --allow-empty -m "design: convert HOW IT WORKS to light glass

다크 섹션을 라이트 글래스 3단계 카드로 전환.
Lucide 계열 SVG 아이콘 사용(이모지 금지)."
```

---

### Task 6: PRODUCT PREVIEW · CTA · FOOTER

**Files:**
- Modify: `설계 산출물/셀가드 프로토타입_v3.html` (마크업 `PRODUCT PREVIEW` / `CTA` / `FOOTER` 마커 구간)

**Interfaces:**
- Consumes: Task 3의 CSS 변수, `.cg-glass`

- [ ] **Step 1: 마크업을 꺼낸다**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_markup.html
```

- [ ] **Step 2: PRODUCT PREVIEW**

- 라벨 "PRODUCT PREVIEW": `font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:var(--brand);`
- h2 "화면으로 직접 확인하세요": `font-size:36px;line-height:1.2;letter-spacing:-.02em;font-weight:700;color:var(--ink);`
- 미리보기 프레임: `.cg-glass` + `padding:16px;border-radius:var(--r-panel);` — 기존 `box-shadow:0 50px 90px -30px rgba(15,23,42,.5)` 류의 과한 그림자를 제거하고 `var(--glass-shadow)`에 맡긴다.
- 내부 카드(실시간 온도 추세 / AI 열폭주 예측 리스크 / 이상점수 24h 추세 / 최근 이상 이벤트): `background:var(--surface);border:1px solid var(--border);border-radius:var(--r-card);`
- 모든 수치·기여도(`기여 64%`, `기여 22%`)에 `font-variant-numeric:tabular-nums;`
- `임계값 초과 감지` / `셀 3 · 온도 임계값 초과`: `color:var(--danger);` 배경은 `rgba(220,38,38,.06)`
- `릴레이 즉시 차단` / `Fail-Safe 인터락 자동 실행 · 0.4초 내 응답`: `color:var(--alert);`
- `릴레이 자동 복구 완료`: `color:var(--ok);`

상태색은 여기서만 쓰고 장식으로 재사용하지 않는다.

- [ ] **Step 3: CTA 라이트 전환**

`<!-- ============ CTA (dark, narrative) ============ -->` 를 `<!-- ============ CTA ============ -->` 로 바꾸고, 섹션 배경을 브랜드 블룸으로:

```css
background:
  radial-gradient(55% 65% at 50% 40%, rgba(37,99,235,.16), transparent 72%),
  var(--bg-base);
padding:120px 24px;
```

- 라벨 "THE MOMENT THAT MATTERS": `font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:var(--brand);`
- h2 "방심하는 그 순간, 셀가드는 / 이 순간을 막습니다.": `font-size:36px;line-height:1.2;letter-spacing:-.02em;font-weight:700;color:var(--ink);`
- 본문: `color:var(--ink-2);`
- `무료로 시작하기`: `background:var(--brand-grad);color:#fff;border-radius:var(--r-pill);padding:15px 28px;font-weight:700;box-shadow:none;` — **`sc-camel-on-click="{{ openLogin }}"` 유지**
- 패널 전체를 `.cg-glass`로 감싼다.

기존 다크용 흰색 텍스트를 전부 토큰으로 교체한다.

- [ ] **Step 4: FOOTER**

`background:var(--bg-base);border-top:1px solid var(--border);color:var(--ink-3);font-size:13px;padding:48px 24px;` 로그인 마크는 그대로 둔다.

- [ ] **Step 5: 되쓰고 린트 — 위반 0을 확인한다**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py pack "설계 산출물/셀가드 프로토타입_v3.html" < /tmp/cg_markup.html
python3 tools/landing_lint.py "설계 산출물/셀가드 프로토타입_v3.html"
```

Expected: `토큰 규칙 통과`, exit 0. 남은 위반이 있으면 해당 섹션으로 돌아가 고친다.

- [ ] **Step 6: Commit**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
git commit --allow-empty -m "design: rebuild PRODUCT PREVIEW, CTA, FOOTER

다크 CTA를 브랜드 블룸 위 라이트 글래스로 전환.
과한 그림자 제거, 수치에 tabular-nums 적용.
랜딩 토큰 린트 통과."
```

---

### Task 7: 모션 · 반응형 · 접근성 마무리

**Files:**
- Modify: `설계 산출물/셀가드 프로토타입_v3.html` (마크업 `<style>` 블록의 미디어 쿼리)

**Interfaces:**
- Consumes: Task 3–6의 결과

- [ ] **Step 1: 마크업을 꺼낸다**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py unpack "설계 산출물/셀가드 프로토타입_v3.html" > /tmp/cg_markup.html
```

- [ ] **Step 2: 랜딩 반응형 규칙을 추가한다**

`<style>` 블록의 기존 `@media (max-width:860px)` 안에 다음을 추가한다. 기존 그리드 규칙은 그대로 둔다.

```css
    #heroGrid{grid-template-columns:1fr!important;gap:40px!important;}
    #heroGrid h1{font-size:36px!important;}
```

`@media (max-width:560px)` 안에 추가:

```css
    #heroGrid h1{font-size:30px!important;}
```

섹션 패딩은 `@media (max-width:1024px)` 를 새로 만들어 `88px 24px`, `@media (max-width:560px)` 에서 `64px 20px` 로 줄인다. 대상은 랜딩 섹션 컨테이너다.

- [ ] **Step 3: 스크롤 리빌 모션**

`<style>` 블록에 추가한다. `transform`/`opacity`만 쓴다.

```css
  @keyframes cgreveal{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:none;}}
  .cg-reveal{animation:cgreveal 300ms cubic-bezier(.16,1,.3,1) both;}
```

`HOW IT WORKS` 3단계 카드에 `class="cg-glass cg-reveal"`을 주고 `animation-delay`를 각각 `0ms` / `60ms` / `120ms`로 준다(스태거 each 0.06s).

Task 3에서 넣은 `prefers-reduced-motion` 블록이 이 애니메이션을 자동으로 끈다 — 추가 작업 없다.

- [ ] **Step 4: 터치 대상 크기 확인**

모든 CTA·NAV 버튼의 `padding`이 최소 44×44px 실효 크기를 만드는지 확인한다. `로그인`(`padding:10px 18px`)은 폰트 15px + 상하 10px = 약 41px이므로 `padding:12px 18px`로 올린다.

- [ ] **Step 5: 되쓰고 전체 검증**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
python3 tools/bundle_io.py pack "설계 산출물/셀가드 프로토타입_v3.html" < /tmp/cg_markup.html
python3 tools/landing_lint.py "설계 산출물/셀가드 프로토타입_v3.html"
cd tools && python3 -m unittest discover -v && cd ..
```

Expected: 린트 `토큰 규칙 통과`, 유닛 테스트 전부 PASS.

- [ ] **Step 6: 브라우저 최종 확인**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han/설계 산출물"
python3 -m http.server 8899 &
```

`http://localhost:8899/셀가드 프로토타입_v3.html` 에서 확인한다:

| 확인 항목 | 기준 |
|---|---|
| 브레이크포인트 | 375 / 768 / 1024 / 1440 에서 가로 스크롤 없음 |
| 글래스 대비 | 글래스 위 본문 텍스트 4.5:1 이상 (DevTools 대비 검사) |
| 버튼 동작 | `로그인` · `무료로 시작` · `무료로 시작하기` · `라이브 데모 보기` → 로그인 모달 |
| 섹션 흐름 | NAV → HERO → HOW IT WORKS → PRODUCT PREVIEW → CTA → FOOTER (STATS 없음) |
| 모션 | 스크롤 시 카드 스태거 리빌, OS 모션 축소 설정 시 정지 |
| 콘솔 | JavaScript 에러 없음 |

확인 후 `pkill -f "http.server 8899"`로 정리한다.

- [ ] **Step 7: Commit**

```bash
cd "/Users/jungjeahwan/Desktop/claude/han"
git commit --allow-empty -m "design: finalize landing motion, responsive, a11y

860/560 브레이크포인트 히어로 1컬럼 전환, 스크롤 스태거 리빌,
터치 대상 44px 확보. prefers-reduced-motion 존중."
```

---

## 완료 기준

- `python3 tools/landing_lint.py "설계 산출물/셀가드 프로토타입_v3.html"` 가 exit 0
- `cd tools && python3 -m unittest discover` 가 전부 PASS
- 브라우저에서 랜딩 6개 섹션이 웜 글래스로 렌더되고, 기존 버튼 동작이 살아 있다
- 지어낸 신뢰 수치·요금제가 화면에 없다
- 355줄 이후 앱 화면은 손대지 않았다

## 범위 밖 — 다음 작업

- 앱 화면 20개 라우트(`dashboard`, `battery`, `relay`, `admin` 등)·인증·관리자 화면에 같은 토큰 확장
- 히어로 카피 "1초 단위 실시간 수집" → 실제 스펙 100ms 정합성 수정 (별도 결정 필요)
