#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""live_view.py — PostgreSQL 을 그대로 비추는 읽기 전용 라이브 뷰.

    python live_view.py                      # http://localhost:8080
    python live_view.py --port 8080 --run-id LIVE_DEMO

시연 영상의 마지막 화살표(PostgreSQL → 화면)를 실제로 만들기 위한 화면이다.
**읽기 전용이다** — SELECT 만 하고 아무것도 쓰지 않는다.

대시보드팀의 React 대시보드(`프론트,백엔드/배터리`)와는 별개다. 그쪽은 아직
`backend/src/store/postgres.ts` 가 없어 인메모리 데모 데이터로 돈다. 이 파일은
그 구현을 기다리지 않고 「적재된 값이 화면까지 도달한다」를 보이기 위한 것이며,
계약(CONTRACT.md)의 해석 규칙을 화면에 그대로 드러내는 것을 목적으로 한다:

  - current 는 방전이 음수다 → 부호를 숨기지 않고 그대로 쓴다
  - temperature 는 두 IR 의 **max** 다 → 두 채널을 나란히 보여 근거를 남긴다
  - 접촉식(DS)은 IR 보다 14~18℃ 낮다 → 대표 온도로 쓰지 않고 참고로만 둔다

의존성은 psycopg2 하나뿐이고, 페이지는 외부 CDN 을 전혀 쓰지 않는다
(촬영 중 네트워크가 끊겨도 화면이 깨지지 않아야 한다).
"""
import argparse
import json
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import psycopg2

PG = {
    "host": "localhost", "port": 5433, "dbname": "battery_ctrl_db",
    "user": "battery_admin",
    "password": os.environ.get("PG_PASSWORD", "cellguard_dev"),
}
RUN_ID = "LIVE_DEMO"
WINDOW = 180          # 그래프에 남기는 표본 수 (1초 간격이면 3분)


# ── 질의 ─────────────────────────────────────────────────────────────────
SERIES_SQL = """
SELECT l.timestamp, l.voltage, l.current, l.temperature,
       e.power_w, e.ds_cell_c, e.ds_ambient_c, e.mlx5a_obj_c, e.mlx5b_obj_c
FROM battery_logs l
LEFT JOIN battery_logs_ext e USING (log_id)
WHERE l.run_id = %s
ORDER BY l.timestamp DESC
LIMIT %s;
"""

COUNT_SQL = """
SELECT (SELECT count(*) FROM battery_logs)                       AS total,
       (SELECT count(*) FROM battery_logs WHERE run_id = %s)     AS live,
       (SELECT count(*) FROM runs)                               AS runs;
"""

RUNS_SQL = """
SELECT run_id, battery, mode, setpoint, result,
       loaded_h, energy_wh, sample_count, temp_peak
