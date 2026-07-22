# 셀가드 제품 계약서 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v3 프로토타입의 기능·유저플로우를 디자인에서 분리한 `docs/product_contract.md`를 만들고, 정본 문서 4종을 v3 기준으로 맞춘다.

**Architecture:** 기계 검증 린터를 먼저 만들어 실패시킨 뒤, 계약서를 블록 단위로 채워 린터를 통과시킨다. 계약서 내용은 추측이 아니라 v3 번들의 언팩된 마크업에서 지정된 줄 범위를 읽어 추출한다.

**Tech Stack:** Python 3 (표준 라이브러리만), Markdown. 기존 `tools/bundle_io.py`, `tools/test_bundle_io.py` 패턴을 따른다.

**Spec:** `docs/superpowers/specs/2026-07-22-cellguard-product-contract-design.md`

## Global Constraints

- **번들을 손으로 편집하지 않는다.** 실제 마크업은 23MB 파일의 210번 줄 JSON 문자열 안에 있다. 반드시 `tools/bundle_io.py`의 `unpack`으로만 읽는다. 202번 줄은 22MB base64 자산 매니페스트이므로 절대 건드리지 않는다. 이번 작업은 **읽기 전용**이며 번들에 쓰지 않는다.
- **줄 번호는 언팩된 마크업 기준이다.** 번들 파일의 줄 번호가 아니다. 아래 명령으로 얻은 파일에 대한 줄 번호다.
- **작업 디렉터리:** `/Users/jungjeahwan/Desktop/claude/han`
- **Python:** `.venv/bin/python` 을 쓴다.
- **계약서에 형태 어휘를 쓰지 않는다.** 금지어: 모달, 카드, 칩, 사이드바, 버튼, 탭, 패널, 배지, 컬럼, 접기, 펼치기, 드롭다운, 아코디언, 툴팁, 팝업, 시트, 레이아웃, 상단, 하단, 좌측, 우측, 호버, 스크롤. Task 1의 린터가 기계 검사한다.
- **등급 임계는 4등급이 정본이다.** 정상 0.0–0.3 (UI 0–29) / 주의 0.3–0.6 (30–59) / 경고 0.6–0.8 (60–79) / 위험 0.8–1.0 (80–100). v3 게이지 범례의 3구간(0–39 / 40–69 / 70+)은 버그이므로 복제하지 않는다.
- **`devices`(F5)는 제외한다.** 도달 불가 고아 라우트다. F5는 결번으로 남긴다.
- **REQ-WEB-069(프로필 사진 변경)는 삭제한다.** 사용자 결정(2026-07-22).
- **커밋은 각 Task 끝에서 한다.** 커밋 메시지는 한국어 본문, 영어 제목 접두사(`docs:`, `feat:`).

## 사전 준비 — 매 Task 시작 시 실행

```bash
cd /Users/jungjeahwan/Desktop/claude/han
.venv/bin/python -c "
import sys; sys.path.insert(0,'tools')
import bundle_io
m = bundle_io.unpack('설계 산출물/셀가드 프로토타입_v3.html')
open('/tmp/v3_markup.html','w').write(m)
print('lines:', m.count(chr(10))+1)
"
```

기대 출력: `lines: 2372`

이후 `/tmp/v3_markup.html` 의 줄 번호로 아래 범위를 읽는다.

## 마크업 줄 범위 지도

**기능 영역 (19개, F5 결번)**

| 영역 | 마커 | 줄 범위 |
|---|---|---|
| F1 랜딩 | `LANDING (v3)` ~ `FOOTER` | 275–474 |
| F2 회원가입 | `SIGNUP` | 475–514 |
| F3 계정 찾기 | `FIND ACCOUNT` | 515–554 |
| (공유 셸) | `APP SHELL` / `sidebar` / `main` | 555–605 |
| F4 실시간 관제 | `DASHBOARD` | 606–656 |
| ~~F5~~ | ~~`DEVICES`~~ 657–670 | **제외** |
| F6 배터리 자산관리 | `BATTERY ASSETS` | 671–698 |
| F7 배터리 상세·이력 | `BATTERY DETAIL` | 699–772 |
| F8 이상 탐지 | `ANOMALY` | 773–812 |
| F9 추세 | `TREND` | 813–850 |
| F10 이벤트 이력 | `EVENTS` | 851–867 |
| F11 알림 센터 | `ALERT CENTER` | 868–909 |
| F12 릴레이 제어 | `RELAY` | 924–946 |
| F13 공지사항 | `NOTICES (user)` | 910–923 |
| F14 설정 | `SETTINGS` | 947–988 |
| F15 관리자 통합 관제 | `ADMIN DASHBOARD` | 989–1021 |
| F16 유저 계정 관리 | `ADMIN USERS` | 1049–1080 |
| F17 배터리 운영 관리 | `ADMIN BATTERY` | 1081–1100 |
| F18 공지사항 관리 | `ADMIN NOTICE` | 1101–1117 |
| F19 감사 로그 | `ADMIN AUDIT` | 1118–1138 |
| F20 이벤트 추이 | `ADMIN EVENT TREND` | 1022–1048 |

**모달 16개** (`SCREENS-END` 1139–1145 이후)

| # | 모달 | 줄 범위 | 귀속 영역 |
|---|---|---|---|
| 1 | GENERIC DETAIL | 1146–1164 | F10 |
| 2 | USER DETAIL (INFO + LOGS) | 1165–1207 | F16 |
| 3 | USER EDIT | 1208–1226 | F16 |
| 4 | BATTERY DETAIL (STATUS + LOGS) | 1227–1251 | F17 |
| 5 | NOTICE EDIT / NEW | 1252–1268 | F18 |
| 6 | NOTICE ARCHIVE / DELETE CONFIRM | 1269–1280 | F18 |
| 7 | RAW 데이터 | 1281–1307 | F10 |
| 8 | PASSWORD RESET | 1308–1320 | F14 |
| 9 | CSV EXPORT | 1321–1331 | F10 |
| 10 | PDF EXPORT | 1332–1342 | F10 |
| 11 | AUTO KILL-SWITCH | 1343–1358 | F12 |
| 12 | CONNECT CONFIRM | 1359–1371 | F6 |
| 13 | EDIT BATTERY | 1372–1393 | F6 |
| 14 | NEW BATTERY | 1394–1415 | F6 |
| 15 | RELAY APPROVAL | 1416–1428 | F12 |
| 16 | LOGIN | 1429–1454 | F1 |

**로직 참조** (스크립트 1455–2372)

| 내용 | 줄 |
|---|---|
| 등급 판정 (4등급, 정본) | 1647–1650 |
| 잠금 게이트 `gated` / `locked` | 1866–1872 |
| 게이지 범례 3구간 (**버그, 복제 금지**) | 1924, 1965 |
| 목업 배터리 `packBase` | 1652~ |
| 목업 디바이스 `devicesList` | 1845 |
| 화면 타이틀 `titles` | 1900~ |

---

## Task 1: 계약서 린터

**Files:**
- Create: `tools/contract_lint.py`
- Create: `tools/test_contract_lint.py`

