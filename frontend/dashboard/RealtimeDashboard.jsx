// 셀가드 실시간 관제 대시보드 — 핵심 화면
// WebSocket으로 V/I/T/SOC·이상점수를 구독해 4등급으로 색상 관제한다.
import { useEffect, useState } from "react";

const WS_BASE = import.meta.env.VITE_WS_BASE ?? "wss://api.cellguard.io";

// 이상점수(0~1) → 상태 등급 (경계값은 하위 등급: 0.8 → 경고)
const GRADES = [
  { max: 0.3, label: "정상", color: "#16A34A", bg: "#E9F8EE" },
  { max: 0.6, label: "주의", color: "#D97706", bg: "#FEF6E7" },
  { max: 0.8, label: "경고", color: "#EA580C", bg: "#FFF1E6" },
  { max: 1.0, label: "위험", color: "#DC2626", bg: "#FEECEC" },
];
const gradeOf = (s) => GRADES.find((g) => s <= g.max) ?? GRADES[GRADES.length - 1];

const METRICS = [
  { key: "voltage_v", label: "전압", unit: "V" },
  { key: "current_a", label: "전류", unit: "A" },
  { key: "temp_contact", label: "온도", unit: "℃" },
  { key: "soc_pct", label: "SOC", unit: "%" },
];

export default function RealtimeDashboard({ batteryId }) {
  const [metrics, setMetrics] = useState(null);
  const [score, setScore] = useState(0);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws, retry;
    const connect = () => {
      ws = new WebSocket(`${WS_BASE}/ws/telemetry?batteryId=${batteryId}`);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => { setConnected(false); retry = setTimeout(connect, 2000); }; // 자동 재연결
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data); // { metrics, anomaly_score }
          setMetrics(msg.metrics);
          setScore(msg.anomaly_score);
        } catch { /* 손상 프레임 무시 */ }
      };
    };
    connect();
    return () => { clearTimeout(retry); ws.close(); };
  }, [batteryId]);

  const grade = gradeOf(score);
  const ARC = 282.74; // 반원 게이지 둘레
  const dash = `${(score * ARC).toFixed(1)} ${ARC}`;

  return (
    <div className="dashboard">
      <header className="dash-head">
        <h1>{batteryId} 실시간 관제</h1>
        <span className={connected ? "live on" : "live off"}>
          {connected ? "● LIVE" : "○ 재연결 중"}
        </span>
      </header>

      {/* 이상점수 반원 게이지 */}
      <section className="gauge-card" style={{ background: grade.bg }}>
        <svg viewBox="0 0 200 110" className="gauge"
             role="img" aria-label={`이상점수 ${Math.round(score * 100)}, ${grade.label}`}>
          <path d="M10 100 A90 90 0 0 1 190 100" fill="none"
                stroke="#EDE9E1" strokeWidth="16" strokeLinecap="round" />
          <path d="M10 100 A90 90 0 0 1 190 100" fill="none"
                stroke={grade.color} strokeWidth="16" strokeLinecap="butt"
                strokeDasharray={dash} />
        </svg>
        <div className="gauge-val" style={{ color: grade.color }}>
          <strong>{Math.round(score * 100)}</strong>
          <span className="grade">{grade.label}</span>
        </div>
      </section>

      {/* 실시간 V/I/T/SOC 카드 */}
      <section className="metric-grid">
        {METRICS.map((m) => (
          <div key={m.key} className="metric-card">
            <span className="m-label">{m.label}</span>
            <span className="m-value">
              {metrics ? metrics[m.key] : "--"}<em>{m.unit}</em>
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