FROM v_run_summary
ORDER BY (result = 'live') DESC, run_id;
"""


def fetch_state(run_id):
    conn = psycopg2.connect(**PG)
    try:
        cur = conn.cursor()
        cur.execute(SERIES_SQL, (run_id, WINDOW))
        rows = cur.fetchall()[::-1]          # 최신순으로 받아 시간순으로 뒤집는다
        cur.execute(COUNT_SQL, (run_id,))
        total, live, nruns = cur.fetchone()
        cur.execute(RUNS_SQL)
        runs = cur.fetchall()
        cur.close()
    finally:
        conn.close()

    series = [{
        "t": r[0].isoformat(),
        "voltage": _f(r[1]), "current": _f(r[2]), "temperature": _f(r[3]),
        "power": _f(r[4]), "ds_cell": _f(r[5]), "ds_amb": _f(r[6]),
        "ir5a": _f(r[7]), "ir5b": _f(r[8]),
    } for r in rows]

    # 「살아 있는가」 판정은 마지막 표본의 나이로 한다. 화면에 초록/빨강으로
    # 드러나므로 시연 중 파이가 멈추면 즉시 보인다.
    age = None
    if rows:
        last = rows[-1][0]
        now = datetime.now(timezone.utc) if last.tzinfo else datetime.now()
        age = (now - last).total_seconds()

    return {
        "run_id": run_id, "series": series, "age_s": age,
        "counts": {"total": total, "live": live, "runs": nruns},
        "runs": [{
            "run_id": r[0], "battery": r[1], "mode": r[2], "setpoint": r[3],
            "result": r[4], "loaded_h": _f(r[5]), "energy_wh": _f(r[6]),
            "samples": r[7], "temp_peak": _f(r[8]),
        } for r in runs],
    }


def _f(v):
    return None if v is None else float(v)


# ── HTTP ─────────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    run_id = RUN_ID

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/state":
            try:
                body = json.dumps(fetch_state(self.run_id)).encode("utf-8")
            except Exception as exc:                     # DB 가 내려가도 화면은 산다
                body = json.dumps({"error": str(exc)}).encode("utf-8")
                self._send(503, "application/json", body)
                return
            self._send(200, "application/json", body)
        elif path == "/":
            self._send(200, "text/html; charset=utf-8", PAGE.encode("utf-8"))
        else:
            self._send(404, "text/plain; charset=utf-8", b"not found")

    def _send(self, code, ctype, body):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *a):
        pass                                             # 촬영 중 콘솔을 더럽히지 않는다


PAGE = u"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CellGuard 라이브</title>
<style>
  :root{
    --bg:#0e1116; --panel:#161b22; --line:#232a34; --ink:#e6edf3;
    --dim:#8b949e; --accent:#58a6ff; --warm:#f0883e; --hot:#f85149;
    --ok:#3fb950;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
       font-family:"Malgun Gothic","맑은 고딕",system-ui,sans-serif}
  header{padding:18px 26px;border-bottom:1px solid var(--line);
         display:flex;align-items:center;gap:18px;flex-wrap:wrap}
  h1{font-size:20px;margin:0;font-weight:700;letter-spacing:-.2px}
  .flow{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--dim)}
  .flow b{color:var(--ink);font-weight:600}
  .dot{width:9px;height:9px;border-radius:50%;background:var(--dim);
       display:inline-block;margin-right:7px}
  .dot.on{background:var(--ok);box-shadow:0 0 0 4px rgba(63,185,80,.18)}
  .dot.off{background:var(--hot);box-shadow:0 0 0 4px rgba(248,81,73,.18)}
  .status{margin-left:auto;font-size:13px;color:var(--dim)}
  main{padding:22px 26px;display:grid;gap:18px}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px}
  .tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
  .tile .k{font-size:12px;color:var(--dim);letter-spacing:.3px}
  .tile .v{font-size:34px;font-weight:700;margin-top:6px;
           font-variant-numeric:tabular-nums;letter-spacing:-1px}
  .tile .u{font-size:15px;color:var(--dim);font-weight:500;margin-left:4px}
  .tile .s{font-size:12px;color:var(--dim);margin-top:6px}
  .hot .v{color:var(--warm)}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
  .panel h2{font-size:13px;margin:0 0 12px;color:var(--dim);font-weight:600;
            letter-spacing:.4px;text-transform:uppercase}
  canvas{width:100%;height:220px;display:block}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:right;padding:7px 10px;border-bottom:1px solid var(--line);
        font-variant-numeric:tabular-nums}
  th:first-child,td:first-child{text-align:left}
  th{color:var(--dim);font-weight:600;font-size:11px;letter-spacing:.3px}
  tr.live td{color:var(--accent);font-weight:600}
  .tag{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px}
  .tag.completed{background:rgba(63,185,80,.15);color:var(--ok)}
  .tag.collapsed{background:rgba(248,81,73,.15);color:var(--hot)}
  .tag.aborted{background:rgba(139,148,158,.15);color:var(--dim)}
  .tag.live{background:rgba(88,166,255,.15);color:var(--accent)}
  .note{font-size:12px;color:var(--dim);line-height:1.7;margin-top:10px}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  @media(max-width:900px){.two{grid-template-columns:1fr}}
</style></head><body>

<header>
  <h1>CellGuard — 라이브 파이프라인</h1>
  <div class="flow">
    <span id="pill"><span class="dot" id="dot"></span></span>
    <b>라즈베리파이</b> → <b>Kafka</b> → <b>PostgreSQL</b> → <b>이 화면</b>
  </div>
  <div class="status" id="status">연결 중…</div>
</header>

<main>
  <div class="tiles">
    <div class="tile"><div class="k">전압</div>
      <div class="v"><span id="v">—</span><span class="u">V</span></div>
      <div class="s">INA226 · 버스 전압</div></div>
    <div class="tile"><div class="k">전류</div>
      <div class="v"><span id="i">—</span><span class="u">A</span></div>
      <div class="s">방전 = 음수 (계약 §2)</div></div>
    <div class="tile"><div class="k">전력</div>
      <div class="v"><span id="p">—</span><span class="u">W</span></div>
      <div class="s">INA226 · 부호는 전류를 따른다</div></div>
    <div class="tile hot"><div class="k">표면 온도 (IR 핫스팟)</div>
      <div class="v"><span id="t">—</span><span class="u">℃</span></div>
      <div class="s" id="irdetail">max(0x5A, 0x5B)</div></div>
    <div class="tile"><div class="k">DB 누적 표본</div>
      <div class="v" id="total">—</div>
      <div class="s"><span id="live">0</span>건이 이번 라이브 수집</div></div>
  </div>

  <div class="two">
    <div class="panel"><h2>표면 온도 · 최근 3분</h2>
      <canvas id="ct"></canvas>
      <div class="note">주황 = IR 핫스팟 max(0x5A,0x5B) · 회색 = 실온(DS18B20).
        <b>두 선이 벌어지는 폭이 곧 자체 발열이다.</b> 센서 앞에 손을 대면 주황만
        솟고 회색은 그대로다 — 실온이 오른 것과 대상이 뜨거워진 것을 이렇게 가른다.</div></div>
    <div class="panel"><h2>전압 · 최근 3분</h2>
      <canvas id="cv"></canvas>
      <div class="note">전력 경로에 아무것도 안 물려 있으면 노드가 떠서 2.5V 부근을
        가리킨다 — 측정값이 아니라 <b>떠 있는 노드</b>다(CLAUDE.md 2026-08-27).</div></div>
  </div>

  <div class="panel"><h2>적재된 run</h2>
    <table><thead><tr>
      <th>run_id</th><th>배터리</th><th>모드</th><th>설정</th><th>결과</th>
      <th>실방전 h</th><th>Wh</th><th>표본</th><th>최고 ℃</th>
    </tr></thead><tbody id="runs"></tbody></table>
    <div class="note">result = <b>collapsed</b> 가 CP 되먹임 붕괴 —
      이상탐지의 양성 라벨이다. <b>live</b> 는 지금 수집 중인 행이라 요약값이 없다.</div></div>
</main>

<script>
const $ = id => document.getElementById(id);
const fmt = (x, n) => x === null || x === undefined ? "—" : x.toFixed(n);

function draw(cv, sets, pad) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext("2d"); g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);

  const all = sets.flatMap(s => s.data).filter(v => v !== null);
  if (all.length < 2) return;
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < pad) { const m = (hi + lo) / 2; lo = m - pad / 2; hi = m + pad / 2; }
  const span = hi - lo, L = 46, R = 8, T = 10, B = 20;
  const px = i => L + (w - L - R) * (i / Math.max(1, sets[0].data.length - 1));
  const py = v => T + (h - T - B) * (1 - (v - lo) / span);

  g.strokeStyle = "#232a34"; g.fillStyle = "#8b949e";
  g.font = "11px 'Malgun Gothic',sans-serif"; g.textAlign = "right";
  for (let k = 0; k <= 3; k++) {
    const v = lo + span * k / 3, y = py(v);
    g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke();
    g.fillText(v.toFixed(2), L - 6, y + 4);
  }
  for (const s of sets) {
    g.strokeStyle = s.color; g.lineWidth = s.width || 2;
    g.beginPath();
    let started = false;
    s.data.forEach((v, i) => {
      if (v === null) { started = false; return; }
      if (!started) { g.moveTo(px(i), py(v)); started = true; }
      else g.lineTo(px(i), py(v));
    });
    g.stroke();
  }
}

async function tick() {
  let d;
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    d = await r.json();
    if (d.error) throw new Error(d.error);
  } catch (e) {
    $("status").textContent = "DB 연결 실패 — " + e.message;
    $("dot").className = "dot off";
    return;
  }

  const s = d.series, last = s[s.length - 1];
  // 마지막 표본이 5초 넘게 오래되면 파이가 멈춘 것이다. 시연 중 바로 보여야 한다.
  const alive = d.age_s !== null && d.age_s < 5;
  $("dot").className = "dot " + (alive ? "on" : "off");
  // 수집이 끝난 뒤 화면을 열면 나이가 수만 초가 된다. "41716초 전"은 읽히지
  // 않으므로 단위를 올린다.
  const ago = s => s < 90 ? s.toFixed(1) + "초"
    : s < 5400 ? (s / 60).toFixed(0) + "분"
    : s < 172800 ? (s / 3600).toFixed(1) + "시간"
    : (s / 86400).toFixed(1) + "일";
  $("status").textContent = d.age_s === null ? "아직 수신 없음"
    : (alive ? "수신 중 · " + ago(d.age_s) + " 전"
             : "수집 종료 · 마지막 수신 " + ago(d.age_s) + " 전");

  $("total").textContent = d.counts.total.toLocaleString();
  $("live").textContent = d.counts.live.toLocaleString();

  if (last) {
    $("v").textContent = fmt(last.voltage, 4);
    $("i").textContent = fmt(last.current, 4);
    $("p").textContent = fmt(last.power, 3);
    $("t").textContent = fmt(last.temperature, 2);
    $("irdetail").textContent =
      "0x5A " + fmt(last.ir5a, 2) + "℃ · 0x5B " + fmt(last.ir5b, 2)
      + "℃ → max 를 채택";
  }

  draw($("ct"), [
    { data: s.map(x => x.temperature), color: "#f0883e" },
    // 회색은 실온이다. 접촉식 셀 프로브(ds_cell)는 이 구성에서 안 쓴다 --
    // sensors_kafka.py 의 CELL_ID 주석 참조.
    { data: s.map(x => x.ds_amb), color: "#6e7681", width: 1.5 },
  ], 1.0);
  draw($("cv"), [{ data: s.map(x => x.voltage), color: "#58a6ff" }], 0.1);

  $("runs").innerHTML = d.runs.map(r => `<tr class="${r.result === 'live' ? 'live' : ''}">
    <td>${r.run_id}</td><td>${r.battery}</td><td>${r.mode}</td><td>${r.setpoint}</td>
    <td><span class="tag ${r.result}">${r.result}</span></td>
    <td>${fmt(r.loaded_h, 3)}</td><td>${fmt(r.energy_wh, 3)}</td>
    <td>${(r.samples || 0).toLocaleString()}</td><td>${fmt(r.temp_peak, 2)}</td></tr>`).join("");
}

tick();
setInterval(tick, 1000);
window.addEventListener("resize", tick);
</script>
</body></html>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--run-id", default=RUN_ID)
    ap.add_argument("--pg-host", default=PG["host"])
    ap.add_argument("--pg-port", type=int, default=PG["port"])
    args = ap.parse_args()

    PG["host"], PG["port"] = args.pg_host, args.pg_port
    Handler.run_id = args.run_id

    # 시작 전에 한 번 물어본다 — 촬영 도중 빈 화면을 보는 것보다 낫다.
    st = fetch_state(args.run_id)
    bar = "=" * 66
    print(bar)
    print(" CellGuard 라이브 뷰 (읽기 전용)")
    print(bar)
    print(" 주소     : http://localhost:%d" % args.port)
    print(" DB       : %s:%d/%s" % (PG["host"], PG["port"], PG["dbname"]))
    print(" run_id   : %s" % args.run_id)
    print(" 적재 현황: runs %d · 표본 %s건 (이 run %s건)"
          % (st["counts"]["runs"], format(st["counts"]["total"], ","),
             format(st["counts"]["live"], ",")))
    print(" 중지     : Ctrl+C")
    print(bar)

    ThreadingHTTPServer(("0.0.0.0", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