**Interfaces:**
- Produces: `lint(text: str) -> list[str]` — 위반 메시지 목록을 반환한다. 빈 목록이면 통과. CLI는 `python3 tools/contract_lint.py <path>` 로 실행하며 위반이 있으면 exit 1.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tools/test_contract_lint.py`:

```python
import unittest

from contract_lint import lint


class TestForbiddenVocab(unittest.TestCase):
    def test_flags_widget_word(self):
        text = "## F1. 랜딩\n연결 확인 모달을 연다.\n"
        self.assertTrue(any("모달" in v for v in lint(text)))

    def test_clean_text_has_no_vocab_violation(self):
        text = "## F1. 랜딩\n현재 맥락을 잃지 않고 확인한다.\n"
        self.assertFalse(any("금지 어휘" in v for v in lint(text)))


class TestAreaCoverage(unittest.TestCase):
    def test_flags_missing_area(self):
        text = "### F1. 랜딩\n"
        self.assertTrue(any("영역 누락" in v for v in lint(text)))

    def test_flags_f5_present(self):
        text = "### F5. 디바이스 상태\n"
        self.assertTrue(any("F5" in v for v in lint(text)))


class TestReqCoverage(unittest.TestCase):
    def test_flags_deleted_req_069(self):
        text = "**추적** — REQ-WEB-069\n"
        self.assertTrue(any("069" in v for v in lint(text)))

    def test_flags_uncited_req(self):
        text = "**추적** — REQ-WEB-001\n"
        self.assertTrue(any("미인용 REQ" in v for v in lint(text)))


class TestGateMarkers(unittest.TestCase):
    def test_flags_missing_gates(self):
        text = "## T1. 가입\n1. 가입한다\n"
        self.assertTrue(any("게이트" in v for v in lint(text)))


class TestSectionSchema(unittest.TestCase):
    def test_flags_area_missing_required_heading(self):
        text = "### F1. 랜딩\n**목적** — 소개한다.\n"
        self.assertTrue(any("필수 항목 누락" in v for v in lint(text)))


class TestExemptSections(unittest.TestCase):
    """금지 대상을 이름으로 지목해야 하는 절은 어휘 검사에서 뺀다."""

    def test_exempts_prohibition_list(self):
        text = "### 하지 말 것\n- 메뉴 접기를 쓰지 않는다\n\n---\n"
        self.assertFalse(any("접기" in v for v in lint(text)))

    def test_exempts_appendix_b(self):
        text = "## 부록 B. 계약서에서 제외한 요구사항\n메뉴 접기·펼치기\n"
        self.assertFalse(any("접기" in v for v in lint(text)))

    def test_still_flags_vocab_outside_exempt_sections(self):
        text = "### F1. 랜딩\n메뉴 접기를 제공한다.\n\n### 하지 말 것\n- 없음\n\n---\n"
        self.assertTrue(any("접기" in v for v in lint(text)))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han/tools && ../.venv/bin/python -m unittest test_contract_lint -v
```

기대: `ModuleNotFoundError: No module named 'contract_lint'`

- [ ] **Step 3: 린터를 구현한다**

`tools/contract_lint.py`:

```python
"""디자인 무관 계약서(docs/product_contract.md)를 기계 검증한다.

계약서는 형태 어휘 없이 기능만 기술해야 하고, 도달 가능한 영역 19개와
REQ-WEB 107개를 빠짐없이 덮어야 한다. 이 린터가 그 조건을 검사한다.
"""

import re
import sys

# 형태를 지시하는 어휘. 계약서에 한 번도 나오면 안 된다.
FORBIDDEN = [
    "모달", "카드", "칩", "사이드바", "버튼", "탭", "패널", "배지",
    "컬럼", "접기", "펼치기", "드롭다운", "아코디언", "툴팁", "팝업",
    "시트", "레이아웃", "상단", "하단", "좌측", "우측", "호버", "스크롤",
]

# 도달 가능한 기능 영역. F5(devices)는 고아 라우트라 결번이다.
EXPECTED_AREAS = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]

# REQ-WEB-069는 삭제된 기능이다. 073은 잠금 게이트로 신설한다.
EXPECTED_REQS = (
    {f"REQ-WEB-{n:03d}" for n in range(1, 73)} - {"REQ-WEB-069"}
    | {"REQ-WEB-073"}
    | {f"REQ-WEB-{n:03d}" for n in range(101, 137)}
)

# 각 영역 절이 반드시 담아야 할 항목.
REQUIRED_HEADINGS = [
    "**목적**",
    "**반드시 제공하는 정보**",
    "**반드시 가능한 동작**",
    "**상태·예외**",
    "**제약**",
    "**검수 체크리스트**",
    "**추적**",
]

MIN_GATES = 5
MIN_INVARIANTS = 1


def _areas(text):
    """영역 절을 {번호: 본문}으로 쪼갠다."""
    parts = re.split(r"^### F(\d+)\.", text, flags=re.M)
    out = {}
    for num, body in zip(parts[1::2], parts[2::2]):
        out[int(num)] = body
    return out


def _lintable(text):
    """어휘 검사에서 뺄 절을 걷어낸다.

    '하지 말 것' 목록과 부록 B는 금지 대상을 이름으로 지목해야 하므로
    검사하면 반드시 실패한다. 이 두 절만 예외로 둔다.
    """
    text = re.sub(r"^### 하지 말 것$.*?^---$", "", text, flags=re.M | re.S)
    text = re.sub(r"^## 부록 B\..*", "", text, flags=re.M | re.S)
    return text


def lint(text):
    violations = []
    body = _lintable(text)

    for word in FORBIDDEN:
        hits = body.count(word)
        if hits:
            violations.append(f"금지 어휘 '{word}' {hits}회")

    areas = _areas(text)
    if 5 in areas:
        violations.append("F5(devices)는 도달 불가 라우트다. 계약서에서 빼라")
    for num in EXPECTED_AREAS:
        if num not in areas:
            violations.append(f"영역 누락: F{num}")

    for num, body in sorted(areas.items()):
        if num not in EXPECTED_AREAS:
            continue
        for heading in REQUIRED_HEADINGS:
            if heading not in body:
                violations.append(f"F{num} 필수 항목 누락: {heading}")

    cited = set(re.findall(r"REQ-WEB-\d{3}", text))
    if "REQ-WEB-069" in cited:
        violations.append("REQ-WEB-069는 삭제된 기능이다")
    for req in sorted(EXPECTED_REQS - cited):
        violations.append(f"미인용 REQ: {req}")
    for req in sorted(cited - EXPECTED_REQS - {"REQ-WEB-069"}):
        violations.append(f"알 수 없는 REQ: {req}")

    gates = text.count("**게이트**")
    if gates < MIN_GATES:
        violations.append(f"게이트 표시가 {gates}개다. {MIN_GATES}개 이상이어야 한다")
    invariants = text.count("**불변**")
    if invariants < MIN_INVARIANTS:
        violations.append(f"불변 표시가 {invariants}개다. {MIN_INVARIANTS}개 이상이어야 한다")

    if re.search(r"0[–-]39|40[–-]69|70\+", body):
        violations.append("게이지 범례 3구간은 v3 버그다. 4등급을 써라")

    return violations


