#!/usr/bin/env python3
"""User flow SVG generator – AI Battery Monitoring System (v2, reviewed)

검토 반영 7개 개선:
 1) 안전 루프 연결: 경고→위험 등급 감지→(자동) Kill-Switch + 즉시 알림
 2) 역할(RBAC) 분기: 로그인 후 역할 확인, 관리자 패널 진입 전 권한 게이트
 3) Dead-end 복귀: 아이디찾기·비번재설정→로그인, 디바이스 등록→목록
 4) 알림 딥링크: 카톡 알림 클릭→대시보드 진입
 5) 위험 작업 확인 단계: 차단/복구/권한변경 confirm
 6) 모드 인터락: 모드 적용 전 이전 릴레이 차단
 7) 로그아웃 글로벌화: 대시보드(허브)에서 직접 접근
"""
import math, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

W, H = 1960, 1320
NW, NH = 150, 40   # rectangle node width/height
SR = 22             # start-circle radius

sections = [
    #  id    label                    x    y     w     h    fill       stroke
    ('s1', '인증 / 온보딩',           20,  30, 1880, 300, '#EDE9FE', '#7C3AED'),
    ('s2', '디바이스 관리',            20, 350, 1880, 210, '#DBEAFE', '#1D4ED8'),
    ('s3', '모니터링 대시보드',        20, 580, 1880, 230, '#D1FAE5', '#065F46'),
    ('s4', '이상 탐지',                20, 830,  660, 350, '#FEE2E2', '#991B1B'),
    ('s5', '알림 관리',               700, 830,  540, 350, '#FEF9C3', '#78350F'),
    ('s6', '관리자 설정',            1260, 830,  690, 350, '#FFEDD5', '#7C2D12'),
]

