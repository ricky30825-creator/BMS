#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make_assets.py — PPT 용 SVG 자산을 만든다.

    python make_assets.py                 # 전부 생성
    python make_assets.py --no-db         # DB 없이 다이어그램만

PowerPoint 는 SVG 안의 <style>/CSS 클래스를 제대로 못 읽는 경우가 있어
모든 서식을 요소별 속성으로 직접 박았다. marker(화살촉)도 지원이 들쭉날쭉해
삼각형 <path> 로 직접 그린다.
"""
import argparse
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))

# ── 색 ──────────────────────────────────────────────────────────────────
BG     = "#ffffff"
INK    = "#111827"
MUTED  = "#6b7280"
LINE   = "#d1d5db"
SOFT   = "#f9fafb"
CSV    = "#0f766e"   # 원자료 (teal)
KAFKA  = "#4f46e5"   # Kafka (indigo)
PG     = "#336791"   # PostgreSQL 공식 파랑
BAD    = "#dc2626"   # 붕괴
GOOD   = "#059669"   # 정상
WARN   = "#b45309"

KR = "Malgun Gothic, 맑은 고딕, sans-serif"
MONO = "Consolas, D2Coding, monospace"


# ── SVG 헬퍼 ────────────────────────────────────────────────────────────
def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def rect(x, y, w, h, fill=BG, stroke=LINE, rx=10, sw=1.5, dash=None):
    d = ' stroke-dasharray="%s"' % dash if dash else ""
    return ('<rect x="%g" y="%g" width="%g" height="%g" rx="%g" fill="%s" '
            'stroke="%s" stroke-width="%g"%s/>' % (x, y, w, h, rx, fill, stroke, sw, d))


def text(x, y, s, size=15, fill=INK, weight="normal", anchor="start", family=KR):
    return ('<text x="%g" y="%g" font-family="%s" font-size="%g" font-weight="%s" '
            'fill="%s" text-anchor="%s">%s</text>'
            % (x, y, family, size, weight, fill, anchor, esc(s)))


def line(x1, y1, x2, y2, stroke=LINE, sw=1.5, dash=None):
    d = ' stroke-dasharray="%s"' % dash if dash else ""
    return ('<line x1="%g" y1="%g" x2="%g" y2="%g" stroke="%s" '
            'stroke-width="%g"%s/>' % (x1, y1, x2, y2, stroke, sw, d))


def arrow(x1, y1, x2, y2, stroke=MUTED, sw=2.2, dash=None):
    """가로 화살표. 화살촉은 path 로 직접 그린다 (marker 호환성 문제 회피)."""
    head = 9.0
    out = [line(x1, y1, x2 - head, y2, stroke, sw, dash)]
    out.append('<path d="M %g %g L %g %g L %g %g Z" fill="%s"/>'
               % (x2, y2, x2 - head, y2 - head * 0.6, x2 - head, y2 + head * 0.6, stroke))
    return "".join(out)


def svg(w, h, body, title):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %g %g" '
            'width="%g" height="%g"><title>%s</title>'
            '<rect width="%g" height="%g" fill="%s"/>%s</svg>'
            % (w, h, w, h, esc(title), w, h, BG, body))


def save(name, content):
    p = os.path.join(HERE, name)
    with io.open(p, "w", encoding="utf-8") as f:
        f.write(content)
    print("  %-28s %6.1f KB" % (name, len(content) / 1024.0))


def badge(x, y, s, color, size=12.5):
    """작은 라벨 알약."""
    w = len(s) * size * 0.62 + 18
    return (rect(x, y, w, size + 11, fill=color, stroke="none", rx=(size + 11) / 2, sw=0)
            + text(x + w / 2, y + size + 2.5, s, size, "#ffffff", "bold", "middle"))


BARE = False   # True 면 제목·부제를 빼고 그림만 남긴다.
               # PPT 는 슬라이드가 제목을 주므로 이미지 안 제목이 그대로 중복된다.


def head(title, sub, size=26):
    return [] if BARE else [text(40, 50, title, size, INK, "bold"),
                            text(40, 79, sub, 15, MUTED)]


def finish(W, H, b, name, content_top):
    """BARE 면 제목이 있던 만큼 전체를 끌어올리고 캔버스도 줄인다."""
    body = "".join(b)
    if BARE:
        off = content_top - 24
        body = '<g transform="translate(0,%g)">%s</g>' % (-off, body)
        H -= off
    return svg(W, H, body, name)


def codebox(x, y, w, lines, size=13.0, lh=19.0, pad=14):
    """모노스페이스 코드 상자."""
    h = len(lines) * lh + pad * 2
    out = [rect(x, y, w, h, fill="#0f172a", stroke="#0f172a", rx=8)]
    for i, (s, col) in enumerate(lines):
        out.append(text(x + pad, y + pad + lh * (i + 0.78), s, size, col, "normal",
                        "start", MONO))
    return "".join(out), h


# ════════════════════════════════════════════════════════════════════════
# 04 — 전체 파이프라인 개요
# ════════════════════════════════════════════════════════════════════════
def overview():
    W, H = 1440, 450          # 내용 바닥 402 + 여백
    b = head("CellGuard BMS — 데이터 파이프라인 전 구간",
             "측정 18 run · 176,533 표본이 Kafka 를 거쳐 PostgreSQL 에 적재되고, "
             "대시보드팀·AI팀이 그 위에서 동작한다.", 27)

    y = 130
    boxw, boxh, gap = 224, 158, 54     # 5*224 + 4*54 + 40 = 1416 < 1440
    xs = [40 + i * (boxw + gap) for i in range(5)]

    cols = [CSV, CSV, KAFKA, PG, GOOD]
    heads = ["① 센서 측정", "② 스트리밍", "③ 메시지 버스", "④ 적재", "⑤ 소비"]
    subs = [
        ["Raspberry Pi 4", "INA226 · MLX90614 ×2", "DS18B20 ×2", "", "0.1초 → CSV"],
        ["replay_producer.py", "CSV → JSON 변환", "--speed 로 배속 제어", "", "6,025 건/초"],
        ["Apache Kafka 3.9", "KRaft · 토픽 4개", "battery-data", "", "partition 0"],
        ["consumer_v2.py", "→ PostgreSQL 16", "테이블 3 · 뷰 2", "", "549 건/초"],
        ["대시보드팀", "AI팀 (이상탐지)", "", "", "CONTRACT.md"],
    ]

    for i, x in enumerate(xs):
        b.append(rect(x, y, boxw, boxh, SOFT, cols[i], 12, 2))
        b.append(rect(x, y, boxw, 34, cols[i], cols[i], 12, 2))
        b.append(rect(x, y + 22, boxw, 12, cols[i], cols[i], 0, 0))
        b.append(text(x + boxw / 2, y + 24, heads[i], 15, "#ffffff", "bold", "middle"))
        for j, s in enumerate(subs[i]):
            if not s:
                continue
            w = "bold" if j == 0 else "normal"
            c = INK if j == 0 else MUTED
            fam = MONO if (j == 0 and i in (1, 3)) else KR
            sz = 12.5 if fam == MONO else 13.5
            b.append(text(x + 14, y + 62 + j * 22, s, sz, c, w, "start", fam))
        if i < 4:
            b.append(arrow(x + boxw + 8, y + boxh / 2, x + boxw + gap - 8, y + boxh / 2))

    # 현재/향후 경로 구분
    yy = y + boxh + 52
    b.append(text(40, yy, "현재 검증된 경로", 14, INK, "bold"))
    b.append(line(190, yy - 5, 300, yy - 5, INK, 3))
    b.append(text(316, yy, "측정해 둔 CSV 를 실시간 속도로 재생 (replay)", 13.5, MUTED))

    b.append(text(40, yy + 30, "라이브 전환 시", 14, MUTED, "bold"))
    b.append(line(190, yy + 25, 300, yy + 25, MUTED, 3, "7 5"))
    b.append(text(316, yy + 30,
                  "sensors.py 가 같은 5필드 JSON 을 그대로 발행한다 — "
                  "④⑤ 는 고칠 것이 없다 (source 열만 replay → live)", 13.5, MUTED))

    b.append(rect(1010, yy - 30, 390, 92, SOFT, LINE, 10))
    b.append(text(1030, yy - 6, "적재 결과", 13.5, MUTED, "bold"))
    b.append(text(1030, yy + 20, "runs 18  ·  battery_logs 176,533", 14.5, INK, "bold",
                  "start", MONO))
    b.append(text(1030, yy + 44, "battery_logs_ext 176,533  ·  80 MB", 14.5, INK, "bold",
                  "start", MONO))

    return finish(W, H, b, "파이프라인 전 구간", 130)


# ════════════════════════════════════════════════════════════════════════
# 01 — 스트리밍 (CSV → Kafka)
# ════════════════════════════════════════════════════════════════════════
def stage1():
    W, H = 1440, 680
    b = head("① 측정 데이터를 Kafka 로 실시간 스트리밍",
             "replay_producer.py — 18 run 의 CSV 를 읽어 v1 5필드 계약 JSON 으로 "
             "변환해 발행한다.")

    # 좌: 원자료
    b.append(rect(40, 108, 330, 214, SOFT, CSV, 12, 2))
    b.append(text(60, 138, "원자료", 15, CSV, "bold"))
    b.append(text(60, 164, "*_soc.csv", 15, INK, "bold", "start", MONO))
    for i, s in enumerate(["18 run 디렉터리", "1초 간격 · 18열",
                           "176,533 행", "timestamp, voltage_v,",
                           "current_a, mlx5a_obj_c …"]):
        b.append(text(60, 192 + i * 23, s, 13, MUTED, "normal", "start",
                      MONO if i >= 3 else KR))

    b.append(arrow(378, 215, 434, 215, CSV))

    # 중: 변환
    b.append(rect(442, 108, 386, 300, BG, KAFKA, 12, 2))
    b.append(text(462, 138, "변환  to_record()", 15, KAFKA, "bold"))
    steps = [
        ("① DS 두 채널 스왑 되돌림", "2026-08-26 이전 12 run 은 반대로 기록됐다"),
        ("② temperature = max(5a, 5b)", "평균 아님 — 빗나간 센서가 실온을 읽는다"),
        ("③ −40~150℃ 범위 필터", "0x7FFF 스턱 리드 = 382.19℃ 를 걸러낸다"),
        ("④ 5필드 계약 + 확장키", "v1 컨슈머는 추가 키를 무시한다"),
    ]
    for i, (t1, t2) in enumerate(steps):
        yy = 168 + i * 58
        b.append(rect(462, yy - 16, 346, 48, SOFT, LINE, 8, 1))
        b.append(text(476, yy + 2, t1, 13.5, INK, "bold"))
        b.append(text(476, yy + 22, t2, 11.5, MUTED))

    b.append(arrow(836, 215, 892, 215, KAFKA))

    # 우: Kafka
    b.append(rect(900, 108, 330, 214, SOFT, KAFKA, 12, 2))
    b.append(text(920, 138, "Apache Kafka 3.9 (KRaft)", 15, KAFKA, "bold"))
    b.append(text(920, 166, "topic  battery-data", 14, INK, "bold", "start", MONO))
    for i, s in enumerate(["partition 0 · key = cell_A",
                           "acks=all · retries=5",
                           "linger_ms=50 (배치 전송)",
                           "500건마다 flush()"]):
        b.append(text(920, 194 + i * 23, s, 12.5, MUTED, "normal", "start", MONO))

    b.append(badge(1244, 116, "6,025 건/초", KAFKA))
    b.append(text(1244, 176, "176,533 건", 17, INK, "bold"))
    b.append(text(1244, 199, "29.3 초 소요", 13.5, MUTED))

    # 배속 설명
    b.append(rect(900, 338, 500, 70, SOFT, LINE, 10))
    b.append(text(920, 364, "--speed 로 재생 속도를 정한다", 13.5, INK, "bold"))
    b.append(text(920, 388, "1 = 실시간(시연) · 60 = 60배속 · 0 = 최대속도(벌크 적재)",
                  12.5, MUTED, "normal", "start", MONO))

    # 코드
    code = [
        ("# CSV 한 줄 → Kafka 메시지 한 건", "#64748b"),
        ("hot = [x for x in (mlx5a, mlx5b) if x is not None]", "#e2e8f0"),
        ("temperature = max(hot)          # 평균이 아니라 핫스팟", "#fbbf24"),
        ("", "#e2e8f0"),
        ("producer.send('battery-data', key=b'cell_A', value={", "#e2e8f0"),
        ("    'timestamp': row['timestamp'], 'voltage': v,", "#e2e8f0"),
        ("    'current': i, 'temperature': temperature, 'soc': soc,", "#e2e8f0"),
        ("    'run_id': run_id, 'elapsed_s': el, 'source': 'replay',", "#7dd3fc"),
        ("    '_ext': {...}})                # v1 컨슈머는 무시한다", "#7dd3fc"),
    ]
    cb, ch = codebox(40, 438, 788, code)
    b.append(cb)

    # 메시지 예시
    b.append(rect(860, 438, 540, ch, SOFT, LINE, 8))
    b.append(text(880, 464, "실제 발행 메시지", 13.5, INK, "bold"))
    msg = [
        '{ "timestamp": "2026-08-31T02:52:26.781",',
        '  "voltage": 4.1413,  "current": -0.9908,',
        '  "temperature": 28.99,  "soc": 100.0,',
        '  "run_id": "18650_b1_1A_20260831",',
        '  "elapsed_s": 0.0,  "source": "replay",',
        '  "_ext": { "power_w": 4.1032, ... } }',
    ]
    for i, s in enumerate(msg):
        b.append(text(880, 490 + i * 21, s, 12.5, INK, "normal", "start", MONO))

    return finish(W, H, b, "Kafka 스트리밍", 108)


# ════════════════════════════════════════════════════════════════════════
# 02 — 적재 (Kafka → PostgreSQL)
# ════════════════════════════════════════════════════════════════════════
def stage2():
    W, H = 1440, 720          # 코드 상자 바닥이 701 이라 700 이면 잘린다
    b = head("② Kafka → PostgreSQL 적재",
             "consumer_v2.py — 구독한 메시지를 세 테이블에 나눠 넣는다. "
             "여러 번 돌려도 중복이 쌓이지 않는다.")

    # 좌: Kafka
    b.append(rect(40, 112, 250, 150, SOFT, KAFKA, 12, 2))
    b.append(text(60, 142, "Kafka", 15, KAFKA, "bold"))
    b.append(text(60, 168, "battery-data", 14.5, INK, "bold", "start", MONO))
    for i, s in enumerate(["group_id=", "  sensor-metric-writer-v2",
                           "auto_offset_reset=earliest"]):
        b.append(text(60, 196 + i * 20, s, 11.5, MUTED, "normal", "start", MONO))

    b.append(arrow(298, 187, 352, 187, KAFKA))

    # 중: 컨슈머 3단계
    b.append(rect(360, 112, 440, 330, BG, PG, 12, 2))
    b.append(text(380, 142, "consumer_v2.py", 15, PG, "bold", "start", MONO))
    proc = [
        ("① runs 테이블 먼저 upsert", "runs_manifest.json 18건 — FK 부모가",
         "없으면 시계열이 통째로 막힌다"),
        ("② battery_logs INSERT", "ON CONFLICT (run_id, timestamp)",
         "DO NOTHING → 재실행해도 안전"),
        ("③ RETURNING log_id → ext", "같은 트랜잭션에서 확장 테이블 연결"),
    ]
    for i, item in enumerate(proc):
        yy = 172 + i * 90
        b.append(rect(380, yy, 400, 76, SOFT, LINE, 8, 1))
        b.append(text(396, yy + 24, item[0], 14, INK, "bold"))
        for j, s in enumerate(item[1:]):
            b.append(text(396, yy + 44 + j * 17, s, 11.5, MUTED, "normal", "start", MONO))

    b.append(rect(360, 458, 440, 56, SOFT, LINE, 10))
    b.append(text(380, 482, "배치 커밋 500건", 13.5, INK, "bold"))
    b.append(text(380, 502, "v1 의 건별 commit 은 17만 건에 몇 시간이 걸린다",
                  12, MUTED))

    b.append(arrow(808, 187, 862, 187, PG))

    # 우: PostgreSQL 테이블
    b.append(rect(870, 112, 530, 402, SOFT, PG, 12, 2))
    b.append(text(890, 142, "PostgreSQL 16 — battery_ctrl_db", 15, PG, "bold"))

    tbls = [
        ("runs", "18", "run 조건·결과. 이상탐지 라벨이 여기 있다", GOOD),
        ("battery_logs", "176,533", "시계열 본체 — 5필드 계약 + run_id", PG),
        ("battery_logs_ext", "176,533", "원본 센서값 (DS ×2, MLX ×2, 전력)", MUTED),
    ]
    for i, (n, c, d, col) in enumerate(tbls):
        yy = 168 + i * 78
        b.append(rect(890, yy, 490, 64, BG, col, 8, 1.5))
        b.append(text(908, yy + 26, n, 15, col, "bold", "start", MONO))
        b.append(text(1362, yy + 26, c + " 행", 14.5, INK, "bold", "end", MONO))
        b.append(text(908, yy + 48, d, 12, MUTED))

    b.append(rect(890, 404, 490, 92, BG, LINE, 8))
    b.append(text(908, 430, "뷰 2개", 13.5, INK, "bold"))
    b.append(text(908, 454, "v_run_summary    run 별 요약 (표본수·최대온도·피크전류)",
                  12, MUTED, "normal", "start", MONO))
    b.append(text(908, 476, "v_collapsed_runs 붕괴 run 만 — AI팀 학습용",
                  12, MUTED, "normal", "start", MONO))

    # 배지를 PG 상자 오른쪽 위에 두면 캔버스(1440)를 넘어간다 — 왼쪽 요약 칸에 둔다.
    b.append(text(40, 300, "적재 결과", 14, INK, "bold"))
    b.append(text(40, 328, "176,533 건", 24, INK, "bold"))
    b.append(text(40, 352, "321.5 초 · 건너뜀 0", 13.5, MUTED))
    b.append(text(40, 380, "DB 80 MB", 13.5, MUTED, "normal", "start", MONO))
    b.append(badge(40, 398, "549 건/초", PG))

    # 코드
    code = [
        ("-- 멱등 적재의 핵심 — 같은 (run_id, timestamp) 는 두 번 안 들어간다", "#64748b"),
        ("INSERT INTO battery_logs", "#e2e8f0"),
        ("  (run_id, timestamp, elapsed_s, voltage, current,", "#e2e8f0"),
        ("   temperature, soc, source)", "#e2e8f0"),
        ("VALUES (%s, %s, %s, %s, %s, %s, %s, %s)", "#e2e8f0"),
        ("ON CONFLICT (run_id, timestamp) DO NOTHING", "#fbbf24"),
        ("RETURNING log_id;        -- 확장 테이블을 이어 붙이려고 받는다", "#7dd3fc"),
    ]
    cb, ch = codebox(40, 540, 780, code)
    b.append(cb)

    b.append(rect(860, 540, 540, ch, SOFT, LINE, 8))
    b.append(text(880, 566, "왜 멱등성이 필요한가", 13.5, INK, "bold"))
    for i, s in enumerate([
            "리플레이는 시연 때마다 다시 돌린다. 재실행할 때마다",
            "중복이 쌓이면 용량 적분이 배로 부풀려져 분석이 무너진다.",
            "UNIQUE(run_id, timestamp) 제약이 그것을 DB 차원에서 막는다.",
            "실제로 재실행 시 건너뜀 149건 · 신규 0건으로 확인했다."]):
        b.append(text(880, 592 + i * 21, s, 12.5, MUTED))

    return finish(W, H, b, "PostgreSQL 적재", 112)


# ════════════════════════════════════════════════════════════════════════
# 03 — 전달 (PostgreSQL → 타 팀)
# ════════════════════════════════════════════════════════════════════════
def stage3():
    W, H = 1440, 640          # 내용 바닥 604 + 여백
    b = head("③ PostgreSQL 정리 → 타 팀 전달",
             "스키마와 데이터 계약서(CONTRACT.md)를 함께 넘긴다. "
             "값을 틀리게 읽는 함정이 실제로 여러 번 있었다.")

    # 스키마 관계
    b.append(rect(40, 112, 520, 320, SOFT, PG, 12, 2))
    b.append(text(60, 142, "스키마 — run 경계가 핵심", 15, PG, "bold"))

    b.append(rect(60, 162, 480, 74, BG, GOOD, 8, 1.8))
    b.append(text(76, 188, "runs", 15, GOOD, "bold", "start", MONO))
    b.append(text(524, 188, "PK run_id", 12, MUTED, "normal", "end", MONO))
    b.append(text(76, 210, "battery · mode · setpoint · result · loaded_h · energy_wh",
                  11.5, MUTED, "normal", "start", MONO))
    b.append(text(76, 228, "result 가 이상탐지 라벨이다", 11.5, GOOD, "bold"))

    b.append(line(300, 236, 300, 262, PG, 2))
    b.append(text(310, 256, "1 : N", 11.5, MUTED, "normal", "start", MONO))

    b.append(rect(60, 262, 480, 62, BG, PG, 8, 1.8))
    b.append(text(76, 288, "battery_logs", 15, PG, "bold", "start", MONO))
    b.append(text(524, 288, "UNIQUE(run_id, timestamp)", 12, MUTED, "normal", "end", MONO))
    b.append(text(76, 310, "timestamp · elapsed_s · voltage · current · temperature · soc",
                  11.5, MUTED, "normal", "start", MONO))

    b.append(line(300, 324, 300, 348, PG, 2))
    b.append(text(310, 344, "1 : 1", 11.5, MUTED, "normal", "start", MONO))

    b.append(rect(60, 348, 480, 62, BG, MUTED, 8, 1.8))
    b.append(text(76, 374, "battery_logs_ext", 15, MUTED, "bold", "start", MONO))
    b.append(text(76, 396, "power_w · ds_cell_c · mlx5a/5b_obj_c · dod_ah · dod_wh",
                  11.5, MUTED, "normal", "start", MONO))

    # 계약서 — 반드시 알아야 할 것
    b.append(rect(586, 112, 462, 320, BG, WARN, 12, 2))
    b.append(text(606, 142, "CONTRACT.md — 틀리게 읽는 함정", 15, WARN, "bold"))
    traps = [
        ("current 는 방전이 음수", "그대로 그리면 그래프가 뒤집힌다"),
        ("temperature = max(5a, 5b)", "평균 쓰면 빗나간 센서가 신호를 죽인다"),
        ("soc=100 은 완충이 아니다", "그 run 의 시작점 — run 간 비교 금지"),
        ("duration_h 말고 loaded_h", "기록 공백이 포함된다 (3.35h vs 1.49h)"),
        ("run_id 없이 조회 금지", "18 run 이 한 테이블에 섞여 있다"),
    ]
    for i, (t1, t2) in enumerate(traps):
        yy = 168 + i * 53
        b.append(rect(606, yy, 422, 44, SOFT, LINE, 7, 1))
        b.append(text(620, yy + 19, t1, 13, INK, "bold", "start", MONO))
        b.append(text(620, yy + 36, t2, 11.5, MUTED))

    # 소비자
    b.append(rect(1074, 112, 326, 320, SOFT, LINE, 12))
    b.append(text(1094, 142, "받는 쪽", 15, INK, "bold"))

    b.append(rect(1094, 162, 286, 118, BG, PG, 8, 1.8))
    b.append(text(1110, 188, "대시보드팀", 14.5, PG, "bold"))
    for i, s in enumerate(["run 목록 드롭다운", "run 별 시계열 그래프",
                           "실시간 라이브 패널"]):
        b.append(text(1110, 210 + i * 21, "· " + s, 12, MUTED))

    b.append(rect(1094, 296, 286, 124, BG, BAD, 8, 1.8))
    b.append(text(1110, 322, "AI팀 (이상탐지)", 14.5, BAD, "bold"))
    for i, s in enumerate(["collapsed 3 run — 양성 라벨", "completed 14 run — 음성",
                           "aborted 1 run — 학습 제외"]):
        b.append(text(1110, 344 + i * 21, "· " + s, 12, MUTED))

    # 질의 예시
    code = [
        ("-- 대시보드: run 하나의 시계열", "#64748b"),
        ("SELECT elapsed_s, voltage, abs(current) AS current_a,", "#e2e8f0"),
        ("       temperature, soc", "#e2e8f0"),
        ("FROM battery_logs", "#e2e8f0"),
        ("WHERE run_id = $1            -- run 경계를 반드시 건다", "#fbbf24"),
        ("ORDER BY elapsed_s;", "#e2e8f0"),
    ]
    cb, ch = codebox(40, 462, 660, code)
    b.append(cb)

    code2 = [
        ("-- AI팀: 붕괴 직전 60초 (양성 구간)", "#64748b"),
        ("SELECT l.elapsed_s, l.voltage, abs(l.current) AS i", "#e2e8f0"),
        ("FROM battery_logs l JOIN runs r USING (run_id)", "#e2e8f0"),
        ("WHERE r.result = 'collapsed'", "#fbbf24"),
        ("  AND l.elapsed_s > r.duration_h * 3600 - 60", "#e2e8f0"),
        ("ORDER BY r.run_id, l.elapsed_s;", "#e2e8f0"),
    ]
    cb2, _ = codebox(730, 462, 670, code2)
    b.append(cb2)

    return finish(W, H, b, "데이터 전달", 112)


# ════════════════════════════════════════════════════════════════════════
# 05 — 실데이터 차트 (붕괴 vs 완주)
# ════════════════════════════════════════════════════════════════════════
def fetch(cur, run_id, step):
    cur.execute("""
        SELECT elapsed_s, voltage, abs(current)
        FROM battery_logs
        WHERE run_id = %s AND (elapsed_s::int %% %s) = 0
        ORDER BY elapsed_s
    """, (run_id, step))
    return [(float(a), float(b), float(c)) for a, b, c in cur.fetchall()]


def fetch_tail(cur, run_id, seconds):
    cur.execute("""
        SELECT elapsed_s, voltage, abs(current)
        FROM battery_logs
        WHERE run_id = %s
          AND elapsed_s > (SELECT max(elapsed_s) - %s FROM battery_logs WHERE run_id = %s)
        ORDER BY elapsed_s
    """, (run_id, seconds, run_id))
    return [(float(a), float(b), float(c)) for a, b, c in cur.fetchall()]


def poly(pts, x0, y0, w, h, xmin, xmax, ymin, ymax, color, sw=2.2):
    if not pts:
        return ""
    def px(v):
        return x0 + (v - xmin) / (xmax - xmin) * w
    def py(v):
        return y0 + h - (v - ymin) / (ymax - ymin) * h
    d = " ".join("%.1f,%.1f" % (px(a), py(b)) for a, b in pts)
    return ('<polyline points="%s" fill="none" stroke="%s" stroke-width="%g" '
            'stroke-linejoin="round" stroke-linecap="round"/>' % (d, color, sw))


def clipped(cid, x0, y0, w, h, content):
    """축 범위 밖 표본이 상자를 뚫고 나가는 것을 막는다.
    c6 는 첫 2초가 전류 상승 구간이라 하한(1.5A) 아래로 내려간다."""
    return ('<defs><clipPath id="%s"><rect x="%g" y="%g" width="%g" height="%g"/>'
            '</clipPath></defs><g clip-path="url(#%s)">%s</g>'
            % (cid, x0, y0, w, h, cid, content))


def axes(x0, y0, w, h, xmin, xmax, ymin, ymax, xlab, ylab, xticks, yticks, xfmt, yfmt):
    b = [rect(x0, y0, w, h, BG, LINE, 4, 1.2)]
    for v in yticks:
        yy = y0 + h - (v - ymin) / (ymax - ymin) * h
        b.append(line(x0, yy, x0 + w, yy, "#eef0f3", 1))
        b.append(text(x0 - 10, yy + 4, yfmt % v, 11.5, MUTED, "normal", "end", MONO))
    for v in xticks:
        xx = x0 + (v - xmin) / (xmax - xmin) * w
        b.append(line(xx, y0, xx, y0 + h, "#eef0f3", 1))
        b.append(text(xx, y0 + h + 20, xfmt % v, 11.5, MUTED, "normal", "middle", MONO))
    b.append(text(x0 + w / 2, y0 + h + 44, xlab, 12.5, MUTED, "normal", "middle"))
    b.append(text(x0 - 46, y0 + h / 2, ylab, 12.5, MUTED, "normal", "middle"))
    return "".join(b)


def chart(cur):
    W, H = 1440, 640
    b = head("이상탐지 라벨이 실제로 무엇인가 — CP 되먹임 붕괴",
             "같은 팩(PB-10000)·같은 충전 상태에서 전력만 10% 다르다. "
             "붕괴는 고갈이 아니라 포트 정격 초과가 만든 양의 되먹임이다.")

    c2 = fetch(cur, "PB10000_c2_10W_20260826", 10)
    c6 = fetch(cur, "PB10000_c6_9W_20260826", 10)
    c2t = fetch_tail(cur, "PB10000_c2_10W_20260826", 90)
    c6t = fetch_tail(cur, "PB10000_c6_9W_20260826", 90)

    # 범례·제목은 그림 영역 밖(위쪽 띠)에 둔다 — 안에 두면 곡선과 겹친다.
    # y 하한도 0 으로 잡는다. 2.5 로 자르면 붕괴 구간이 축 상자를 뚫고 나간다.
    y0, h = 186, 286
    YMIN, YMAX = 0.0, 5.4
    YT = [0, 1, 2, 3, 4, 5]

    # ── 좌: 전체 run 전압 ────────────────────────────────────────────
    x0, w = 96, 600
    xmax = 190.0
    b.append(text(x0, 126, "전체 run — 전압", 15, INK, "bold"))
    b.append(rect(x0, 140, 13, 13, BAD, BAD, 3, 0))
    b.append(text(x0 + 20, 151, "c2  CP 10.20 W  →  34분 붕괴 · 5.76 Wh", 12.5, INK))
    b.append(rect(x0, 160, 13, 13, GOOD, GOOD, 3, 0))
    b.append(text(x0 + 20, 171, "c6  CP  9.22 W  →  3.07h 완주 · 28.27 Wh", 12.5, INK))

    b.append(axes(x0, y0, w, h, 0, xmax, YMIN, YMAX, "경과 시간 [분]", "전압 [V]",
                  [0, 30, 60, 90, 120, 150, 180], YT, "%.0f", "%.0f"))
    b.append(clipped("clipV", x0, y0, w, h,
                     poly([(a / 60.0, v) for a, v, _ in c6], x0, y0, w, h,
                          0, xmax, YMIN, YMAX, GOOD)
                     + poly([(a / 60.0, v) for a, v, _ in c2], x0, y0, w, h,
                            0, xmax, YMIN, YMAX, BAD)))

    xc2 = x0 + (2027 / 60.0) / xmax * w
    b.append(line(xc2, y0, xc2, y0 + h, BAD, 1.4, "5 4"))
    b.append(text(xc2 + 8, y0 + 22, "붕괴", 12.5, BAD, "bold"))

    # ── 우: 전류가 포트 정격에 닿는 과정 ─────────────────────────────
    # CP 부하는 I = P/V 를 지키므로 전압이 처질수록 전류를 더 끌어간다.
    # 되먹임의 실체가 이 그림이다.
    x1, w1 = 830, 530
    ILO, IHI = 1.5, 3.0          # 동작 구간만 — 0 부터 그리면 변화가 안 보인다
    b.append(text(x1, 126, "전류 — 되먹임의 실체", 15, INK, "bold"))
    b.append(text(x1, 151, "CP 부하는 I = P/V 를 지킨다 → 전압이 처지면 전류를 더 끌어간다",
                  12.5, MUTED))
    b.append(line(x1, 162, x1 + 26, 162, WARN, 1.8, "5 4"))
    b.append(text(x1 + 34, 167, "PB-10000 C타입 포트 정격 2.40 A", 12.5, WARN, "bold"))

    b.append(axes(x1, y0, w1, h, 0, xmax, ILO, IHI, "경과 시간 [분]", "전류 [A]",
                  [0, 30, 60, 90, 120, 150, 180], [1.5, 2.0, 2.5, 3.0],
                  "%.0f", "%.1f"))

    def iy(v):
        return y0 + h - (v - ILO) / (IHI - ILO) * h

    yrate = iy(2.40)
    b.append(line(x1, yrate, x1 + w1, yrate, WARN, 1.8, "5 4"))

    b.append(clipped("clipI", x1, y0, w1, h,
                     poly([(a / 60.0, i) for a, _, i in c6], x1, y0, w1, h,
                          0, xmax, ILO, IHI, GOOD)
                     + poly([(a / 60.0, i) for a, _, i in c2], x1, y0, w1, h,
                            0, xmax, ILO, IHI, BAD)))

    b.append(text(x1 + 104, iy(2.628) - 10, "c2  2.63 A = 정격의 109%",
                  12.5, BAD, "bold"))
    b.append(text(x1 + w1 - 26, iy(2.328) + 26, "c6  2.33 A = 97% 에서 종료",
                  12.5, GOOD, "bold", "end"))

    # 결론
    yy = 532
    b.append(rect(40, yy, 1360, 84, SOFT, LINE, 10))
    b.append(text(60, yy + 30, "전력을 10% 낮췄더니 에너지가 4.9배 나왔다.", 16, INK, "bold"))
    b.append(text(60, yy + 58,
                  "c2 는 34분 만에 5.76 Wh 만 내놓고 멈췄다 — 같은 팩이 c6 에서는 "
                  "28.27 Wh 를 냈으니 80% 가 팩 안에 남은 것이다. 고갈이 아니다. "
                  "CC 모드에서는 전류가 고정이라 이 되먹임이 일어나지 않는다.",
                  13, MUTED))

    return finish(W, H, b, "붕괴 vs 완주", 126)


# ════════════════════════════════════════════════════════════════════════
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-db", action="store_true", help="DB 없이 다이어그램만")
    ap.add_argument("--pg-host", default="localhost")
    ap.add_argument("--pg-port", type=int, default=5433)
    args = ap.parse_args()

    global BARE
    cur = conn = None
    if not args.no_db:
        import psycopg2
        conn = psycopg2.connect(host=args.pg_host, port=args.pg_port,
                                dbname="battery_ctrl_db", user="battery_admin",
                                password="cellguard_dev")
        cur = conn.cursor()

    # 두 벌을 만든다.
    #   기본    — 제목 포함. 문서·단독 배포용
    #   *_ppt   — 제목 제외. 슬라이드가 제목을 주므로 넣으면 그대로 중복된다
    for bare, suffix in ((False, ""), (True, "_ppt")):
        BARE = bare
        print("생성 중 — %s" % ("PPT용(제목 없음)" if bare else "기본"))
        save("04_overview%s.svg" % suffix, overview())
        save("01_kafka_streaming%s.svg" % suffix, stage1())
        save("02_kafka_to_postgres%s.svg" % suffix, stage2())
        save("03_delivery%s.svg" % suffix, stage3())
        if cur is not None:
            save("05_anomaly_label%s.svg" % suffix, chart(cur))
        else:
            print("  (--no-db 라 차트는 건너뜀)")

    if cur is not None:
        cur.close()
        conn.close()
    print("\n완료 — PowerPoint 에서 삽입 > 그림 으로 넣으면 벡터로 들어간다.")


if __name__ == "__main__":
    main()