def main():
    if len(sys.argv) != 2:
        print("usage: contract_lint.py <path>", file=sys.stderr)
        return 2
    with open(sys.argv[1], encoding="utf-8") as f:
        violations = lint(f.read())
    for v in violations:
        print(v)
    print(f"\n위반 {len(violations)}건")
    return 1 if violations else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han/tools && ../.venv/bin/python -m unittest test_contract_lint -v
```

기대: `Ran 11 tests` ... `OK`

- [ ] **Step 5: 커밋한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add tools/contract_lint.py tools/test_contract_lint.py
git commit -m "feat: add contract linter

계약서의 형태 어휘 0회, 영역 19개(F5 결번), REQ-WEB 107개 인용,
게이트/불변 표시, 범례 3구간 금지를 기계 검사한다."
```

---

## Task 2: 정본 4종을 v3 기준으로 갱신

**Files:**
- Modify: `docs/feature_definition.md`
- Modify: `docs/admin_feature_definition.md`
- Modify: `docs/userflow.md`
- Modify: `docs/admin_userflow.md`

**Interfaces:**
- Produces: REQ-WEB-073 (잠금 게이트). Task 4·5가 `**추적**`에서 인용한다.
- 정본의 어휘는 **중립화하지 않는다.** 정본은 v3를 사실대로 기술하는 문서이고, v3에는 실제로 모달이 있다.

- [ ] **Step 1: 기준 HTML 경로를 갱신한다**

`docs/feature_definition.md:3` 과 `docs/admin_feature_definition.md:3` 의 아래 줄을

```
> 기준 HTML: `/Users/jungjeahwan/Downloads/셀가드 프로토타입 (standalone).html`
```

다음으로 바꾼다(두 파일 동일):

```
> 기준 HTML: `설계 산출물/셀가드 프로토타입_v3.html` (2026-07-22 확인)
```

- [ ] **Step 2: REQ-WEB-069 행을 삭제한다**

`docs/feature_definition.md:77` 의 아래 행 전체를 지운다.

```
| REQ-WEB-069 | 프로필 사진 변경 | 계정 탭에서 사진 변경 버튼을 제공한다. | 정의 필요 |
```

- [ ] **Step 3: REQ-WEB-034를 v3 실제 동작으로 고친다**

`docs/feature_definition.md` 의 아래 행을

```
| REQ-WEB-034 | 배터리 선택 | 저장된 배터리 카드의 이 배터리 측정 버튼으로 측정 연결 확인 모달을 연다. | 선택 |
```

다음으로 바꾼다. v3에는 별도 버튼이 없고 카드 전체가 클릭 대상이다.

```
| REQ-WEB-034 | 배터리 선택 | 저장된 배터리 카드를 클릭해 측정 연결 확인 모달을 연다. 카드 내 별도 버튼은 없다. | 선택 |
```

- [ ] **Step 4: REQ-WEB-073(잠금 게이트)을 신설한다**

`docs/feature_definition.md` 의 표 맨 끝(REQ-WEB-072 행 다음)에 아래 행을 추가한다.

```
| REQ-WEB-073 | 배터리 미연결 잠금 | 일반 사용자가 배터리를 연결하기 전에는 배터리 관리를 제외한 8개 메뉴(대시보드·이상 탐지·추세 차트·이벤트 이력·알림 센터·공지사항·릴레이 제어·설정)가 잠긴다. 잠긴 항목은 클릭해도 이동하지 않고 잠금 표시가 붙는다. 로그인 직후 도착지는 배터리 관리다. 관리자는 잠금을 받지 않는다. | 게이트 |
```

- [ ] **Step 5: 이상점수 스케일을 명시한다**

`docs/feature_definition.md:5` 다음 줄(표 시작 전)에 아래 문단을 넣는다.

```
> 이상점수 스케일: AI가 산출하는 Final Score는 0.0–1.0이며, 화면에는 100배한 0–100 정수로 표시한다.
> 등급 임계는 정상 0–29 / 주의 30–59 / 경고 60–79 / 위험 80–100이다(마크업 L1647–1650 기준).
> v3 대시보드 게이지 범례의 "정상 0–39 / 주의 40–69 / 위험 70+"는 판정 로직과 어긋나는 버그다.
```

- [ ] **Step 6: userflow.md의 프로토타입 종속 섹션을 정리한다**

`docs/userflow.md:250` 의 `## HTML 프로토타입 확인 흐름` 절을 찾아, 첫 줄 바로 아래에 아래 주의문을 넣는다. 절 자체는 지우지 않는다(v3 확인 절차로서 가치가 있다).

```
> 이 절은 v3 프로토타입 확인 절차이며 제품 요구사항이 아니다. 새 디자인에는 적용되지 않는다.
```

- [ ] **Step 7: userflow.md에 잠금 게이트를 반영한다**

`docs/userflow.md` 의 `## S2. 디바이스/배터리` 절 첫머리에 아래 문단을 넣는다.

```
> **선행 게이트** — 일반 사용자는 배터리를 연결하기 전까지 이 절을 제외한 모든 절에 진입할 수 없다(REQ-WEB-073). 로그인 직후 도착지가 여기다.
```

- [ ] **Step 8: 변경을 확인한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
grep -c "Downloads" docs/feature_definition.md docs/admin_feature_definition.md
grep -c "REQ-WEB-069" docs/feature_definition.md
grep -c "REQ-WEB-073" docs/feature_definition.md
```

기대 출력:
```
docs/feature_definition.md:0
docs/admin_feature_definition.md:0
0
1
```

- [ ] **Step 9: 커밋한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add docs/feature_definition.md docs/admin_feature_definition.md docs/userflow.md docs/admin_userflow.md
git commit -m "docs: align source-of-truth docs to v3

기준 HTML을 v3로 갱신. REQ-WEB-069(프로필 사진 변경) 삭제, 034를 실제 동작
(카드 전체 클릭)으로 정정, 073(배터리 미연결 잠금 게이트) 신설. 이상점수
스케일 0-100과 범례 버그를 명시."
```

---

## Task 3: 계약서 블록 A — 공통 헤더

**Files:**
- Create: `docs/product_contract.md`

**Interfaces:**
- Produces: 문서 앞부분. Task 4~9가 이 파일에 절을 덧붙인다.

- [ ] **Step 1: 파일을 만들고 블록 A를 쓴다**

`docs/product_contract.md` 를 아래 내용으로 만든다. 이것이 파일 전체의 시작이다.

````markdown
# 셀가드 제품 계약서

이 문서는 셀가드 배터리 열폭주 관제 서비스가 **무엇을 하는지**만 기술한다. 어떻게 생겼는지는 기술하지 않는다. 어떤 시각 방향으로 다시 디자인하더라도 이 문서의 내용은 그대로 유지되어야 한다.

기준: `설계 산출물/셀가드 프로토타입_v3.html` (2026-07-22 확인).

---

## 0. 이 문서를 받은 실행자에게

### 막히면 멈추고 물어본다

다음 상황에서는 추측으로 채우지 말고 **작업을 멈추고 사용자에게 질문한다.**

