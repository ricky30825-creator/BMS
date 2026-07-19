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

# 실제 운영 배포가 없는데 지어낸 운영 지표 라벨. STATS 섹션 제거의 근거가
# 같은 문구를 쓰는 다른 섹션(예: CTA 통계 행)에도 적용되므로 재유입을 막는다.
FABRICATED_METRIC_LABELS = [
    "관제 가동률",
    "모니터링 중 배터리",
    "오늘 안전 차단",
    "평균 조기 경고 리드타임",
    "무중단 운영",
]


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
        # 뒤에 16진수 자리가 더 이어지면(예: #6B7280CC 알파 헥스) 다른 색이므로
        # 경계 없는 부분 문자열 매칭으로 오탐하지 않도록 lookahead로 막는다.
        pattern = re.escape(color) + r"(?![0-9A-Fa-f])"
        n = len(re.findall(pattern, region, re.IGNORECASE))
        if n:
            issues.append(f"차가운 Tailwind 색 {color} {n}회 — 웜 뉴트럴 var(--ink*) 토큰으로 교체")

    # border-radius 선언은 "12px 12px 4px 4px" 같은 다중값 축약형일 수 있으므로
    # 콜론 뒤 선언 전체(세미콜론/따옴표/중괄호 전까지)를 잡아 모든 토큰을 검사한다.
    radius_violations = set()
    for decl in re.findall(r"border-radius:\s*([^;\"'}]+)", region):
        for token in decl.split():
            if not re.fullmatch(r"[0-9]+(?:px|%)?", token):
                continue
            if token in ("0", "0px", "0%"):
                continue  # 0은 반경 스케일 위반이 아니다
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


if __name__ == "__main__":
    import sys

    import bundle_io

    problems = check(bundle_io.unpack(sys.argv[1]))
    for p in problems:
        print(f"  ✗ {p}")
    print(f"\n{len(problems)}건" if problems else "\n토큰 규칙 통과")
    raise SystemExit(1 if problems else 0)