nodes = {
    # ── S1: 인증/온보딩 ──────────────────────────────────────────────
    'n1':  {'cx':   75, 'cy': 150, 'type': 'start',     'label': '시작'},
    'n2':  {'cx':  270, 'cy': 150, 'type': 'main_page', 'label': '로그인 페이지'},
    'n3':  {'cx':  485, 'cy': 110, 'type': 'action',    'label': '일반 로그인'},
    'n4':  {'cx':  485, 'cy': 165, 'type': 'action',    'label': '소셜 로그인'},
    'n43': {'cx':  705, 'cy': 135, 'type': 'gate',      'label': '역할 확인'},          # NEW (2)
    'n5':  {'cx':  485, 'cy': 225, 'type': 'page',      'label': '회원가입 페이지'},
    'n6':  {'cx':  705, 'cy': 225, 'type': 'action',    'label': '회원가입 완료'},
    'n7':  {'cx':  485, 'cy': 290, 'type': 'page',      'label': '계정 찾기 페이지'},
    'n8':  {'cx':  705, 'cy': 290, 'type': 'action',    'label': '아이디 찾기'},
    'n9':  {'cx':  905, 'cy': 290, 'type': 'action',    'label': '비밀번호 재설정'},
    # ── S2: 디바이스 관리 ─────────────────────────────────────────────
    'n10': {'cx':  165, 'cy': 460, 'type': 'main_page', 'label': '디바이스 관리'},
    'n11': {'cx':  410, 'cy': 418, 'type': 'action',    'label': '디바이스 등록'},
    'n12': {'cx':  410, 'cy': 470, 'type': 'action',    'label': '디바이스 선택'},
    'n13': {'cx':  655, 'cy': 460, 'type': 'page',      'label': '측정 모드 선택'},
    'n14': {'cx':  895, 'cy': 410, 'type': 'action',    'label': '내장 배터리 모드'},
    'n15': {'cx':  895, 'cy': 460, 'type': 'action',    'label': '외부 셀 모드'},
    'n16': {'cx':  895, 'cy': 510, 'type': 'action',    'label': '보조배터리 모드'},
    'n49': {'cx': 1140, 'cy': 460, 'type': 'gate',      'label': '모드 인터락 차단'},   # NEW (6)
    # ── S3: 모니터링 대시보드 ─────────────────────────────────────────
    'n17': {'cx':  165, 'cy': 695, 'type': 'main_page', 'label': '실시간 대시보드'},
    'n18': {'cx':  420, 'cy': 652, 'type': 'action',    'label': '상태 게이지 확인'},
    'n19': {'cx':  420, 'cy': 704, 'type': 'action',    'label': '실시간 갱신'},
    'n20': {'cx':  675, 'cy': 648, 'type': 'page',      'label': '추세 차트 페이지'},
    'n21': {'cx':  915, 'cy': 623, 'type': 'action',    'label': '기간 선택 조회'},
    'n22': {'cx':  915, 'cy': 675, 'type': 'action',    'label': '지표별 필터링'},
    'n23': {'cx':  675, 'cy': 748, 'type': 'page',      'label': '이벤트 이력 페이지'},
    'n24': {'cx':  915, 'cy': 748, 'type': 'action',    'label': '이벤트 상세 확인'},
    'n44': {'cx': 1180, 'cy': 790, 'type': 'gate',      'label': '관리자 권한 확인'},   # NEW (2)
    'n45': {'cx':  360, 'cy': 790, 'type': 'entry',     'label': '카톡 알림 진입'},     # NEW (4)
    'n41': {'cx':  165, 'cy': 790, 'type': 'action',    'label': '로그아웃'},           # MOVED (7)
    # ── S4: 이상 탐지 ─────────────────────────────────────────────────
    'n25': {'cx':  150, 'cy': 950, 'type': 'main_page', 'label': '이상 탐지 관리'},
    'n26': {'cx':  400, 'cy': 892, 'type': 'action',    'label': '이상점수 확인'},
    'n27': {'cx':  400, 'cy': 944, 'type': 'action',    'label': '경고 상태 확인'},
    'n42': {'cx':  400, 'cy': 1000,'type': 'danger',    'label': '위험 등급 감지'},     # NEW (1)
    # ── S5: 알림 관리 ─────────────────────────────────────────────────
    'n30': {'cx':  820, 'cy': 945, 'type': 'main_page', 'label': '알림 설정'},
    'n31': {'cx': 1050, 'cy': 892, 'type': 'action',    'label': '카카오톡 연동'},
    'n32': {'cx': 1050, 'cy': 944, 'type': 'action',    'label': '알림 조건 설정'},
    'n33': {'cx': 1050, 'cy': 1000,'type': 'page',      'label': '알림 이력 페이지'},
    'n34': {'cx': 1140, 'cy': 1055,'type': 'action',    'label': '알림 이력 조회'},
    # ── S6: 관리자 설정 ───────────────────────────────────────────────
    'n35': {'cx': 1335, 'cy': 980, 'type': 'main_page', 'label': '관리자 제어 패널'},
    'n36': {'cx': 1490, 'cy': 915, 'type': 'page',      'label': '릴레이 제어 페이지'},
    'n46': {'cx': 1660, 'cy': 890, 'type': 'gate',      'label': '차단 확인'},          # NEW (5)
    'n37': {'cx': 1845, 'cy': 890, 'type': 'danger',    'label': 'Kill-Switch 차단'},
    'n47': {'cx': 1660, 'cy': 945, 'type': 'gate',      'label': '복구 확인'},          # NEW (5)
    'n38': {'cx': 1845, 'cy': 945, 'type': 'action',    'label': '회로 복구'},
    'n39': {'cx': 1490, 'cy': 1050,'type': 'page',      'label': '사용자 권한 관리'},
    'n48': {'cx': 1660, 'cy': 1050,'type': 'gate',      'label': '권한변경 확인'},      # NEW (5)
    'n40': {'cx': 1845, 'cy': 1050,'type': 'action',    'label': '권한 변경'},
}