- "고정"으로 적힌 항목인데 내용이 불충분해 그대로 옮길 수 없을 때
- 이 문서에 없는 정보나 동작을 추가해야 할 것 같을 때
- 부록 A의 목업 데이터에 없는 값이 필요할 때
- 하려는 디자인이 `**게이트**` 또는 `**불변**`과 충돌할 때
- 한 영역의 정보량이 많아 나눠야 하는데 어디서 끊을지 판단이 서지 않을 때

**묻지 말고 스스로 결정한다** — 아래 판정표의 "자유" 항목 전부.

**물을 때의 형식** — 무엇이 왜 막혔는지 한두 문장 + 선택지 + 잠정 추천. 답을 받기 전에 그 부분을 추측으로 채워 진행하지 않는다. 대신 답에 의존하지 않는 나머지 작업은 마저 끝내고 질문을 함께 올린다.

### 고정 / 자유 판정표

| | 항목 |
|---|---|
| **자유** | 색·간격·반경·그림자·타이포·모션 / 화면 개수와 경계 / 정보를 담는 그릇의 형태 / 목록 탐색 방식 / 이동 수단의 구조 |
| **고정** | 표시해야 할 데이터 항목 / 가능해야 할 동작 / 4단계 상태 등급과 임계 / 안전 게이트와 불변 조건 / 상태·예외 처리 / 반응형 3종(데스크톱·태블릿·모바일) 지원 |

아래 `## F로 시작하는 절`은 **기능 영역**이지 화면이 아니다. 한 영역이 새 디자인에서 화면 하나일 수도, 둘로 나뉠 수도, 다른 영역과 합쳐질 수도 있다.

### 도달 가능성

일반 사용자는 아래 9개 목적지에 도달할 수 있어야 한다 — 실시간 관제, 배터리 자산관리, 이상 탐지, 추세, 이벤트 이력, 알림 센터, 공지사항, 릴레이 제어, 설정. 관리자는 여기에 통합 관제, 유저 계정 관리, 배터리 운영 관리, 공지사항 관리, 감사 로그 5개가 더해진다.

**이동 수단의 구조는 자유다.** 몇 단계로 묶든, 어떤 형태로 제공하든 상관없다. 도달 가능하기만 하면 된다. 다만 T0 게이트가 걸린 상태에서는 배터리 자산관리를 제외한 8개가 잠겨야 한다.

**추적** — REQ-WEB-018

### 이상점수와 상태 등급

AI가 산출하는 Final Score는 0.0–1.0이며, 표시할 때는 100배한 정수를 쓴다.

| 등급 | Final Score | 표시값 |
|---|---|---|
| 정상 | 0.0–0.3 | 0–29 |
| 주의 | 0.3–0.6 | 30–59 |
| 경고 | 0.6–0.8 | 60–79 |
| 위험 | 0.8–1.0 | 80–100 |

### 용어

| 용어 | 뜻 |
|---|---|
| Final Score | AE Score와 Informer Score를 가중합한 최종 이상점수 |
| AE Score | LSTM-AutoEncoder의 재구성 오차 기반 현재 이상점수 |
| Informer Score | Informer의 예측 오차 기반 미래 위험점수 |
| `device_id` | 측정 **장비**(라즈베리파이) 식별자 |
| `battery_id` | 측정 **대상**(셀·보조배터리) 식별자. 자산으로 등록해 재연결 시 이력을 잇는다 |
| 측정 모드 | 1 내장 배터리 / 2 외부 셀 / 3 보조배터리. 동시 활성 불가(인터락) |
| Kill-Switch | 위험 등급에서 전원을 물리적으로 차단하는 릴레이 제어 |
| Fail-Safe | 가스·압력·음향 임계 초과 시 AI 판정과 무관하게 즉시 차단하는 독립 안전계층 |

### 하지 말 것

- 4단계 등급의 임계값을 바꾸지 않는다
- 이상점수를 정수 아닌 형식으로 표시하지 않는다
- 이상점수 범례를 3구간(정상 0~39 / 주의 40~69 / 위험 70 이상)으로 쓰지 않는다 — v3의 버그이며 4등급이 정본이다
- 안전 게이트를 생략하지 않는다. 재인증·사유 입력 없는 차단 경로를 만들지 않는다
- 배터리 미연결 상태에서 잠긴 영역을 열어주지 않는다
- 관리자 전용 기능을 일반 사용자 영역에 노출하지 않는다
- 측정 모드 인터락(동시 활성 불가)을 무시하지 않는다
- 부록 A에 없는 수치를 지어내지 않는다

---
````

- [ ] **Step 2: 린터를 돌려 현재 상태를 확인한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han && .venv/bin/python tools/contract_lint.py docs/product_contract.md
```

기대: 영역 19개 누락 + REQ 108개 미인용 + 게이트 부족이 보고된다. 금지 어휘 위반은 **0건**이어야 한다. 금지 어휘가 잡히면 블록 A의 표현을 고친다.

- [ ] **Step 3: 커밋한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add docs/product_contract.md
git commit -m "docs: contract block A (common header)

질문 규칙, 고정/자유 판정표, 4등급 임계(0.0-1.0 및 0-100 병기), 용어,
하지 말 것 8개."
```

---

## Task 4: 계약서 블록 B — 과업 플로우

**Files:**
- Modify: `docs/product_contract.md` (append)

**Interfaces:**
- Consumes: Task 3의 블록 A. Task 2의 REQ-WEB-073.
- Produces: T1~T15. Task 5~8의 영역 절이 `→ T2` 형태로 참조한다.

