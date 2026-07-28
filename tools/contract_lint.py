"""디자인 무관 계약서(docs/product_contract.md)를 기계 검증한다.

계약서는 형태 어휘 없이 기능만 기술해야 하고, 도달 가능한 영역 20개와
REQ-WEB 110개를 빠짐없이 덮어야 한다. 이 린터가 그 조건을 검사한다.

제외된 5건은 부록 B에서만 언급할 수 있다. 본문이 인용하면 위반이다.
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
# F21(보조배터리 진단)은 v3에 없는 신규 영역이다(2026-07-28).
EXPECTED_AREAS = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]

# 범위에서 제외된 요구사항. 근거는 docs/backend_contract.md §11과 계약서 부록 B.
# 017 메뉴 접기 — 특정 이동 수단 형태의 부산물이고 이동 수단 구조는 자유다
# 030·031 디바이스 상태 — devices 라우트가 도달 불가한 고아라 기능 자체가 없다
# 069 프로필 사진 변경 — 기능 제거 결정(2026-07-22)
# 071 캘리브레이션 이력 — 조회 화면만 있고 등록 수단이 없다
# 135 감사 로그 상세 — 항목을 선택해도 아무 일이 없다(상세 미구현)
EXCLUDED_REQS = {
    "REQ-WEB-017", "REQ-WEB-030", "REQ-WEB-031",
    "REQ-WEB-069", "REQ-WEB-071", "REQ-WEB-135",
}

# 137~143은 F21(보조배터리 진단) 신설분이다. v3에는 없고 계약서가 원본이다.
EXPECTED_REQS = (
    {f"REQ-WEB-{n:03d}" for n in range(1, 73)}
    | {"REQ-WEB-073"}
    | {f"REQ-WEB-{n:03d}" for n in range(101, 137)}
    | {f"REQ-WEB-{n:03d}" for n in range(137, 144)}
) - EXCLUDED_REQS

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

# 실제 표시 개수에 맞춘 하한. 느슨하면 안전 게이트를 지워도 통과한다.
# F21 신설로 게이트 2개(진단 실행·완충 확인), 불변 2개(Fail-Safe 우선순위,
# 완충 미확인 결과 사용 금지)가 늘어 하한을 함께 올렸다(2026-07-28).
MIN_GATES = 14
MIN_INVARIANTS = 10


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
    # 각 절은 자기만의 종료 지점(있다면) 또는 같거나 더 높은 레벨의 다음
    # 헤딩(또는 입력 끝) 중 먼저 오는 곳에서 멈춘다. 그렇지 않으면 뒤따르는
    # 실제 조항까지 예외로 삼켜버린다.
    # '하지 말 것'은 관례상 '---' 줄로 닫히므로 그 지점을 우선 종료로 쓴다.
    text = re.sub(
        r"^### 하지 말 것$.*?(?=^---$|^#{1,3}\s|\Z)", "", text, flags=re.M | re.S
    )
    # 부록 B는 '---' 관례가 없으므로 다음 동급 이상 헤딩(또는 입력 끝)에서만 멈춘다.
    text = re.sub(
        r"^## 부록 B\..*?(?=^#{1,2}\s|\Z)", "", text, flags=re.M | re.S
    )
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

    for num, area_body in sorted(areas.items()):
        if num not in EXPECTED_AREAS:
            continue
        for heading in REQUIRED_HEADINGS:
            if heading not in area_body:
                violations.append(f"F{num} 필수 항목 누락: {heading}")

    # 커버리지는 본문에서만 센다. 부록 B의 "제외했다"는 인용이 아니다.
    cited = set(re.findall(r"REQ-WEB-\d{3}", body))
    for req in sorted(EXCLUDED_REQS & cited):
        violations.append(f"{req}는 범위에서 제외된 기능이다")
    for req in sorted(EXPECTED_REQS - cited):
        violations.append(f"미인용 REQ: {req}")
    for req in sorted(cited - EXPECTED_REQS - EXCLUDED_REQS):
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