edges = [
    # 인증/온보딩
    ('n1','n2'),
    ('n2','n3'), ('n2','n4'), ('n2','n5'), ('n2','n7'),
    ('n5','n6'),
    ('n6','n2'),                 # 회원가입 후 로그인 복귀
    ('n7','n8'), ('n7','n9'),
    ('n8','n2'), ('n9','n2'),    # 계정찾기 후 로그인 복귀 (NEW)
    ('n3','n43'), ('n4','n43'),  # 로그인 → 역할 확인 (NEW)
    ('n43','n10'),               # 역할 확인 → 디바이스
    # 디바이스 관리
    ('n10','n11'), ('n10','n12'),
    ('n11','n10'),               # 등록 후 목록 복귀 (NEW)
    ('n12','n13'),
    ('n13','n14'), ('n13','n15'), ('n13','n16'),
    ('n14','n49'), ('n15','n49'), ('n16','n49'),  # 모드 → 인터락 (NEW)
    ('n49','n17'),               # 인터락 통과 → 대시보드
    # 대시보드 (허브)
    ('n17','n18'), ('n17','n19'),
    ('n17','n20'), ('n17','n23'),
    ('n20','n21'), ('n20','n22'),
    ('n23','n24'),
    ('n17','n25'), ('n17','n30'),
    ('n17','n44'), ('n44','n35'), # 관리자 권한 게이트 (NEW)
    ('n17','n41'),                # 로그아웃 (글로벌, NEW 위치)
    ('n45','n17'),                # 카톡 알림 딥링크 진입 (NEW)
    # 이상 탐지 + 안전 루프
    ('n25','n26'), ('n25','n27'),
    ('n27','n42'),               # 경고 → 위험 등급 감지 (NEW)
    ('n42','n37'),               # 자동 Kill-Switch 차단 (NEW, 강조)
    ('n42','n30'),               # 위험 시 즉시 알림 (NEW, 강조)
    # 알림 관리
    ('n30','n31'), ('n30','n32'), ('n30','n33'),
    ('n33','n34'),
    # 관리자 설정 (확인 단계 포함)
    ('n35','n36'), ('n35','n39'),
    ('n36','n46'), ('n46','n37'),  # 차단 확인 → Kill-Switch (NEW)
    ('n36','n47'), ('n47','n38'),  # 복구 확인 → 회로 복구 (NEW)
    ('n39','n48'), ('n48','n40'),  # 권한변경 확인 → 권한 변경 (NEW)
]

# 복귀(back) 흐름: 빨간 점선, 소스 아래로 곡선
RETURN_EDGES = {
    ('n6','n2'): 85, ('n8','n2'): 60, ('n9','n2'): 95, ('n11','n10'): 70,
}
# 안전 자동 차단/알림: 빨간 실선 굵게, 캔버스 하단 우회
SAFETY_EDGES = {('n42','n37'), ('n42','n30')}
# 딥링크 진입: 초록 점선
DEEPLINK_EDGES = {('n45','n17')}

NODE_STYLES = {
    'start':     {'fill': '#22C55E', 'stroke': '#15803D', 'tc': 'white'},
    'main_page': {'fill': '#3B82F6', 'stroke': '#1D4ED8', 'tc': 'white'},
    'page':      {'fill': '#BAE6FD', 'stroke': '#0284C7', 'tc': '#0C4A6E'},
    'action':    {'fill': '#F1F5F9', 'stroke': '#94A3B8', 'tc': '#334155'},
    'gate':      {'fill': '#FEF3C7', 'stroke': '#D97706', 'tc': '#92400E'},  # 확인/게이트
    'danger':    {'fill': '#FCA5A5', 'stroke': '#DC2626', 'tc': '#7F1D1D'},  # 위험/차단
    'entry':     {'fill': '#BBF7D0', 'stroke': '#16A34A', 'tc': '#14532D'},  # 외부 진입
}


def border_pt(node, dx, dy):
    """Return the point on the node border in direction (dx,dy) from centre."""
    cx, cy = node['cx'], node['cy']
    if node['type'] == 'start':
        d = math.hypot(dx, dy) or 1
        return cx + SR * dx / d, cy + SR * dy / d
    hw, hh = NW / 2, NH / 2
    if dx == 0 and dy == 0:
        return float(cx), float(cy)
    adx, ady = abs(dx), abs(dy)
    if adx * hh >= ady * hw:            # exit left/right
        sgn = 1 if dx > 0 else -1
        t = hw / adx
        return cx + sgn * hw, cy + dy * t
    else:                               # exit top/bottom
        sgn = 1 if dy > 0 else -1
        t = hh / ady
        return cx + dx * t, cy + sgn * hh