- [ ] **Step 1: 마크업에서 흐름을 확인한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
sed -n '1866,1872p' /tmp/v3_markup.html   # 잠금 게이트
sed -n '1359,1371p' /tmp/v3_markup.html   # 연결 확인
sed -n '1416,1428p' /tmp/v3_markup.html   # 릴레이 승인
sed -n '1343,1358p' /tmp/v3_markup.html   # 자동 차단
```

- [ ] **Step 2: 블록 B를 덧붙인다**

`docs/product_contract.md` 끝에 아래를 추가한다. T2·T7은 완성형이다. 나머지는 같은 서식으로 마크업에서 추출해 채운다 — 각 과업은 번호 매긴 단계, 필요 시 `**게이트**`·`**불변**`·`**실패 경로**`, 그리고 `**추적**`을 갖는다.

````markdown
## 과업 플로우

화면 이동이 아니라 순서와 게이트를 고정한다. 각 단계를 어느 영역에서 수행하는지는 지정하지 않는다.

### T0. 진입 잠금

**게이트** — 일반 사용자는 측정 대상 배터리를 연결하기 전까지 T3(자산 등록·선택)을 제외한 모든 과업에 진입할 수 없다. 잠긴 대상은 선택해도 이동하지 않으며, 잠겨 있다는 사실과 푸는 방법이 보여야 한다.

로그인 직후 도착지는 배터리 자산관리(F6)다. 관리자는 이 게이트를 받지 않는다.

**불변** — 배터리가 연결되지 않은 상태에서 F4·F8·F9·F10·F11·F12·F13·F14에 도달하는 경로는 존재할 수 없다.

**추적** — REQ-WEB-073

### T2. 측정 시작

1. 저장된 배터리를 확인한다 — 측정 모드로 범위를 좁힐 수 있어야 한다
2. 대상을 선택한다
3. **게이트** — 한 번에 하나만 연결되며 기존 연결은 해제된다는 사실을 알리고 확인을 받는다
4. 측정 세션이 시작되고 실시간 관제 정보(F4)에 반영된다

3에서 확인 대신 취소하거나, 선택한 배터리의 상세·이력(F7)으로 먼저 갈 수 있어야 한다.

**실패 경로** — 디바이스가 오프라인이면 3에서 중단하고 사유를 알린다
**불변** — 게이트 3을 건너뛰고 세션을 시작하는 경로는 존재할 수 없다

**추적** — REQ-WEB-032, 033, 034, 039

### T7. 위험 제어 — 릴레이 차단·복구

1. 현재 회로 상태(정상 연결 / 차단됨)를 확인한다
2. 차단 또는 복구를 요청한다
3. **게이트** — 재인증하고 사유를 입력해야 실행된다. 둘 중 하나라도 없으면 실행하지 않는다
4. 실행 결과와 바뀐 회로 상태가 보인다

**불변** — 재인증과 사유 입력을 거치지 않는 차단·복구 경로는 존재할 수 없다

**추적** — REQ-WEB-023, 061, 062, 063
````

- [ ] **Step 3: 나머지 과업을 채운다**

아래 12개를 같은 서식으로 추가한다. 각 과업의 `**추적**`에 인용해야 할 REQ를 함께 적었다. **이 REQ가 하나라도 빠지면 린터가 실패한다.**

| ID | 과업 | 게이트/불변 | 인용할 REQ |
|---|---|---|---|
| T1 | 가입·로그인·계정 찾기 | — | 003, 005, 006, 007, 008, 009, 010, 011, 012, 013, 014 |
| T3 | 배터리 자산 등록·수정 | `chemistry` 필수 | 036, 037, 038 |
| T4 | 이상 징후 확인 → 근거 확인 | — | 021, 022, 042, 043, 044, 045 |
| T5 | 추세·이력 조회 및 내보내기 | — | 046, 047, 048, 049, 050, 051, 052, 053, 054, 055, 040, 041, 035 |
| T6 | 알림 수신 → 확인(Ack) | — | 016, 056, 057, 058, 027 |
| T8 | 자동 차단(Fail-Safe) 수신 대응 | — | 064 |
| T9 | 설정 변경 | — | 065, 066, 067, 068, 070, 071, 072, 015 |
| T10 | 공지 확인 | — | 028, 029, 059, 060 |
| T11 | 관리자 진입·이탈 | 권한 확인 | 101, 102, 103 |
| T12 | 유저 계정 정지·해제·비밀번호 재설정 | 사유 입력 + 감사 기록 | 110, 111, 112, 113, 114, 115, 116, 117, 118 |
| T13 | 배터리 운영 상태 변경 | BLOCKED 사유 필수 + 감사 기록 | 119, 120, 121, 122, 123, 124, 125, 126 |
| T14 | 공지 발행 | — | 127, 128, 129, 130, 131, 132 |
| T15 | 감사 로그 조회 | 수정·삭제 불가 | 133, 134, 135, 136 |

T3·T12·T13·T15는 `**게이트**` 또는 `**불변**`을 반드시 포함한다.

- [ ] **Step 4: 린터로 게이트 수를 확인한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han && .venv/bin/python tools/contract_lint.py docs/product_contract.md | grep -E "게이트|불변|금지 어휘"
```

기대: 게이트·불변·금지 어휘 관련 위반이 **0줄**이다(영역·REQ 위반은 아직 남아 있다).

- [ ] **Step 5: 커밋한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add docs/product_contract.md
git commit -m "docs: contract block B (task flows T0-T15)

화면 이동이 아니라 순서와 게이트로 표현. 진입 잠금(T0), 측정 시작(T2),
위험 제어(T7)에 게이트/불변 명시."
```

---

## Task 5: 계약서 블록 C — 공개 영역 F1~F3

**Files:**
- Modify: `docs/product_contract.md` (append)

**Interfaces:**
- Consumes: Task 4의 T1.
- Produces: F1~F3. 이후 영역 절이 같은 서식을 따른다.

- [ ] **Step 1: 마크업을 읽는다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
sed -n '275,474p' /tmp/v3_markup.html    # F1 랜딩
sed -n '475,514p' /tmp/v3_markup.html    # F2 회원가입
sed -n '515,554p' /tmp/v3_markup.html    # F3 계정 찾기
sed -n '1429,1454p' /tmp/v3_markup.html  # 로그인 (F1 귀속)
```

- [ ] **Step 2: `## 기능 영역` 절을 열고 F1을 쓴다**

`docs/product_contract.md` 끝에 추가한다. F1이 완성형 본보기다. F2·F3은 같은 7개 항목을 모두 갖춰 쓴다.

````markdown
## 기능 영역

각 절은 화면이 아니라 기능의 묶음이다. 새 디자인은 이 묶음을 자유롭게 나누거나 합칠 수 있으나, 각 절의 정보와 동작은 어딘가에서 반드시 도달 가능해야 한다.

> F5는 결번이다. v3에 `devices` 화면이 구현돼 있으나 도달 경로가 없어 제외했다. 되살릴지는 별도 판단 사항이다.

### F1. 랜딩

**목적** — 서비스를 처음 만난 사람에게 무엇을 하는 서비스인지 알리고, 로그인 또는 가입으로 넘긴다.

**반드시 제공하는 정보**
- AI 열폭주 예측과 실시간 관제라는 핵심 가치
- 수집 대상 — 전압·전류·온도·SOC
- 제품 / 실시간 관제 / AI 이상탐지 / 문의 네 갈래의 소개
- 동작하는 관제 화면의 미리보기

**반드시 가능한 동작**
- 로그인 시작 → T1
- 가입 시작 → T1, F2
- 데모 확인
- 네 갈래 소개로 이동

**상태·예외**
- 로그인 정보가 틀렸을 때의 안내

**제약**
- 로그인 수단은 이메일과 Google 두 가지이며, 관리자 진입 경로가 함께 있어야 한다

**검수 체크리스트**
- [ ] 핵심 가치 4종이 모두 읽히는가
- [ ] 로그인·가입·데모 세 동작이 모두 가능한가
- [ ] 관리자 진입 경로가 있는가

**추적** — REQ-WEB-001, 002, 003, 004, 005, 006, 007, 008
````

- [ ] **Step 3: F2·F3을 같은 서식으로 쓴다**

인용할 REQ:
- F2 회원가입 — 009, 010
- F3 계정 찾기 — 011, 012, 013

- [ ] **Step 4: 린터로 F1~F3의 필수 항목을 확인한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han && .venv/bin/python tools/contract_lint.py docs/product_contract.md | grep -E "^F[123] |금지 어휘"
```

기대: 출력 없음(0줄).

- [ ] **Step 5: 커밋한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add docs/product_contract.md
git commit -m "docs: contract areas F1-F3 (public)"
```

---

## Task 6: 계약서 블록 C — 관제·자산 F4, F6, F7, F8

