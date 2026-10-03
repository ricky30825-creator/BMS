#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make_assets_live.py — 2026-09-04 라이브 전환으로 새로 생긴 슬라이드 자산.

    python make_assets_live.py            # 전부 생성 (DB 필요)
    python make_assets_live.py --no-db    # DB 조회 없이, 아래 상수의 확정값으로

`make_assets.py` 의 헬퍼·색·레이아웃 규칙을 그대로 쓴다. 새 파일로 나눈 이유는
기존 다섯 장이 이미 슬라이드에 박혀 있어 건드릴 이유가 없기 때문이다.

만드는 것 (기존 01~05 다음 번호):
    06_live_switch.svg    리플레이 → 실시간 전환
    07_portability.svg    망 이식성 (집 / 핫스팟 / EC2 가 같은 구조)
    08_hotspot_rule.svg   temperature = max(5a, 5b) 가 DB 에서 확인된다

숫자는 전부 **가동 중인 DB 에서 뽑은 값**이다. `--no-db` 로 돌리면 아래
FALLBACK 상수를 쓰는데, 그것도 2026-09-05 에 실제로 조회한 값이다.
"""
import argparse

import make_assets as ma
from make_assets import (BG, INK, MUTED, LINE, SOFT, CSV, KAFKA, PG, BAD, GOOD,
                         WARN, KR, MONO, arrow, badge, codebox, rect, save, text)

# ── DB 가 없을 때 쓰는 확정값 (2026-09-05 조회) ─────────────────────────
FALLBACK = {
    "replay_rows": 176533, "replay_runs": 18,
    "live_rows": 2094, "live_runs": 1,
    "live_span_min": 168.3,
    # temperature = max(5a, 5b) 를 증명하는 두 run.
    # 어느 센서가 셀을 보는지가 run 마다 **뒤집힌다** — 그래서 한쪽을 고정으로
    # 쓸 수 없고, 표본마다 max 를 취해야 한다.
    "r5": {"run": "PB10000_r5_2A", "date": "2026-08-22",
           "a": 48.75, "b": 35.39, "hot": 48.75, "mean": 42.07, "ds": 34.44},
    "c2": {"run": "PB10000_c2_10W", "date": "2026-08-26",
           "a": 31.61, "b": 42.41, "hot": 42.41, "mean": 37.01, "ds": None},
}

# 검증된 두 망. 세 번째(EC2)는 아직 안 올렸으므로 자리표시자로 둔다.
NET_HOME = ("집 WiFi", "<LAN_IP>", "<LAN_IP>", True)
NET_HOTSPOT = ("휴대폰 핫스팟", "<LAN_IP>", "<LAN_IP>", True)
NET_EC2 = ("AWS EC2", "현장 망", "<EC2 퍼블릭 IP>", False)


def kbadge(x, y, s, color, size=12.5):
    """한글 폭을 반영한 알약 라벨.

    make_assets.badge 는 폭을 `len(s) * 0.62em` 으로 잡는데 한글은 1em 이라
    글자가 알약 밖으로 삐져나온다. 한글·ASCII 를 나눠 센다.
    """
    w = sum(1.0 if ord(c) > 0x2E80 else 0.58 for c in s) * size + 22
    return (rect(x, y, w, size + 11, fill=color, stroke="none",
                 rx=(size + 11) / 2, sw=0)
            + text(x + w / 2, y + size + 2.5, s, size, "#ffffff", "bold", "middle"))


# ════════════════════════════════════════════════════════════════════════
# 06 — 리플레이에서 실시간으로
# ════════════════════════════════════════════════════════════════════════
def live_switch(d):
    W, H = 1440, 610
    b = ma.head("리플레이에서 실시간으로 — 라이브 전환",
                "라즈베리파이가 직접 Kafka 프로듀서가 된다. "
                "기록과 실시간이 같은 테이블에 공존한다.")

    # ── 3단계 진행 ──────────────────────────────────────────────────
    phases = [
        ("5~7월", "가상 데이터", "파이프라인 구조 검증", MUTED, False),
        ("8월", "실측 CSV 리플레이", "18 run · 176,533 표본", CSV, False),
        ("9월", "실시간 스트리밍", "파이 → Kafka 직접 발행", KAFKA, True),
    ]
    for i, (per, name, sub, col, hot) in enumerate(phases):
        x = 40 + i * 470
        b.append(rect(x, 112, 420, 92, SOFT if not hot else "#eef2ff", col,
                      12, 2.5 if hot else 1.5))
        b.append(text(x + 20, 140, per, 13, col, "bold"))
        b.append(text(x + 20, 166, name, 17, INK, "bold"))
        b.append(text(x + 20, 189, sub, 12.5, MUTED))
        if i < 2:
            b.append(arrow(x + 428, 158, x + 462, 158, MUTED))

    # ── 라이브 경로 ─────────────────────────────────────────────────
    chain = [
        ("센서 6채널", ["INA226  전압·전류", "DS18B20 ×2  접촉", "MLX90614 ×2  IR"], CSV),
        ("sensors_kafka.py", ["1초 주기 · 파이에서", 'source = "live"', "6채널 → 1 메시지"], KAFKA),
        ("Kafka", ["battery-data", "키 cell_A", "5필드 계약 유지"], KAFKA),
        ("consumer_v2.py", ["--live-run LIVE_DEMO", "--batch 1 (즉시 커밋)", "ON CONFLICT 중복 차단"], PG),
        ("PostgreSQL", ["battery_logs", "battery_logs_ext", "runs"], PG),
    ]
    for i, (name, lines, col) in enumerate(chain):
        x = 40 + i * 282
        b.append(rect(x, 240, 232, 132, BG, col, 10, 2))
        b.append(text(x + 16, 268, name, 14.5, col, "bold", "start",
                      MONO if ".py" in name else KR))
        for j, s in enumerate(lines):
            b.append(text(x + 16, 296 + j * 21, s, 11.5, MUTED, "normal", "start", MONO))
        if i < 4:
            b.append(arrow(x + 240, 306, x + 274, 306, col))

    # ── 설계 판단 ───────────────────────────────────────────────────
    b.append(rect(40, 404, 660, 168, SOFT, GOOD, 12, 2))
    b.append(text(62, 434, "설계 판단 — 센서 읽기 코드를 새로 짜지 않았다",
                  15, GOOD, "bold"))
    reuse = [
        ("INA226", "ina_log.py", "CONFIG 0x4527 · CAL 0x0A00"),
        ("MLX90614", "mlx_fast_log.py", "mlx_sane() · 0x7FFF 스턱 리드 차단"),
        ("DS18B20", "thermal_log_bulk.py", "t=85000 → 결측 처리"),
    ]
    for i, (ch, src, note) in enumerate(reuse):
        y = 462 + i * 30
        b.append(text(62, y, ch, 12.5, INK, "bold"))
        b.append(text(158, y, "←  " + src, 12.5, GOOD, "normal", "start", MONO))
        b.append(text(360, y, note, 11.5, MUTED))
    b.append(text(62, 556, "라이브 경로와 기록 데이터가 원리적으로 어긋날 수 없다",
                  12.5, INK))

    # ── DB 증거 ─────────────────────────────────────────────────────
    b.append(rect(740, 404, 660, 168, BG, PG, 12, 2))
    b.append(text(762, 434, "적재 결과 — 한 테이블에 공존", 15, PG, "bold"))
    b.append(text(762, 462, "source", 12, MUTED, "bold"))
    b.append(text(1010, 462, "행", 12, MUTED, "bold", "end"))
    b.append(text(1150, 462, "run", 12, MUTED, "bold", "end"))
    b.append(text(1180, 462, "기간", 12, MUTED, "bold"))
    rows = [
        ("replay", "{:,}".format(d["replay_rows"]), str(d["replay_runs"]),
         "8/20~8/31", CSV),
        ("live", "{:,}".format(d["live_rows"]), str(d["live_runs"]),
         "9/4  %.0f분" % d["live_span_min"], KAFKA),
    ]
    for i, (s, n, r, per, col) in enumerate(rows):
        y = 494 + i * 32
        b.append(text(762, y, s, 13.5, col, "bold", "start", MONO))
        b.append(text(1010, y, n, 13.5, INK, "bold", "end", MONO))
        b.append(text(1150, y, r, 13.5, INK, "bold", "end", MONO))
        b.append(text(1180, y, per, 12, MUTED, "normal", "start", MONO))
    b.append(ma.line(762, 470, 1378, 470, LINE, 1))
    b.append(text(762, 556, "스키마가 같아 SELECT 한 줄로 갈린다  —  WHERE source = 'live'",
                  12.5, INK, "normal", "start", MONO))

    return ma.finish(W, H, b, "라이브 전환", 112)


# ════════════════════════════════════════════════════════════════════════
# 07 — 망 이식성
# ════════════════════════════════════════════════════════════════════════
def portability():
    W, H = 1440, 700
    b = ma.head("망 이식성 — 로컬 · 핫스팟 · 클라우드가 같은 구조",
                "브로커 주소가 바뀔 뿐 코드는 그대로다. EC2 이전도 같은 한 줄이다.")

    for i, (name, pi_ip, broker_ip, done) in enumerate(
            (NET_HOME, NET_HOTSPOT, NET_EC2)):
        x = 40 + i * 470
        col = GOOD if done else MUTED
        b.append(rect(x, 112, 420, 226, SOFT if done else BG, col, 12,
                      2.5 if done else 1.5,
                      dash=None if done else "7 5"))
        b.append(text(x + 22, 146, name, 17, INK, "bold"))
        lab = "검증 완료" if done else "동일 절차"
        b.append(kbadge(x + 420 - 22 - (len(lab) * 12 + 22), 126, lab, col, 12))
        b.append(ma.line(x + 22, 164, x + 398, 164, LINE, 1))

        b.append(text(x + 22, 196, "라즈베리파이", 12.5, MUTED))
        b.append(text(x + 22, 220, pi_ip, 15, INK, "bold", "start", MONO))
        b.append(text(x + 22, 258, "Kafka 브로커", 12.5, MUTED))
        b.append(text(x + 22, 282, broker_ip, 15, KAFKA, "bold", "start", MONO))
        b.append(text(x + 22, 314,
                      "센서 → Kafka → PostgreSQL 전 구간" if done
                      else "같은 compose.yaml 을 그대로 올린다",
                      11.5, MUTED))
        if i < 2:
            b.append(arrow(x + 428, 225, x + 462, 225, MUTED))

    # ── 바뀌는 한 줄 ────────────────────────────────────────────────
    b.append(text(40, 386, "바뀌는 것은 이 한 줄뿐", 16, INK, "bold"))
    code, ch = codebox(40, 404, 1360, [
        ("# compose.yaml — Kafka 가 클라이언트를 되돌려 보낼 주소", "#64748b"),
        ("KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:19092,"
         "PLAINTEXT_HOST://<브로커 IP>:9092", "#e2e8f0"),
        ("", "#e2e8f0"),
        ("#   집 WiFi   <LAN_IP>      핫스팟  <LAN_IP>      "
         "EC2  <퍼블릭 IP>", "#94a3b8"),
    ], size=13.5, lh=21)
    b.append(code)

    # ── 왜 한 줄인가 ────────────────────────────────────────────────
    yy = 404 + ch + 22
    b.append(rect(40, yy, 660, 118, BG, KAFKA, 12, 2))
    b.append(text(62, yy + 30, "왜 이 한 줄이 전부인가", 14.5, KAFKA, "bold"))
    b.append(text(62, yy + 56,
                  "클라이언트는 부트스트랩 응답에 실린 주소로 재접속한다.",
                  12.5, INK))
    b.append(text(62, yy + 78,
                  "localhost 로 광고하면 파이가 받아든 그 이름은 파이 자신을",
                  12.5, MUTED))
    b.append(text(62, yy + 98, "가리켜, 브로커를 찾고도 붙지 못한다.",
                  12.5, MUTED))

    b.append(rect(740, yy, 660, 118, SOFT, GOOD, 12, 2))
    b.append(text(762, yy + 30, "이것이 EC2 이전 가능성의 근거다", 14.5, GOOD, "bold"))
    b.append(text(762, yy + 56,
                  "서로 다른 사설망 두 곳에서 전 구간이 동작했다 —",
                  12.5, INK))
    b.append(text(762, yy + 78,
                  "브로커가 어디 있든 무관하다는 뜻이다. 운영 전환은",
                  12.5, MUTED))
    b.append(text(762, yy + 98,
                  "같은 compose.yaml 에 퍼블릭 IP 를 넣는 것으로 끝난다.",
                  12.5, MUTED))

    return ma.finish(W, H, b, "망 이식성", 112)


# ════════════════════════════════════════════════════════════════════════
# 08 — max(5a, 5b) 규칙
# ════════════════════════════════════════════════════════════════════════
def hotspot_rule(d):
    W, H = 1440, 672
    b = ma.head("temperature 는 평균이 아니라 max(0x5A, 0x5B) 다",
                "어느 IR 이 셀을 보는지가 run 마다 뒤집힌다 — 적재된 값이 그것을 보여준다.")

    for i, key in enumerate(("r5", "c2")):
        r = d[key]
        x = 40 + i * 700
        win_a = r["a"] >= r["b"]
        b.append(rect(x, 112, 660, 250, BG, LINE, 12, 1.5))
        b.append(text(x + 24, 146, r["run"], 16, INK, "bold", "start", MONO))
        b.append(text(x + 24, 170, r["date"] + " · 최고온도 시점", 12.5, MUTED))
        b.append(ma.line(x + 24, 186, x + 636, 186, LINE, 1))

        for j, (lab, val, chosen) in enumerate(
                (("0x5A", r["a"], win_a), ("0x5B", r["b"], not win_a))):
            y = 216 + j * 38
            col = WARN if chosen else MUTED
            b.append(text(x + 24, y, lab, 14, col, "bold", "start", MONO))
            b.append(text(x + 196, y, "%.2f ℃" % val, 18, col, "bold", "end", MONO))
            if chosen:
                b.append(text(x + 222, y, "← 셀을 보고 있다", 12.5, WARN, "bold"))
            else:
                b.append(text(x + 222, y, "겨냥이 빗나가 실온에 가깝다", 12.5, MUTED))

        b.append(rect(x + 24, 292, 300, 48, "#fff7ed", WARN, 8, 1.5))
        b.append(text(x + 40, 322, "max()  →  %.2f ℃" % r["hot"], 16, WARN,
                      "bold", "start", MONO))
        b.append(rect(x + 340, 292, 296, 48, "#fef2f2", BAD, 8, 1.5))
        b.append(text(x + 356, 322, "평균이면  %.2f ℃" % r["mean"], 14.5, BAD,
                      "bold", "start", MONO))
        b.append(text(x + 620, 322, "%.2f" % (r["mean"] - r["hot"]), 14.5, BAD,
                      "bold", "end", MONO))

    # ── 부호가 뒤집힌다 ─────────────────────────────────────────────
    b.append(rect(40, 386, 1360, 96, "#eef2ff", KAFKA, 12, 2))
    b.append(text(62, 418, "채택되는 센서가 run 마다 바뀐다", 16, KAFKA, "bold"))
    b.append(text(62, 446,
                  "r5 는 0x5A 가 13.4℃ 높고, c2 는 0x5B 가 10.8℃ 높다. "
                  "부호가 뒤집히므로 한쪽을 고정으로 쓸 수 없다 —",
                  13, INK))
    b.append(text(62, 468,
                  "개체 편차가 아니라 겨냥 차이이기 때문이다. "
                  "표본마다 더 뜨거운 쪽을 취하는 것이 유일하게 안전한 규칙이다.",
                  13, MUTED))

    # ── 접촉식은 대표가 못 된다 ─────────────────────────────────────
    b.append(rect(40, 502, 660, 130, BG, LINE, 12, 1.5))
    b.append(text(62, 534, "접촉식(DS18B20)을 대표 온도로 쓰면 안 된다",
                  14.5, INK, "bold"))
    b.append(text(62, 566, "같은 시점 · 같은 run (r5 최고온도)", 12, MUTED))
    b.append(text(62, 596, "IR 핫스팟", 13, MUTED))
    b.append(text(230, 596, "%.2f ℃" % d["r5"]["hot"], 16, WARN, "bold", "end", MONO))
    b.append(text(300, 596, "접촉식 DS", 13, MUTED))
    b.append(text(470, 596, "%.2f ℃" % d["r5"]["ds"], 16, MUTED, "bold", "end", MONO))
    b.append(kbadge(500, 580, "차이 %.1f℃" % (d["r5"]["hot"] - d["r5"]["ds"]), BAD))

    # ── 세 겹 필터 ──────────────────────────────────────────────────
    b.append(rect(740, 502, 660, 130, SOFT, GOOD, 12, 2))
    b.append(text(762, 534, "같은 규칙을 세 겹으로 강제한다", 14.5, GOOD, "bold"))
    for i, (where, what) in enumerate((
            ("프로듀서", "mlx_sane() — 0x7FFF 스턱 리드(382.19℃) 차단"),
            ("컨슈머", "−40~150℃ 밖이면 NULL 로 적재"),
            ("PostgreSQL", "CHECK 제약 3개 — 스키마가 마지막 방어선"))):
        y = 562 + i * 24
        b.append(text(762, y, where, 12, GOOD, "bold", "start", MONO))
        b.append(text(872, y, what, 12, MUTED))

    return ma.finish(W, H, b, "핫스팟 규칙", 112)


# ════════════════════════════════════════════════════════════════════════
def load_from_db(host, port):
    """확정값을 DB 에서 다시 뽑는다. 슬라이드 숫자는 항상 실제 적재값이어야 한다."""
    import psycopg2
    conn = psycopg2.connect(host=host, port=port, dbname="battery_ctrl_db",
                            user="battery_admin", password="cellguard_dev")
    cur = conn.cursor()
    d = dict(FALLBACK)

    cur.execute("""
        SELECT source, count(*), count(DISTINCT run_id),
               EXTRACT(epoch FROM max(timestamp) - min(timestamp)) / 60
        FROM battery_logs GROUP BY source;
    """)
    for src, n, runs, span in cur.fetchall():
        if src == "replay":
            d["replay_rows"], d["replay_runs"] = n, runs
        elif src == "live":
            d["live_rows"], d["live_runs"] = n, runs
            d["live_span_min"] = float(span)

    # 각 run 의 최고온도 시점 한 행 — max() 가 무엇을 골랐는지 그대로 보인다
    for key, run_like in (("r5", "PB10000_r5_2A%"), ("c2", "PB10000_c2_10W%")):
        cur.execute("""
            SELECT e.mlx5a_obj_c, e.mlx5b_obj_c, l.temperature,
                   (e.mlx5a_obj_c + e.mlx5b_obj_c) / 2, e.ds_cell_c
            FROM battery_logs l JOIN battery_logs_ext e USING (log_id)
            WHERE l.run_id LIKE %s
            -- 최고온도가 같은 행이 여러 개다(0.02℃ 해상도). timestamp 로 묶어
            -- 고정하지 않으면 실행할 때마다 다른 행이 뽑혀 슬라이드 숫자가 바뀐다.
            ORDER BY l.temperature DESC, l.timestamp ASC LIMIT 1;
        """, (run_like,))
        row = cur.fetchone()
        if row:
            a, bb, hot, mean, ds = row
            d[key] = dict(d[key], a=float(a), b=float(bb), hot=float(hot),
                          mean=float(mean),
                          ds=float(ds) if ds is not None else d[key]["ds"])
    cur.close()
    conn.close()
    return d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-db", action="store_true",
                    help="DB 조회 없이 FALLBACK 상수로 그린다")
    ap.add_argument("--pg-host", default="localhost")
    ap.add_argument("--pg-port", type=int, default=5433)
    args = ap.parse_args()

    d = FALLBACK if args.no_db else load_from_db(args.pg_host, args.pg_port)
    if args.no_db:
        print("--no-db — FALLBACK 상수로 그린다 (2026-09-05 조회값)")
    else:
        print("DB 조회 — replay %s행 / live %s행"
              % ("{:,}".format(d["replay_rows"]), "{:,}".format(d["live_rows"])))

    # make_assets 와 같은 규칙: 기본판(제목 포함) + _ppt판(제목 없음)
    for bare, suffix in ((False, ""), (True, "_ppt")):
        ma.BARE = bare
        print("생성 중 — %s" % ("PPT용(제목 없음)" if bare else "기본"))
        save("06_live_switch%s.svg" % suffix, live_switch(d))
        save("07_portability%s.svg" % suffix, portability())
        save("08_hotspot_rule%s.svg" % suffix, hotspot_rule(d))

    print("\n완료 — PNG 가 필요하면: python svg2png.py")


if __name__ == "__main__":
    main()