def edge_svg(src_id, tgt_id):
    s, t = nodes[src_id], nodes[tgt_id]
    dx, dy = t['cx'] - s['cx'], t['cy'] - s['cy']

    # 복귀 흐름: 빨간 점선 곡선 (소스 아래로)
    if (src_id, tgt_id) in RETURN_EDGES:
        sx, sy = border_pt(s, 0, 1)        # exit bottom
        tx, ty = border_pt(t, 0, 1)        # enter bottom
        ym = max(s['cy'], t['cy']) + RETURN_EDGES[(src_id, tgt_id)]
        return (
            f'<path d="M {sx:.1f} {sy:.1f} C {sx:.1f} {ym} {tx:.1f} {ym} {tx:.1f} {ty:.1f}" '
            f'stroke="#EF4444" stroke-width="1.5" fill="none" '
            f'stroke-dasharray="6,3" marker-end="url(#arr-red)"/>'
        )

    # 안전 자동 차단/알림: 빨간 실선 굵게, 캔버스 최하단 우회
    if (src_id, tgt_id) in SAFETY_EDGES:
        sx, sy = border_pt(s, 0, 1)
        tx, ty = border_pt(t, 0, 1)
        ym = 1248
        return (
            f'<path d="M {sx:.1f} {sy:.1f} C {sx:.1f} {ym} {tx:.1f} {ym} {tx:.1f} {ty:.1f}" '
            f'stroke="#DC2626" stroke-width="2.6" fill="none" marker-end="url(#arr-red)"/>'
        )

    # 딥링크 진입: 초록 점선
    if (src_id, tgt_id) in DEEPLINK_EDGES:
        sx, sy = border_pt(s,  dx,  dy)
        tx, ty = border_pt(t, -dx, -dy)
        return (
            f'<line x1="{sx:.1f}" y1="{sy:.1f}" x2="{tx:.1f}" y2="{ty:.1f}" '
            f'stroke="#16A34A" stroke-width="2" stroke-dasharray="6,3" marker-end="url(#arr-green)"/>'
        )

    sx, sy = border_pt(s,  dx,  dy)
    tx, ty = border_pt(t, -dx, -dy)
    return (
        f'<line x1="{sx:.1f}" y1="{sy:.1f}" x2="{tx:.1f}" y2="{ty:.1f}" '
        f'stroke="#94A3B8" stroke-width="1.5" marker-end="url(#arr)"/>'
    )


def node_svg(node):
    s = NODE_STYLES[node['type']]
    cx, cy, label, nt = node['cx'], node['cy'], node['label'], node['type']
    parts = []
    if nt == 'start':
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="{SR}" fill="{s["fill"]}" stroke="{s["stroke"]}" stroke-width="2.5"/>')
        parts.append(f'<text x="{cx}" y="{cy}" text-anchor="middle" dominant-baseline="central" fill="{s["tc"]}" font-size="11" font-weight="bold">{label}</text>')
    else:
        x, y = cx - NW // 2, cy - NH // 2
        rx = 10 if nt in ('action', 'gate', 'entry', 'danger') else 5
        sw = 2.5 if nt in ('main_page', 'danger') else 1.5
        dash = ' stroke-dasharray="5,3"' if nt == 'entry' else ''
        parts.append(f'<rect x="{x}" y="{y}" width="{NW}" height="{NH}" rx="{rx}" fill="{s["fill"]}" stroke="{s["stroke"]}" stroke-width="{sw}"{dash}/>')
        fw = ' font-weight="bold"' if nt == 'danger' else ''
        parts.append(f'<text x="{cx}" y="{cy}" text-anchor="middle" dominant-baseline="central" fill="{s["tc"]}" font-size="11"{fw}>{label}</text>')
    return '\n'.join(parts)