**Files:**
- Modify: `docs/product_contract.md` (append)

**Interfaces:**
- Consumes: Task 5의 영역 서식(7개 필수 항목), Task 4의 T2·T3·T4.

- [ ] **Step 1: 마크업을 읽는다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
sed -n '606,656p' /tmp/v3_markup.html    # F4 실시간 관제
sed -n '671,698p' /tmp/v3_markup.html    # F6 배터리 자산관리
sed -n '699,772p' /tmp/v3_markup.html    # F7 배터리 상세·이력
sed -n '773,812p' /tmp/v3_markup.html    # F8 이상 탐지
sed -n '1359,1415p' /tmp/v3_markup.html  # 연결 확인·수정·신규 등록 (F6 귀속)
```

- [ ] **Step 2: F4를 쓴다**

F4는 완성형이다. 그대로 쓴다.

````markdown
### F4. 실시간 관제

**목적** — 연결된 배터리 한 대의 현재 상태를 파악하고, 위험하면 즉시 차단으로 넘어간다.

**반드시 제공하는 정보**
- 연결된 배터리 식별자와 측정 세션 진행 여부
- 최종 이상점수(0–100 정수)와 4등급 판정, 그리고 4등급의 임계 구간
- 전압·전류·온도·SOC 현재값과 각각의 등급
- 네 지표의 최근 추이
- 위험도 구간별 배터리 분포
- 최근 이상 이벤트와 발생 시각
- 최근 공지
- 미확인 알림 건수와 이상 건수

**반드시 가능한 동작**
- 측정 대상 배터리 변경 → T2
- 릴레이 차단 진입 → T7
- 이상 근거 확인 → F8
- 알림 전체 확인 → F11
- 추세 전체 확인 → F9
- 공지 전체 확인 → F13
- 표시 지표를 전압·전류·온도·SOC 중에서 바꾸기

**상태·예외**
- 연결된 배터리 없음 — T0 게이트가 걸린 상태
- 디바이스 오프라인
- 데이터 수신 지연

**제약**
- 실시간 갱신 중 요소의 위치와 크기가 흔들리지 않아야 한다
- 이상점수와 4등급 판정은 항상 함께 읽혀야 한다. 점수만 단독으로 내보내지 않는다
- 4등급 임계 구간을 함께 보일 때는 4구간을 모두 보인다

**검수 체크리스트**
- [ ] 정보 8종이 모두 도달 가능한가
- [ ] 동작 7종이 모두 가능한가
- [ ] 예외 3종의 표시가 정의돼 있는가
- [ ] 등급 구간이 4개로 표시되는가 (3구간은 v3 버그다)

**추적** — REQ-WEB-019, 020, 021, 022, 023, 024, 025, 026, 027, 028, 029
````

- [ ] **Step 3: F6·F7·F8을 같은 서식으로 쓴다**

인용할 REQ:
- F6 배터리 자산관리 — 030, 031, 032, 033, 034, 035, 036, 037, 038, 039, 073
- F7 배터리 상세·이력 — 040, 041
- F8 이상 탐지 — 042, 043, 044, 045

> F6은 REQ-WEB-030·031(디바이스 상태 확인)을 흡수한다. `devices` 영역이 도달 불가라 그 정보를 담을 곳이 필요하고, 배터리 연결 시 디바이스 온·오프라인이 곧 연결 가능 여부이기 때문이다.

F6의 `**제약**`에 T0 게이트를 명시한다 — "이 영역은 배터리 미연결 상태에서 유일하게 열려 있는 곳이다."

- [ ] **Step 4: 린터로 확인한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han && .venv/bin/python tools/contract_lint.py docs/product_contract.md | grep -E "^F[4678] |금지 어휘"
```

기대: 출력 없음(0줄).

- [ ] **Step 5: 커밋한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add docs/product_contract.md
git commit -m "docs: contract areas F4,F6,F7,F8 (monitoring, assets)

F6이 도달 불가한 devices 영역의 REQ-WEB-030/031을 흡수한다."
```

---

## Task 7: 계약서 블록 C — 조회·제어·설정 F9~F14

**Files:**
- Modify: `docs/product_contract.md` (append)

**Interfaces:**
- Consumes: Task 6의 영역 서식, Task 4의 T5·T6·T7·T8·T9·T10.

- [ ] **Step 1: 마크업을 읽는다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
sed -n '813,850p' /tmp/v3_markup.html    # F9 추세
sed -n '851,867p' /tmp/v3_markup.html    # F10 이벤트 이력
sed -n '868,909p' /tmp/v3_markup.html    # F11 알림 센터
sed -n '924,946p' /tmp/v3_markup.html    # F12 릴레이 제어
sed -n '910,923p' /tmp/v3_markup.html    # F13 공지사항
sed -n '947,988p' /tmp/v3_markup.html    # F14 설정
sed -n '1146,1164p' /tmp/v3_markup.html  # 일반 상세 (F10)
sed -n '1281,1342p' /tmp/v3_markup.html  # 원본 데이터·비밀번호·CSV·PDF
sed -n '1343,1358p' /tmp/v3_markup.html  # 자동 차단 (F12)
```

- [ ] **Step 2: F9~F14를 쓴다**

Task 6 Step 2의 F4를 서식 본보기로 삼아 7개 필수 항목을 모두 갖춰 쓴다.

인용할 REQ:
- F9 추세 — 046, 047, 048
- F10 이벤트 이력 — 049, 050, 051, 052, 053, 054, 055
- F11 알림 센터 — 016, 056, 057, 058
- F12 릴레이 제어 — 061, 062, 063, 064
- F13 공지사항 — 059, 060
- F14 설정 — 015, 065, 066, 067, 068, 070, 071, 072

각 영역에서 놓치기 쉬운 것:
- **F10** — 검색·상태 필터·정렬·페이지 이동·상세·CSV·PDF·원본 데이터가 모두 이 영역에 붙는다
- **F11** — 개별 확인(Ack)과 일괄 확인이 모두 있어야 한다
- **F12** — `**게이트**`(재인증 + 사유)를 `**제약**`에 다시 명시한다. 자동 차단(Fail-Safe) 수신 시의 표시도 이 영역이다
- **F14** — 알림 수신(카카오·이메일·SMS·웹푸시), 알림 조건, 계정 정보, 비밀번호 변경, 테마, 센서 캘리브레이션 이력, 디바이스 음성 안내 7종이 모두 들어간다. 프로필 사진 변경은 **넣지 않는다**(REQ-WEB-069 삭제)

- [ ] **Step 3: 린터로 확인한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han && .venv/bin/python tools/contract_lint.py docs/product_contract.md | grep -E "^F(9|1[01234]) |금지 어휘|069"
```

기대: 출력 없음(0줄).

- [ ] **Step 4: 커밋한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add docs/product_contract.md
git commit -m "docs: contract areas F9-F14 (query, control, settings)"
```

---

## Task 8: 계약서 블록 C — 관리자 F15~F20

**Files:**
- Modify: `docs/product_contract.md` (append)

**Interfaces:**
- Consumes: Task 6의 영역 서식, Task 4의 T11~T15.

