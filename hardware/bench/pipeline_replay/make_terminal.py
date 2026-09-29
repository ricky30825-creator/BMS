#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make_terminal.py — 파이에서 실제로 받은 출력을 터미널 이미지로 만든다.

2026-09-04 에 <USER>@<HOST>(<LAN_IP>) 로 SSH 접속해 실측한 출력이다.
가짜 목업이 아니라 진짜 실행 결과이므로, 창 장식은 흉내내지 않고
호스트 프롬프트만 정직하게 적는다.

슬라이드 18~20 의 캡처 칸이 3.2~3.7인치로 좁아서 원문을 그대로 넣으면
글자가 6pt 까지 내려간다. 핵심 근거(레지스터 값·CRC·교차검증)를 남기고
줄을 40자 안쪽으로 줄였다.

    python make_terminal.py          # SVG 생성
"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))

BG = "#0f172a"
BAR = "#1e293b"
FG = "#e2e8f0"
DIM = "#94a3b8"
GREEN = "#4ade80"
CYAN = "#7dd3fc"
AMBER = "#fbbf24"
MONO = "Consolas, D2Coding, monospace"

# (파일명, 슬롯 폭pt, 슬롯 높이pt, 프롬프트, [(줄, 색)])
PANELS = [
    # 2026-09-04 01:2x, 모드 2 (CH3+CH4) · PB 팩 · BW150 CC 1A 실부하
    ("cap18_ina226", 264, 331, "<USER>@<HOST>:~ $  (SSH)", [
        ("$ python3 ~/ina_check.py 12", CYAN),
        ("", FG),
        ("CONFIG=0x4527  CAL=0x0A00", GREEN),
        ("", FG),
        (" t     Vbus V  Vshunt mV  I_calc A", DIM),
        (" 2.0   5.0250   -9.8900   -0.9890", FG),
        (" 6.0   5.0250   -9.9125   -0.9912", FG),
        ("11.0   5.0250   -9.9150   -0.9915", FG),
        ("", FG),
        ("  Vbus       5.0271 V", FG),
        ("  I_reg     -0.9754 A", FG),
        ("  I_calc    -0.9754 A", FG),
        ("  mismatch  -0.0000 A", AMBER),
        ("  Power      4.9042 W", FG),
        ("", FG),
        ("[OK] 전류 흐름 · CAL/R010 정확", GREEN),
        ("[OK] 방전 = 음수 (규약 일치)", GREEN),
    ]),
    ("cap19_ds18b20", 230, 334, "<USER>@<HOST>:~ $  (SSH)", [
        ("$ cat /sys/bus/w1/devices/\\", CYAN),
        ("    28-0625650a2c2c/w1_slave", CYAN),
        ("d1 01 4b 46 7f ff 0c 10 39 :", FG),
        ("            crc=39 YES", GREEN),
        ("d1 01 4b 46 ... t=29062", FG),
        ("", FG),
        ("$ cat /sys/bus/w1/devices/\\", CYAN),
        ("    28-0625657fe542/w1_slave", CYAN),
        ("d5 01 4b 46 7f ff 0c 10 2c :", FG),
        ("            crc=2c YES", GREEN),
        ("d5 01 4b 46 ... t=29312", FG),
        ("", FG),
        ("셀 29.062 C / 실온 29.312 C", AMBER),
        ("CRC 두 채널 모두 YES", GREEN),
    ]),
    # 2026-09-04, 전원 경로에 아무것도 연결하지 않은 상태에서 실제 코일 전환
    ("cap21_relay_mode1", 264, 266, "<USER>@<HOST>:~ $  (SSH)", [
        ("$ python3 ~/relay_demo.py mode1", CYAN),
        ("lo = ON (active low) / hi = OFF", DIM),
        ("", FG),
        ("init      CH1 hi CH2 hi CH3 hi CH4 hi", FG),
        ("", FG),
        ("mode1_discharge()", GREEN),
        (" relay(CH1,False) -> CH1 hi", FG),
        (" relay(CH4,False) -> CH4 hi", FG),
        (" relay(CH2,True ) -> CH2 lo  방전경로", FG),
        (" relay(CH3,True ) -> CH3 lo  마스터", AMBER),
        ("", FG),
        ("result    CH1 hi CH2 lo CH3 lo CH4 hi", FG),
        ("", FG),
        ("kill()", GREEN),
        (" relay(CH3,False) -> CH3 hi  1콜 차단", AMBER),
    ]),
    ("cap22_relay_mode2", 264, 193, "<USER>@<HOST>:~ $  (SSH)", [
        ("$ python3 ~/relay_demo.py mode2", CYAN),
        ("", FG),
        ("mode2_discharge()", GREEN),
        (" relay(CH1,False) -> CH1 hi", FG),
        (" relay(CH2,False) -> CH2 hi", FG),
        (" relay(CH4,True ) -> CH4 lo  BS 우회", FG),
        (" relay(CH3,True ) -> CH3 lo  마스터", AMBER),
        ("", FG),
        ("result    CH1 hi CH2 hi CH3 lo CH4 lo", FG),
        ("", FG),
        ("kill()  -> CH3 hi   1콜 차단", AMBER),
    ]),
    # 2026-09-04 01:34~01:40. 무장 -> 1A 실부하 -> 팩 수면 -> 자동 종료까지
    # 한 로그에 담겼다. 부하 구간은 BW150 출력을 10초 켠 것.
    ("cap23_cutoff", 264, 210, "<USER>@<HOST>:~ $  (SSH)", [
        ("$ ina_log.py 0.1 out.csv --stop-v 3.0", CYAN),
        (" CONFIG 0x4527 OK   CAL 0x0A00 OK", DIM),
        (" stop-v : 3.000 V", DIM),
        ("", FG),
        ("  [stop-v armed at 4.8150 V]", GREEN),
        ("t+282.9  5.0412V  -0.8490A  -4.28W", FG),
        ("t+287.0  5.0250V  -0.9904A  -4.98W", FG),
        ("t+291.1  5.0250V  -0.9912A  -4.98W", FG),
        ("t+324.2  5.2775V  -0.0004A   0.00W", FG),
        ("", FG),
        (">> 2.1125 V below --stop-v 3.0000", AMBER),
        ("   for 10 samples -- stopping", AMBER),
        ("samples 3259 · i2c skips 0 · 325.8s", GREEN),
    ]),
    # ── 슬라이드 24~27 : 로컬 Docker 스택 (2026-09-04 01:5x 실행) ──────────
    ("cap24_docker", 264, 331, "PS C:\\...\\pipeline_replay>", [
        ("> docker compose up -d", CYAN),
        (" cellguard-kafka     Started", FG),
        (" cellguard-postgres  Started", FG),
        (" cellguard-kafka     Healthy", GREEN),
        (" cellguard-kafka-init Started", FG),
        ("", FG),
        ("> docker compose ps", CYAN),
        ("NAME                STATUS", DIM),
        ("cellguard-kafka     Up (healthy)", GREEN),
        ("cellguard-postgres  Up (healthy)", GREEN),
        ("", FG),
        ("> kafka-topics.sh --list", CYAN),
        ("battery-data", FG),
        ("battery-raw-metrics", FG),
        ("battery-anomaly-alerts", FG),
        ("battery-events", FG),
        ("__consumer_offsets", DIM),
    ]),
    ("cap25_producer", 264, 331, "PS C:\\...\\pipeline_replay>", [
        ("> python replay_producer.py \\", CYAN),
        ("    --broker localhost:9092 --speed 0", CYAN),
        ("", FG),
        ("REPLAY - run 18 · 176,533 행", DIM),
        ("", FG),
        ("PB20000_r1_1A   CC 1A   38497", FG),
        ("PB10000_c2_10W  CP 10W   2024  collapsed", FG),
        ("18650_b3_3A     CC 3A    2176", FG),
        ("   ... (18 run)", DIM),
        ("", FG),
        ("18650_b3_3A_20260831 (2176건)", GREEN),
        (" 2000/2176 t+2031s 3.0700V", FG),
        ("           -2.9682A 37.83℃", FG),
        (" 완료 2176건", FG),
        ("", FG),
        ("총 176533건 전송, 21.5초", AMBER),
        ("= 8,211 건/초", AMBER),
    ]),
    ("cap26_consumer", 264, 331, "PS C:\\...\\pipeline_replay>", [
        ("> python consumer_v2.py \\", CYAN),
        ("    --broker localhost:9092 \\", CYAN),
        ("    --from-beginning --batch 2000", CYAN),
        ("", FG),
        ("runs 테이블: 18개 upsert", GREEN),
        ("구독 시작 - topic=battery-data", FG),
        ("           offset=earliest", DIM),
        ("", FG),
        ("=====================================", DIM),
        (" 적재 149건", AMBER),
        (" 건너뜀 176533건", AMBER),
        ("=====================================", DIM),
        ("  PB5000_c3_10W_20260826    149", FG),
        ("", FG),
        ("ON CONFLICT DO NOTHING 이", GREEN),
        ("이미 있는 176,533건을 전부 걸렀다", GREEN),
    ]),
    ("cap27_psql", 264, 331, "PS C:\\...\\pipeline_replay>", [
        ("> docker exec cellguard-postgres \\", CYAN),
        ("    psql -U battery_admin \\", CYAN),
        ("    -d battery_ctrl_db", CYAN),
        ("", FG),
        (" runs |  logs  |  ext", DIM),
        ("------+--------+--------", DIM),
        ("   18 | 176533 | 176533", FG),
        ("", FG),
        ("  result   | count", DIM),
        (" completed |    14", FG),
        (" collapsed |     3   <- 양성 라벨", AMBER),
        (" aborted   |     1", FG),
        ("", FG),
        (" run_id          | energy_wh", DIM),
        (" PB10000_r2_1A   |    30.816", FG),
        (" PB10000_r5_2A   |    29.822", FG),
        (" PB10000_c6_9W   |    28.266", FG),
        ("기록과 소수점 3자리까지 일치", GREEN),
    ]),
    ("cap20_mlx90614", 247, 317, "<USER>@<HOST>:~ $  (SSH)", [
        ("$ i2cdetect -y -q 1", CYAN),
        ("40: 40 -- -- ... 48 --", FG),
        ("50: -- -- 5a 5b --", FG),
        ("", FG),
        ("$ MLX 직접 읽기 (0x07=TOBJ1)", CYAN),
        ("raw * 0.02 - 273.15 [C]", DIM),
        ("", FG),
        (" t     0x5A          0x5B", DIM),
        (" 0.0  0x3AE9 28.47  0x3AEF 28.59", FG),
        (" 2.0  0x3AF5 28.71  0x3AF1 28.63", FG),
        (" 4.0  0x3AEC 28.53  0x3AE5 28.39", FG),
        ("", FG),
        ("hotspot = max(5a,5b) = 28.53 C", AMBER),
        ("에러비트(0x8000) 전부 클리어", GREEN),
    ]),
]


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build(name, wpt, hpt, prompt, lines, scale=4):
    W, H = wpt * scale, hpt * scale
    rx = 7 * scale / 2.2
    bar_h = H * 0.055                     # 글자 크기와 무관하게 먼저 고정한다
    pad = 9 * scale / 2.2

    # 가장 긴 줄이 폭에 들어가도록 글자 크기를 역산한다.
    longest = max(len(t) for t, _ in lines) or 1
    size = min((W - pad * 2) / (longest * 0.60),
               (H - bar_h - pad * 2) / (len(lines) * 1.42))
    lh = size * 1.42
    block = lh * len(lines)
    top = bar_h + (H - bar_h - block) / 2.0 + size    # 남는 높이를 위아래로 나눈다

    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %g %g" '
           'width="%g" height="%g">' % (W, H, W, H)]
    out.append('<rect width="%g" height="%g" rx="%g" fill="%s"/>' % (W, H, rx, BG))
    # 제목 막대: 위쪽만 둥글게 — 둥근 rect 위에 각진 rect 를 덮어 아래를 평평하게
    out.append('<rect width="%g" height="%g" rx="%g" fill="%s"/>'
               % (W, bar_h, rx, BAR))
    out.append('<rect y="%g" width="%g" height="%g" fill="%s"/>'
               % (bar_h - rx, W, rx, BAR))
    bar_size = bar_h * 0.60
    out.append('<text x="%g" y="%g" font-family="%s" font-size="%g" fill="%s">%s</text>'
               % (pad, bar_h * 0.74, MONO, bar_size, DIM, esc(prompt)))

    y = top
    for t, col in lines:
        if t:
            out.append('<text x="%g" y="%g" font-family="%s" font-size="%g" '
                       'fill="%s" xml:space="preserve">%s</text>'
                       % (pad, y, MONO, size, col, esc(t)))
        y += lh
    out.append('</svg>')
    return "".join(out), size


def main():
    print("생성 —")
    for name, w, h, prompt, lines in PANELS:
        svg, size = build(name, w, h, prompt, lines)
        p = os.path.join(HERE, name + ".svg")
        with io.open(p, "w", encoding="utf-8") as f:
            f.write(svg)
        print("  %-22s %3dx%-3d pt  글자 %.1fpt  %d줄"
              % (name + ".svg", w, h, size / 4.0, len(lines)))


if __name__ == "__main__":
    main()