def build_svg():
    out = []
    out.append('<?xml version="1.0" encoding="UTF-8"?>')
    out.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" font-family="\'Noto Sans KR\', Arial, sans-serif">'
    )
    out.append(f'<rect width="{W}" height="{H}" fill="#F8FAFC"/>')

    out.append(
        f'<text x="{W//2}" y="20" text-anchor="middle" dominant-baseline="central" '
        f'font-size="17" font-weight="bold" fill="#1E293B">'
        f'AI 배터리 열폭주 관제 시스템 — 유저 플로우 (v2, 검토 반영)</text>'
    )

    out.append(
        '<defs>'
        '<marker id="arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">'
        '<polygon points="0 0,8 3,0 6" fill="#94A3B8"/></marker>'
        '<marker id="arr-red" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">'
        '<polygon points="0 0,9 3.5,0 7" fill="#DC2626"/></marker>'
        '<marker id="arr-green" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">'
        '<polygon points="0 0,9 3.5,0 7" fill="#16A34A"/></marker>'
        '</defs>'
    )

    # Sections
    for sid, label, x, y, w, h, bg, fc in sections:
        out.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" '
            f'fill="{bg}" stroke="{fc}" stroke-width="1.5" opacity="0.9"/>'
        )
        out.append(
            f'<text x="{x+14}" y="{y+20}" dominant-baseline="central" '
            f'font-size="12" font-weight="bold" fill="{fc}">{label}</text>'
        )

    # Edges (before nodes)
    for src, tgt in edges:
        out.append(edge_svg(src, tgt))

    # Nodes
    for node in nodes.values():
        out.append(node_svg(node))

    # ── Legend ────────────────────────────────────────────────────────
    lx, ly = 1500, 60
    out.append(
        f'<rect x="{lx-12}" y="{ly-12}" width="252" height="246" rx="8" '
        f'fill="white" stroke="#CBD5E1" stroke-width="1" opacity="0.97"/>'
    )
    out.append(
        f'<text x="{lx}" y="{ly+4}" dominant-baseline="central" '
        f'font-size="11" font-weight="bold" fill="#334155">범례</text>'
    )
    legend_nodes = [
        ('start',     '시작점'),
        ('main_page', '주요 화면'),
        ('page',      '서브 화면'),
        ('action',    '사용자 액션'),
        ('gate',      '확인 / 권한 게이트'),
        ('danger',    '위험 / 물리 차단'),
        ('entry',     '외부 진입 (알림)'),
    ]
    for i, (nt, label) in enumerate(legend_nodes):
        iy = ly + 26 + i * 22
        s = NODE_STYLES[nt]
        if nt == 'start':
            out.append(f'<circle cx="{lx+10}" cy="{iy}" r="9" fill="{s["fill"]}" stroke="{s["stroke"]}" stroke-width="1.5"/>')
        else:
            out.append(f'<rect x="{lx+1}" y="{iy-9}" width="18" height="18" rx="3" fill="{s["fill"]}" stroke="{s["stroke"]}" stroke-width="1.5"/>')
        out.append(f'<text x="{lx+28}" y="{iy}" dominant-baseline="central" font-size="10" fill="#334155">{label}</text>')

    # edge legend
    edge_legend = [
        ('#EF4444', '6,3',  'arr-red',   '복귀 흐름'),
        ('#DC2626', None,   'arr-red',   '위험 시 자동 차단/알림'),
        ('#16A34A', '6,3',  'arr-green', '알림 딥링크 진입'),
    ]
    for j, (color, dash, marker, label) in enumerate(edge_legend):
        iy = ly + 26 + (len(legend_nodes) + j) * 22 + 2
        da = f' stroke-dasharray="{dash}"' if dash else ''
        sw = 2.4 if dash is None else 1.6
        out.append(
            f'<line x1="{lx}" y1="{iy}" x2="{lx+20}" y2="{iy}" '
            f'stroke="{color}" stroke-width="{sw}"{da} marker-end="url(#{marker})"/>'
        )
        out.append(f'<text x="{lx+28}" y="{iy}" dominant-baseline="central" font-size="10" fill="#334155">{label}</text>')

    out.append('</svg>')
    return '\n'.join(out)


if __name__ == '__main__':
    svg = build_svg()
    out_path = os.path.join(ROOT, 'assets', 'userflow.svg')
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(svg)
    print(f'Saved: {out_path}  ({len(nodes)} nodes, {len(edges)} edges)')
