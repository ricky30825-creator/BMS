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