- [ ] **Step 1: 마크업을 읽는다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
sed -n '989,1021p' /tmp/v3_markup.html   # F15 관리자 통합 관제
sed -n '1049,1080p' /tmp/v3_markup.html  # F16 유저 계정 관리
sed -n '1081,1100p' /tmp/v3_markup.html  # F17 배터리 운영 관리
sed -n '1101,1117p' /tmp/v3_markup.html  # F18 공지사항 관리
sed -n '1118,1138p' /tmp/v3_markup.html  # F19 감사 로그
sed -n '1022,1048p' /tmp/v3_markup.html  # F20 이벤트 추이
sed -n '1165,1280p' /tmp/v3_markup.html  # 유저 상세·수정, 배터리 상세, 공지 편집·보관
```

- [ ] **Step 2: F15~F20을 쓴다**

인용할 REQ:
- F15 관리자 통합 관제 — 101, 102, 103, 104, 105, 106, 109
- F16 유저 계정 관리 — 110, 111, 112, 113, 114, 115, 116, 117, 118
- F17 배터리 운영 관리 — 119, 120, 121, 122, 123, 124, 125, 126
- F18 공지사항 관리 — 127, 128, 129, 130, 131, 132
- F19 감사 로그 — 133, 134, 135, 136
- F20 이벤트 추이 — 107, 108

각 영역에서 놓치기 쉬운 것:
- **F15** — 전체 유저·전체 배터리·활성 세션·위험/경고 배터리·오프라인 디바이스 요약, 최근 위험 배터리, 최근 관리자 조작
- **F16** — 정지/해제는 사유 입력이 필요하고 감사 로그에 남는다(`**게이트**`)
- **F17** — 운영 상태 NORMAL / WATCH / BLOCKED. BLOCKED 전환은 사유 필수(`**게이트**`)
- **F19** — 수정·삭제 불가와 보존 안내(`**불변**`). `**제약**`에 명시한다
- **모든 관리자 영역** — `**제약**`에 "일반 사용자에게 노출되지 않는다"를 넣는다

- [ ] **Step 3: 린터로 확인한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han && .venv/bin/python tools/contract_lint.py docs/product_contract.md | grep -E "^F(1[56789]|20) |금지 어휘|영역 누락"
```

기대: 출력 없음(0줄).

- [ ] **Step 4: 커밋한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add docs/product_contract.md
git commit -m "docs: contract areas F15-F20 (admin)"
```

---

## Task 9: 계약서 부록 A — 목업 데이터

**Files:**
- Modify: `docs/product_contract.md` (append)

**Interfaces:**
- Consumes: 없음.
- Produces: 부록 A. 새 디자인이 지어낸 값 대신 쓸 고정 데이터.

- [ ] **Step 1: 마크업에서 목업 데이터를 뽑는다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
sed -n '1652,1680p' /tmp/v3_markup.html   # packBase
sed -n '1845,1860p' /tmp/v3_markup.html   # devicesList
grep -n "evtRows\|noticeRows\|auditRows\|userRows\|alertRows" /tmp/v3_markup.html | head -20
```

- [ ] **Step 2: 부록을 덧붙인다**

아래 서식으로 쓴다. 배터리 5대는 확인된 값이므로 그대로 싣는다.

````markdown
---

## 부록 A. 목업 데이터

새 디자인은 이 값을 그대로 쓴다. 여기에 없는 수치를 지어내지 않는다.

### 배터리 자산 5대

| ID | 사양 | 모드 | SOC | 이상점수 | 등급 |
|---|---|---|---|---|---|
| PACK-001 | 18650 Li-ion · 3S | 1 | 78% | 82 | 위험 |
| PACK-002 | 18650 Li-ion · 3S | 1 | 91% | 18 | 정상 |
| PACK-003 | Li-Po · 2S | 3 | 64% | 33 | 주의 |
| PACK-004 | 18650 Li-ion · 2S | 2 | 47% | 58 | 주의 |
| PACK-005 | Li-Po · 1S | 3 | 82% | 24 | 정상 |

> PACK-003의 등급은 이상점수 33이므로 4등급 기준으로 **주의**(30–59)다. v3 화면에는 "정상"으로 표시되는데, 이는 3구간 범례 버그의 결과이므로 따라 하지 않는다.

### 측정 세션 기준값

전압 11.46 V · 전류 1.7 A · 온도 28.7 ℃ · SOC 90% · 이상점수 18(정상)

### 사용자

홍길동 · 측정 담당자

### 미확인 건수

이상 탐지 9건 · 알림 센터 2건
````

- [ ] **Step 3: 나머지 목업을 채운다**

Step 1에서 찾은 이벤트·공지·감사 로그·유저 목록·디바이스 목록의 행을 같은 표 서식으로 추가한다. 각 표는 v3에 실제로 있는 행 수를 그대로 유지한다.

- [ ] **Step 4: 부록 B — 제외한 요구사항을 쓴다**

파일 끝에 아래를 그대로 추가한다. 새 디자인이 "왜 이건 없지?"를 되묻지 않도록 근거를 남긴다.

````markdown
---

## 부록 B. 계약서에서 제외한 요구사항

v3에는 있으나 이 계약서에 담지 않은 것들이다. 새 디자인은 이 항목들을 만들지 않아도 되며, 되살릴지는 별도 판단 사항이다.

| 출처 | 항목 | 제외 사유 |
|---|---|---|
| REQ-WEB-017 | 메뉴 접기·펼치기 | 이동 수단의 형태에 종속된 동작이라 기능이 아니다. 판정표에서 "이동 수단의 구조"는 자유로 두었으므로, 새 디자인이 접는 구조를 쓰지 않으면 이 동작 자체가 성립하지 않는다. |
| (v3 `devices` 화면) | 디바이스 상태 전용 영역 | v3에 화면과 데이터가 구현돼 있으나 도달 경로가 없다. 화면 전환 코드가 0건이고 이동 수단에도 없다. 담고 있던 정보(진단기별 온·오프라인, 최근 수신, 센서 구성)는 F6이 흡수했다. |
| (v3 게이지 범례) | 3구간 범례 | 판정 로직의 4등급과 어긋나는 버그다. 4등급이 정본이다. |

프로필 사진 변경 기능은 2026-07-22에 제거하기로 결정되어 정본 문서에서도 삭제했다.
````

- [ ] **Step 5: 커밋한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add docs/product_contract.md
git commit -m "docs: contract appendices A and B

값을 지어내지 않도록 v3의 목업을 고정. PACK-003 등급은 3구간 범례 버그의
결과라 4등급 기준(주의)으로 정정해 싣는다. 부록 B에 제외 항목과 사유 기록."
```

---

## Task 10: 전체 검증과 CLAUDE.md 갱신

**Files:**
- Modify: `CLAUDE.md`
- Verify: `docs/product_contract.md`

**Interfaces:**
- Consumes: Task 1~9 전부.

- [ ] **Step 1: 린터를 전체로 돌린다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han && .venv/bin/python tools/contract_lint.py docs/product_contract.md
```

기대 출력:
```

위반 0건
```

위반이 남아 있으면 해당 Task로 돌아가 고친다. 이 단계를 건너뛰지 않는다.

- [ ] **Step 2: 단위 테스트를 돌린다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han/tools && ../.venv/bin/python -m unittest discover -v
```

기대: 모든 테스트 `OK`. 기존 `test_bundle_io`, `test_landing_lint`도 함께 통과해야 한다.

- [ ] **Step 3: 분량을 확인한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han && wc -l docs/product_contract.md
```

기대: 900~1,400줄. 600줄 미만이면 영역 서술이 부실한 것이므로 되돌아가 보강한다.

- [ ] **Step 4: CLAUDE.md에 번들 편집 규칙을 추가한다**

`CLAUDE.md` 의 `## 요구사항 추적` 절 **앞**에 아래 절을 넣는다. 지금 CLAUDE.md에는 번들 관련 내용이 전혀 없어 이 레포에서 처음 작업하는 사람이 23MB 파일을 그대로 편집하려다 깨뜨릴 수 있다.

```markdown
## 프로토타입 번들 다루기

`설계 산출물/셀가드 프로토타입_v3.html`은 23MB 단일 HTML 번들이다.

- 실제 마크업은 **210번 줄의 JSON 문자열 하나**(약 30만 자 / 2,372줄)에 들어 있다. 반드시 `tools/bundle_io.py`의 `unpack`/`pack`/`backup`으로만 읽고 쓴다.
- **202번 줄은 22MB base64 자산 매니페스트다. 절대 건드리지 않는다.**
- `설계 산출물/`은 `.gitignore` 대상이라 되돌리기가 불가능하다. 편집 전 `backup`을 부른다.
- 브라우저로 열어 확인할 때는 `file://`이 확장에 차단되므로 로컬 HTTP 서버로 띄운다.
  `python3 -m http.server 8807 --bind 127.0.0.1` 을 `설계 산출물/`에서 실행한다.
- 기능·유저플로우의 디자인 무관 정본은 `docs/product_contract.md`다. 새 디자인 작업은 이 문서를 입력으로 삼는다.
```

- [ ] **Step 5: CLAUDE.md의 상태 등급 표에 UI 스케일을 병기한다**

`CLAUDE.md` 의 `**상태 등급** (최종 이상점수 Final Score 기준)` 표를 아래로 바꾼다. 지금 표에는 0.0–1.0만 있어 화면의 0–100 정수 표시와 어긋나 보인다.

```markdown
| 등급 | 이상점수 범위 | UI 표시값 |
|---|---|---|
| 정상 | 0.0 – 0.3 | 0 – 29 |
| 주의 | 0.3 – 0.6 | 30 – 59 |
| 경고 | 0.6 – 0.8 | 60 – 79 |
| 위험 | 0.8 – 1.0 | 80 – 100 |

> 화면에는 Final Score를 100배한 정수로 표시한다. v3 대시보드 게이지 범례의 "정상 0–39 / 주의 40–69 / 위험 70+"는 판정 로직(4등급)과 어긋나는 버그이므로 따르지 않는다.
```

- [ ] **Step 6: 커밋한다**

```bash
cd /Users/jungjeahwan/Desktop/claude/han
git add CLAUDE.md
git commit -m "docs: record bundle handling rules and UI score scale

23MB 번들의 210번 줄 마크업/202번 줄 자산 규칙, 로컬 HTTP 확인 방법을
CLAUDE.md에 명시. 상태 등급표에 UI 0-100 정수 스케일 병기."
```

---

## Self-Review 결과

**Spec coverage** — 스펙의 각 요구가 어느 Task에 있는지:

| 스펙 항목 | Task |
|---|---|
| 정본 4종 기준 파일 갱신 | 2 |
| v3 델타 반영 (rawModal) | 7 (F10) |
| REQ-WEB-069 삭제 | 2, 7 |
| 계약서 블록 A | 3 |
| 계약서 블록 B | 4 |
| 계약서 블록 C (19개 영역) | 5, 6, 7, 8 |
| 계약서 블록 D (목업) | 9 |
| 질문 규칙 | 3 |
| 금지 목록 | 3 |
| 어휘 중립화 | 1(검사), 3~9(적용) |
| F5 제외 | 1(검사), 5(명시) |
| 모달 16개 귀속 | 6, 7, 8 (줄 범위 지도의 귀속 열) |
| 잠금 게이트 | 2(REQ-073), 4(T0), 6(F6) |
| 등급 4단계 정본화 | 1(검사), 3(표), 9(PACK-003 정정), 10(CLAUDE.md) |
| 0–100 스케일 병기 | 2, 3, 10 |
| 양방향 REQ 대조 | 1(린터), 10 |
| 검증 4종 | 1, 10 |

빠진 항목 없음.

**Placeholder scan** — Task 4·5·6·7·8·9에 "같은 서식으로 쓴다"가 있으나, 각 경우 완성형 본보기(T2·T7·F1·F4·부록 표)와 인용할 REQ 목록, 마크업 줄 범위, 놓치기 쉬운 항목을 함께 제시했다. 내용 자체는 v3에서 추출하는 것이므로 플랜에 미리 쓸 수 없다.

**Type consistency** — `lint(text) -> list[str]` 이 Task 1에서 정의되고 Task 3~10에서 CLI로만 호출된다. 위반 메시지 문자열(`"영역 누락"`, `"미인용 REQ"`, `"필수 항목 누락"`, `"금지 어휘"`)이 테스트와 구현과 이후 Task의 `grep` 패턴에서 일치한다. 영역 제목은 `### F<n>.` 로 통일했다(`_areas`의 정규식, Task 5의 본보기, Task 1의 테스트가 모두 같은 단계를 쓴다).

**작성 중 잡은 결함 3건**

1. **REQ-WEB-017·018이 어느 영역에도 없었다.** 린터는 107개 전부 인용을 요구하므로 Task 10에서 반드시 실패했을 것이다. 018(9개 목적지 도달)은 블록 A의 "도달 가능성" 절로, 017(메뉴 접기)은 부록 B의 제외 목록으로 보냈다.
2. **"하지 말 것" 목록과 부록 B가 금지 어휘를 이름으로 지목해야 했다.** 어휘 검사를 그대로 돌리면 위반 0건에 도달할 수 없다. 린터에 `_lintable()` 절 단위 예외를 넣고, 예외가 과하게 적용되지 않는지 확인하는 테스트(`test_still_flags_vocab_outside_exempt_sections`)를 함께 넣었다.
3. **테스트 개수 표기가 어긋났다.** 예외 테스트 3개를 더해 11개로 맞췄다.

**사전 검증 (2026-07-22 실행)**

플랜에 실린 코드와 산문을 실제로 돌려봤다.

- 린터 코드를 플랜에서 그대로 추출해 테스트 실행 → `Ran 11 tests ... OK`
- 플랜에 실린 계약서 산문(블록 A, T0·T2·T7, F1, F4, 부록 A·B)에 어휘 검사 적용 → **금지 어휘 위반 없음**, 3구간 범례 없음
- 게이트 4건 / 불변 4건 확인. `MIN_GATES = 5`는 T3·T12·T13이 추가되면 충족된다

즉 Task 1은 그대로 통과하고, Task 3~9의 본보기 산문도 린터를 통과한다.
