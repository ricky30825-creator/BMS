import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, ArrowDown, ArrowUp, BarChart3, BatteryCharging, Check, Clock, Download, FileText, LockKeyhole, Pause, Play, RefreshCw, ShieldAlert, ShieldCheck, Thermometer, TrendingUp, WifiOff, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { buildCapacityDiagnosisBody, buildQuickDiagnosisBody, type SocHintLevel } from "../api/diagnosis";
import { abortReasonLabel, capabilityLock, gradeLabel, progressPct, statusLabel } from "../api/diagnosisLabels";
import { dashboardMetricKey, dashboardMetricParam, normalizeBattery, type DashboardMetricKey, type DashboardMetricParam } from "../api/normalize";
import { useAckAlert, useAckAll, useActiveDiagnosis, useAnomalySummary, useBattery, useBatteries, useCreateBattery, useDashboard, useDiagnosisDetail, useDiagnosisHistory, useDiagnosisStart, useDiagnosisStop, useEvidence, useEvents, useNotices, useRelay, useRelayHistory, useRelayMutation, useStartSession, useTrends, useUpdateBattery, useAlertSummary, useAlerts } from "../api/hooks";
import { useRealtime, type RealtimeState } from "../realtime/useRealtime";
import type { Alert, AlertChannels, Battery, BatteryEvent, Dashboard, Grade, MeResponse, NoticeCategory, Relay, TrendResponse, VoiceAlertSettings } from "../types";
import { Button, Card, EmptyState, Field, MetricStatusBadge, Modal, PageHeading, Pagination, StatusBadge, TableState, Tabs, formatDateTime, formatTime, relativeTime, score100 } from "../components/ui";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar, CartesianGrid, Cell } from "recharts";

function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "잠시 후 다시 시도하세요.";
  const messages: Record<string, string> = { NO_ACTIVE_SESSION: "활성 측정 세션이 없습니다. 배터리를 연결하세요.", BATTERY_BLOCKED: "운영 상태가 BLOCKED인 배터리는 연결할 수 없습니다.", DEVICE_OFFLINE: "진단기가 오프라인입니다.", REAUTH_REQUIRED: "비밀번호 재인증에 실패했습니다.", REASON_REQUIRED: "사유를 입력하세요.", INTERLOCK_LOCKED: "Fail-Safe 인터락이 유지 중이라 복구할 수 없습니다.", SAFETY_PROFILE_NOT_READY: "안전 프로필이 준비되지 않아 실행할 수 없습니다.", MODE_NOT_SUPPORTED: "모드 2 보조배터리에서만 사용할 수 있습니다.", VERSION_CONFLICT: "다른 관리자가 먼저 변경했습니다. 다시 불러오세요.", RUNTIME_NOT_READY: "현재 서버 런타임이 준비되지 않았습니다.", ACK_REQUIRED: "안전 안내를 확인해야 합니다.", FULL_CHARGE_REQUIRED: "완충 확인 후 정밀 진단을 시작할 수 있습니다.", CAPACITY_REQUIRED: "정격 용량이 등록된 자산만 정밀 진단을 실행할 수 있습니다.", CAPACITY_NOT_REGISTERED: "정격 용량이 등록되지 않아 정밀 진단을 실행할 수 없습니다. 자산 정보에 용량을 입력하세요.", RELAY_CUT: "릴레이가 차단되어 있어 진단을 시작할 수 없습니다. 릴레이를 복구한 뒤 다시 시도하세요.", VALIDATION_FAILED: "입력값을 확인하세요." };
  return messages[error.code] ?? "요청을 처리하지 못했습니다.";
}

function metricValue(value: number | null | undefined, digits = 1): string { return value == null ? "—" : value.toFixed(digits); }
function direction(value: number | null | undefined): string { return value == null || value === 0 ? "대기" : value > 0 ? "충전" : "방전"; }
// 전류는 부호로 충·방전을 구분해 내려오지만, 사용자에게는 크기만 보이고 방향은
// direction() 라벨로 낸다. 부호를 살려야 하는 온도 등에는 쓰지 않는다.
function magnitude(value: number | null | undefined): number | null { return value == null ? null : Math.abs(value); }

function measuringDurationLabel(startedAt: string | null | undefined): string {
  const started = startedAt ? new Date(startedAt).getTime() : NaN;
  if (Number.isNaN(started)) return "";
  const totalSeconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}분 ${String(seconds).padStart(2, "0")}초째 측정 중`;
}

// data 갱신과 무관하게 매초 스스로 다시 그려야 화면이 멈추지 않고 실제로 올라간다 —
// 부모(DashboardPage)는 realtime 스냅샷이 도착할 때만 리렌더되므로, 이 값을 부모 렌더에
// 맡기면 다음 스냅샷이 올 때까지 초가 멈춰 보인다.
function MeasuringElapsed({ startedAt }: { startedAt: string | null | undefined }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="stream-status measuring-elapsed"><Clock size={13} />{measuringDurationLabel(startedAt)}</span>;
}

// 센서가 아직 이 연결에서 값을 보내오지 않았으면 "연결 중", 이 연결이 시작된
// 뒤로 값이 도착했으면 "측정 중" — latest 값은 이전 세션의 잔여값일 수 있어
// 세션 시작 시각과 비교해야 한다.
function isMeasuringNow(battery: Battery, activeStartedAt: string | null | undefined): boolean {
  if (!battery.isConnected || !activeStartedAt) return false;
  const measuredAt = battery.latest?.measuredAt;
  return Boolean(measuredAt && measuredAt >= activeStartedAt);
}

export function DashboardPage({ realtime, me }: { realtime: { state: RealtimeState; dashboard: Dashboard | null; lastAt: string | null; refetchMetric: (metric: DashboardMetricParam) => Promise<void> }; me: MeResponse }) {
  const [metric, setMetric] = useState<DashboardMetricKey>("representativeTempC");
  const query = useDashboard(Boolean(me.activeSession), dashboardMetricParam(metric));
  const data = realtime.dashboard ?? query.data;
  const selectMetric = (key: DashboardMetricKey) => { setMetric(key); void realtime.refetchMetric(dashboardMetricParam(key)); };
  if (!me.activeSession) return <GateCard />;
  if (!data && (query.isPending || realtime.state === "loading" || realtime.state === "connecting")) return <TableState state="loading" message="대시보드 스냅샷을 불러오는 중입니다." />;
  if (!data) return <Card><EmptyState title="대시보드 데이터를 사용할 수 없습니다." description="서버가 필수 측정 필드를 반환하지 않았거나 일시적으로 응답하지 않았습니다." action={<Button variant="secondary" onClick={() => void query.refetch()}>다시 시도</Button>} /></Card>;
  const hasSensorMeasurement = [data.metrics.voltageV.value, data.metrics.currentA.value, data.metrics.representativeTempC.value, data.metrics.socPct.value].some((value) => value != null);
  const hasAnomalyMeasurement = data.anomaly.score !== null && data.anomaly.grade !== null;
  if (!hasSensorMeasurement && !hasAnomalyMeasurement) return <div className="page-stack"><PageHeading eyebrow="LIVE MONITORING" title="실시간 관제" description={`${data.battery.label} · battery_id ${data.battery.id} · 세션 진행 중`} actions={<span className={`stream-status stream-${realtime.state}`}><span className="status-dot" />{realtime.state === "live" ? "실시간 수신 중" : realtime.state === "reconnecting" ? "재연결 중" : "연결 대기"}</span>} /><Card className="gate-card"><EmptyState title="아직 측정 데이터가 없습니다." description="세션은 연결됐지만 서버에서 첫 센서 스냅샷을 기다리고 있습니다. 데이터가 도착하면 이상점수와 V · I · T · SOC 카드가 표시됩니다." /></Card></div>;
  if (!hasAnomalyMeasurement) return <div className="page-stack"><PageHeading eyebrow="LIVE MONITORING" title="실시간 관제" description={`${data.battery.label} · battery_id ${data.battery.id} · 세션 진행 중`} /><Card className="gate-card"><EmptyState title="이상점수를 사용할 수 없습니다." description="센서 측정은 도착했지만 서버의 이상점수와 등급이 아직 산출되지 않았습니다." action={<Button variant="secondary" onClick={() => void query.refetch()}>다시 시도</Button>} /></Card></div>;
  const grade = data.anomaly.grade;
  const anomalyScore = data.anomaly.score;
  if (grade === null || anomalyScore === null) return null;
  const metrics = [{ key: "voltageV" as const, label: "전압", short: "V", unit: "V", value: data.metrics.voltageV.value, status: data.metrics.voltageV.status, tone: "volt", color: "#16a34a" }, { key: "currentA" as const, label: "전류", short: "A", unit: "A", value: data.metrics.currentA.value, status: data.metrics.currentA.status, tone: "curr", color: "#0ea5e9" }, { key: "representativeTempC" as const, label: "온도 (°C)", short: "온도", unit: "°C", value: data.metrics.representativeTempC.value, status: data.metrics.representativeTempC.status, tone: "temp", color: "#ea580c" }, { key: "socPct" as const, label: data.metrics.socBasis === "RELATIVE_SESSION_START" ? "상대 SOC" : "SOC", short: "SOC", unit: "%", value: data.metrics.socPct.value, status: data.metrics.socPct.status, tone: "soc", color: "#7c3aed" }];
  const trend = data.quickTrend?.points.map((point) => ({ at: formatTime(point.at), value: point.value })) ?? [];
  return <div className="page-stack dashboard-page"><Card className={`dashboard-hero ${grade.toLowerCase()}`}><div className="dashboard-hero-copy"><div className="dashboard-context"><span className="dashboard-battery-icon"><BatteryCharging size={18} /></span><div><strong>{data.battery.label}</strong><small>{data.battery.model ?? "모델 미입력"} · {data.battery.targetMode === 2 ? "모드 2 · 보조배터리" : "모드 1 · 외부 셀"}</small><small className="mono">battery_id {data.battery.id}</small></div><MeasuringElapsed startedAt={data.session.startedAt} /><Link className="dashboard-change" to="/battery">배터리 변경</Link></div><div><h1>{grade === "DANGER" ? "위험 상태" : grade === "WARNING" ? "경고 상태" : grade === "CAUTION" ? "주의 · 이상점수 상승" : "정상적으로 가동 중"}</h1><p>이상점수 {score100(anomalyScore)} · {data.relay.state === "OPEN" ? "릴레이가 차단된 상태입니다." : "현재 회로가 연결되어 있습니다."}</p></div><div className="dashboard-hero-actions"><Link className="button button-danger" to="/relay">릴레이 차단</Link><span className={`stream-status stream-${realtime.state}`}><span className="status-dot" />{realtime.state === "live" ? "실시간 수신 중" : realtime.state === "reconnecting" ? "재연결 중" : "연결 대기"}</span></div></div><div className="dashboard-score"><div className="dashboard-score-head"><span>현재 이상점수</span><Link to="/anomaly">이상 탐지 →</Link></div><div className="score-gauge"><svg viewBox="0 0 220 124" role="img" aria-label={`이상점수 ${score100(anomalyScore)} ${grade}`}><path d="M18 108 A92 92 0 0 1 202 108" fill="none" stroke="var(--border)" strokeWidth="16" strokeLinecap="round" /><path d="M18 108 A92 92 0 0 1 202 108" fill="none" className={`stroke-${grade.toLowerCase()}`} strokeWidth="16" strokeLinecap="round" pathLength="100" strokeDasharray={`${Math.max(0, Math.min(100, anomalyScore * 100))} 100`} /></svg><div className="score-gauge-value"><strong className="mono">{score100(anomalyScore)}</strong><StatusBadge grade={grade} compact /></div></div><div className="grade-legend">{(["NORMAL", "CAUTION", "WARNING", "DANGER"] as Grade[]).map((item) => <span key={item}><i className={`grade-shape ${item === "NORMAL" ? "circle" : item === "CAUTION" ? "diamond" : item === "WARNING" ? "triangle" : "square"}`} />{item === "NORMAL" ? "정상 0–29" : item === "CAUTION" ? "주의 30–59" : item === "WARNING" ? "경고 60–79" : "위험 80+"}</span>)}</div></div></Card><div className="quick-trend-section"><div className="section-heading-inline"><div><h2>빠른 추세</h2><p>최신 측정값을 한눈에 확인합니다.</p></div><Link className="text-button" to="/trend">전체 추세 보기 →</Link></div><div className="quick-metric-grid">{metrics.map((item) => <button className={`dashboard-metric-card ${item.tone} ${metric === item.key ? "active" : ""}`} key={item.key} aria-pressed={metric === item.key} onClick={() => selectMetric(item.key)}><span className="metric-tone-head"><small>{item.label}</small><MetricStatusBadge status={item.status} /></span><strong className="mono">{metricValue(item.key === "currentA" ? magnitude(item.value) : item.value)}<em>{item.unit}</em></strong>{item.key === "currentA" && <span className="metric-direction">{direction(item.value)}</span>}<MiniMetricLine color={item.color} points={dashboardMetricKey(data.quickTrend?.metric) === item.key ? data.quickTrend?.points : undefined} /></button>)}</div></div><Card className="dashboard-trend-card"><div className="card-title-row"><h2>V · I · T · SOC 추세</h2><span className="mono">{formatDateTime(data.metrics.measuredAt, true)}</span></div><div className="metric-selector segmented">{metrics.map((item) => <button key={item.key} className={metric === item.key ? "active" : ""} onClick={() => selectMetric(item.key)}>{item.label}</button>)}</div>{trend.length ? <ResponsiveContainer width="100%" height={190}><LineChart data={trend}><CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" /><XAxis dataKey="at" tick={false} axisLine={false} /><YAxis hide domain={["auto", "auto"]} /><Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }} /><Line type="monotone" dataKey="value" stroke={metrics.find((item) => item.key === metric)?.color ?? "var(--primary)"} strokeWidth={2.5} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer> : <TableState state="empty" message="추세 데이터가 없습니다." />}</Card></div>;
}

function MiniMetricLine({ color, points }: { color: string; points?: Array<{ at: string; value: number | null }> }) {
  // 결측 구간은 0으로 보정하지 않고 건너뛴다. 남은 표본이 2개 미만이면 추세가 아니므로 그리지 않는다.
  const values = (points ?? []).map((point) => point.value).filter((value): value is number => value != null);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const plotted = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 120;
      const y = span === 0 ? 20 : 36 - ((value - min) / span) * 32;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return <svg className="metric-mini-line" viewBox="0 0 120 40" preserveAspectRatio="none" aria-hidden="true"><polyline points={plotted} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" /></svg>;
}

export function GateCard() { return <Card className="gate-card"><div className="gate-icon"><LockKeyhole size={24} /></div><h2>먼저 측정할 배터리를 선택하세요.</h2><p>배터리를 연결해야 대시보드·측정 세션·이상 탐지에 접근할 수 있습니다.</p><Link className="button button-primary" to="/battery">배터리 관리로 이동</Link></Card>; }

const batterySchema = z.object({ label: z.string().min(1, "배터리 이름을 입력하세요."), chemistry: z.enum(["LI_ION", "LI_PO"]), targetMode: z.enum(["1", "2"]), maker: z.string().optional(), model: z.string().optional(), seriesCount: z.string().optional(), capacityWh: z.string().optional(), ratedOutputCurrentA: z.string().optional(), memo: z.string().optional() }).superRefine((values, context) => {
  if (values.targetMode !== "2") return;
  if (!values.capacityWh || Number(values.capacityWh) <= 0) context.addIssue({ code: "custom", path: ["capacityWh"], message: "모드 2는 정격 용량(Wh)이 필요합니다." });
  if (!values.ratedOutputCurrentA || Number(values.ratedOutputCurrentA) <= 0) context.addIssue({ code: "custom", path: ["ratedOutputCurrentA"], message: "모드 2는 정격 출력 전류(A)가 필요합니다." });
});
type BatteryFormValues = z.infer<typeof batterySchema>;

function BatteryForm({ initial, onClose }: { initial?: Battery; onClose: () => void }) {
  const create = useCreateBattery(); const update = useUpdateBattery(initial?.id ?? "");
  const form = useForm<BatteryFormValues>({ resolver: zodResolver(batterySchema), defaultValues: { label: initial?.label ?? "", chemistry: initial?.chemistry ?? "LI_ION", targetMode: initial?.targetMode === 2 ? "2" : "1", maker: initial?.maker ?? "", model: initial?.model ?? "", seriesCount: initial?.seriesCount == null ? "" : String(initial.seriesCount), capacityWh: initial?.capacityWh == null ? "" : String(initial.capacityWh), ratedOutputCurrentA: initial?.ratedOutputCurrentA == null ? "" : String(initial.ratedOutputCurrentA), memo: initial?.memo ?? "" } });
  const mode = form.watch("targetMode");
  const submit = form.handleSubmit(async (values) => { const targetMode = Number(values.targetMode) as 1 | 2; const payload = { ...values, targetMode, seriesCount: targetMode === 1 && values.seriesCount ? Number(values.seriesCount) : null, capacityWh: targetMode === 2 && values.capacityWh ? Number(values.capacityWh) : null, ratedOutputCurrentA: targetMode === 2 && values.ratedOutputCurrentA ? Number(values.ratedOutputCurrentA) : null }; if (initial) await update.mutateAsync(payload); else await create.mutateAsync(payload); onClose(); });
  const mutation = initial ? update : create;
  return <Modal title={initial ? "배터리 정보 수정" : "새 배터리 등록"} description="측정 모드는 등록 후 변경할 수 없습니다." onClose={onClose}><form onSubmit={submit} className="form-stack"><Field label="배터리 이름" error={form.formState.errors.label?.message}><input {...form.register("label")} placeholder="PACK-006" /></Field><div className="two-column"><Field label="배터리 종류"><select {...form.register("chemistry")}><option value="LI_ION">리튬이온 (LI_ION)</option><option value="LI_PO">리튬폴리머 (LI_PO)</option></select></Field><Field label="측정 모드"><select {...form.register("targetMode")} disabled={Boolean(initial)}><option value="1">모드 1 · 외부 셀</option><option value="2">모드 2 · 보조배터리</option></select></Field></div><div className="two-column"><Field label="제조사"><input {...form.register("maker")} placeholder="선택 입력" /></Field><Field label="모델"><input {...form.register("model")} placeholder="선택 입력" /></Field></div>{mode === "1" ? <Field label="직렬 셀 수" hint="외부 셀 측정에서만 사용합니다."><input {...form.register("seriesCount")} type="number" min="1" placeholder="3" /></Field> : <div className="two-column"><Field label="정격 용량 (Wh)" error={form.formState.errors.capacityWh?.message}><input {...form.register("capacityWh")} type="number" min="0.01" step="0.01" placeholder="37" /></Field><Field label="정격 출력 전류 (A)" error={form.formState.errors.ratedOutputCurrentA?.message}><input {...form.register("ratedOutputCurrentA")} type="number" min="0.01" step="0.01" placeholder="2" /></Field></div>}<Field label="메모"><textarea {...form.register("memo")} rows={3} placeholder="측정 대상 특이사항…" /></Field>{mutation.error && <p className="form-error">{errorMessage(mutation.error)}</p>}<div className="modal-actions"><Button variant="secondary" onClick={onClose}>취소</Button><Button type="submit" variant="primary" loading={mutation.isPending}>{initial ? "변경 저장" : "등록하기"}</Button></div></form></Modal>;
}

export function BatteryPage({ me }: { me: MeResponse }) {
  const activeStartedAt = me.activeSession?.startedAt ?? null;
  const list = useBatteries();
  const start = useStartSession();
  const navigate = useNavigate();
  const [mode, setMode] = useState("all");
  const [sort, setSort] = useState("recent");
  const [modal, setModal] = useState<"create" | "edit" | null>(null);
  const [selected, setSelected] = useState<Battery | undefined>();
  const [connect, setConnect] = useState<Battery | null>(null);
  const [message, setMessage] = useState("");
  const batteries = useMemo(() => {
    const items = list.data?.items.filter((battery) => mode === "all" || String(battery.targetMode) === mode) ?? [];
    return [...items].sort((a, b) => sort === "score" ? (b.latest?.score ?? -1) - (a.latest?.score ?? -1) : sort === "soc" ? (a.latest?.socPct ?? 101) - (b.latest?.socPct ?? 101) : String(b.latest?.measuredAt).localeCompare(String(a.latest?.measuredAt)));
  }, [list.data, mode, sort]);
  const doConnect = async () => { if (!connect) return; try { await start.mutateAsync(connect.id); setConnect(null); navigate("/dashboard"); } catch (error) { setMessage(errorMessage(error)); } };
  const openCreate = () => { setSelected(undefined); setModal("create"); };
  return <div className="page-stack battery-page"><PageHeading eyebrow="ASSET MANAGEMENT" title="배터리 관리" description="저장된 배터리 선택 · 새 배터리 등록" actions={<Button variant="primary" onClick={openCreate}>+ 새 배터리 등록</Button>} />
    {list.error ? <Card><TableState state="error" message="배터리 데이터를 불러오지 못했습니다." /></Card> : !list.isPending && !list.data?.items.length ? <Card><EmptyState title="등록된 배터리가 없습니다." description="첫 배터리를 등록하면 측정을 시작할 수 있습니다." action={<Button variant="primary" onClick={openCreate}>배터리 등록</Button>} /></Card> : <>
      <div className="battery-register-card" role="button" tabIndex={0} onClick={openCreate} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openCreate(); } }}><span className="register-icon">+</span><span><strong>새 배터리 등록</strong><small>이름·종류·측정 모드·직렬 셀 수 입력 → battery_id 발급</small></span></div>
      <div className="battery-list-heading"><strong>저장된 배터리 <span>{list.data?.items.length ?? 0}</span></strong><div className="toolbar"><div className="segmented"><button className={mode === "all" ? "active" : ""} onClick={() => setMode("all")}>전체</button><button className={mode === "1" ? "active" : ""} onClick={() => setMode("1")}>모드 1</button><button className={mode === "2" ? "active" : ""} onClick={() => setMode("2")}>모드 2</button></div><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="배터리 정렬"><option value="recent">최근 측정순</option><option value="score">이상점수 높은순</option><option value="soc">SOC 낮은순</option></select></div></div>
      <div className="battery-grid">{list.isPending ? <TableState state="loading" /> : batteries.map((battery) => { const measuring = isMeasuringNow(battery, activeStartedAt); return <Card className={`battery-card ${battery.isConnected ? "connected" : ""}`} key={battery.id}><div className="battery-card-head"><div className="battery-icon"><BatteryCharging size={22} /></div><div><h2>{battery.label}</h2><p>{battery.maker ? `${battery.maker} · ` : ""}{battery.model || (battery.targetMode === 1 ? "리튬이온" : "보조배터리")} · {battery.targetMode === 1 ? "모드 1" : "모드 2"}</p></div>{battery.isConnected ? <span className={`connect-phase ${measuring ? "measuring" : "connecting"}`}><span className="status-dot" />{measuring ? "측정 중" : "연결 중"}</span> : battery.latest?.grade != null && battery.latest?.score != null ? <StatusBadge grade={battery.latest.grade} score={battery.latest.score} /> : <span className="plain-status">측정 없음</span>}</div><div className="battery-values"><span><small>{battery.targetMode === 2 ? "상대 SOC" : "SOC"}</small><strong className="mono">{metricValue(battery.latest?.socPct, 0)}{battery.latest?.socPct == null ? "" : " %"}</strong></span><span><small>최근 측정</small><strong>{battery.latest?.measuredAt ? relativeTime(battery.latest.measuredAt) : "측정 없음"}</strong></span><span><small>이상점수</small><strong className={`mono ${battery.latest?.grade?.toLowerCase() ?? ""}`}>{score100(battery.latest?.score)}</strong></span></div><div className="battery-card-foot"><span className="battery-mode-chip">{battery.targetMode === 2 ? "모드 2 · 보조배터리" : "모드 1 · 외부 셀"}</span><div><Button variant="ghost" onClick={() => { setSelected(battery); setModal("edit"); }}>수정</Button><Button variant="primary" onClick={() => setConnect(battery)} disabled={battery.opsStatus === "BLOCKED"}>{battery.opsStatus === "BLOCKED" ? "연결 잠김" : battery.isConnected ? (measuring ? "측정 중" : "연결 중") : "연결하고 측정"}</Button></div></div></Card>; })}</div>
    </>}{message && <div className="toast" role="alert">{message}</div>}{modal && <BatteryForm initial={modal === "edit" ? selected : undefined} onClose={() => setModal(null)} />}{connect && <Modal title={`${connect.label}을(를) 측정할까요?`} description="연결하면 기존 측정 세션은 서버에서 자동 종료됩니다." onClose={() => setConnect(null)}><div className="confirm-panel"><div className="confirm-icon"><BatteryCharging size={22} /></div><p>한 번에 하나의 배터리만 연결됩니다. 기존 연결은 해제되고 이 배터리로 새 세션이 시작됩니다.</p></div>{start.error && <p className="form-error">{errorMessage(start.error)}</p>}<div className="modal-actions"><Button variant="secondary" onClick={() => setConnect(null)}>취소</Button><Button variant="primary" loading={start.isPending} onClick={() => void doConnect()}>연결하고 측정</Button></div></Modal>}</div>;
}

export function BatteryDetailPage({ id }: { id: string }) {
  const battery = useBattery(id); const [period, setPeriod] = useState<"24h" | "7d" | "30d">("30d");
  const sessions = useQuery({ queryKey: ["battery-sessions", id], queryFn: () => api.get<{ items: Array<{ id: string; label: string; startedAt: string; endedAt: string | null; peakScore: number | null; peakGrade: Grade | null; status: string }>; page: { number: number; size: number; total: number; totalPages: number } }>(`/api/batteries/${id}/sessions`), enabled: Boolean(id) });
  const trend = useTrends(new URLSearchParams({ period, batteryIds: id }), Boolean(id));
  const data = battery.data;
  if (battery.isPending) return <TableState state="loading" />;
  if (!data) return <Card><TableState state="error" message={errorMessage(battery.error)} /></Card>;
  return <div className="page-stack"><PageHeading eyebrow="BATTERY DETAIL" title={data.label} description={`battery_id · ${data.id}`} actions={<Link className="button button-secondary" to="/battery">배터리 자산으로</Link>} /><div className="detail-summary"><Card><div className="card-title-row"><h2>현재 상태</h2>{data.latest?.grade != null && data.latest?.score != null ? <StatusBadge grade={data.latest.grade} score={data.latest.score} /> : <span className="plain-status">측정 없음</span>}</div><div className="detail-metric-grid"><div><small>전압</small><strong className="mono">{metricValue(data.latest?.voltageV)} V</strong></div><div><small>전류</small><strong className="mono">{metricValue(magnitude(data.latest?.currentA))} A</strong><span>{direction(data.latest?.currentA)}</span></div><div><small>대표 온도</small><strong className="mono">{metricValue(data.latest?.representativeTempC)} °C</strong></div><div><small>SOC</small><strong className="mono">{metricValue(data.latest?.socPct, 0)} %</strong><span>{data.latest?.socBasis === "RELATIVE_SESSION_START" ? "세션 시작 기준" : data.latest?.socBasis === "ABSOLUTE_GAUGE" ? "게이지 기준" : "기준 없음"}</span></div></div></Card><Card><div className="card-title-row"><h2>SOH / RUL 건강도</h2><span className="field-hint">서버 산출값</span></div>{data.health ? <div className="health-grid"><div><small>SOH</small><strong className="mono">{data.health.sohPct == null ? "—" : `${data.health.sohPct}%`}</strong></div><div><small>RUL</small><strong className="mono">{data.health.rulCycles == null ? "—" : `${data.health.rulCycles} cycle`}</strong></div><div><small>누적 사이클</small><strong className="mono">{data.health.cycleCount == null ? "—" : data.health.cycleCount}</strong></div><div><small>내부 저항</small><strong className="mono">{data.health.internalResistanceMohm == null ? "—" : `${data.health.internalResistanceMohm} mΩ`}</strong></div></div> : <EmptyState title="아직 유효한 건강도 데이터가 없습니다." description={data.targetMode === 2 ? "모드 2는 정밀 진단 결과가 쌓인 뒤 상대 SOH를 제공합니다." : "측정 데이터가 충분히 쌓이면 서버가 건강도를 산출합니다."} />}</Card></div><Card><div className="card-title-row"><div><h2>V · I · T · SOC 추세</h2><p>데이터가 없는 구간은 0으로 보정하지 않습니다.</p></div><div className="segmented">{(["24h", "7d", "30d"] as const).map((item) => <button key={item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item === "24h" ? "24시간" : item === "7d" ? "7일" : "30일"}</button>)}</div></div>{trend.isPending ? <TableState state="loading" /> : trend.data ? <TrendCharts data={trend.data} /> : <TableState state="empty" message="추세 데이터가 없습니다." />}</Card><Card><div className="card-title-row"><h2>과거 측정 세션</h2><span className="field-hint">{sessions.data?.page.total ?? 0}건</span></div>{sessions.isPending ? <TableState state="loading" /> : sessions.data?.items.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>세션 ID</th><th>기간</th><th>최고 이상점수</th><th>상태</th><th>보기</th></tr></thead><tbody>{sessions.data.items.map((item) => <tr key={item.id}><td className="mono">{item.label ?? item.id}</td><td>{formatDateTime(item.startedAt)} — {formatDateTime(item.endedAt)}</td><td>{item.peakScore != null && item.peakGrade != null ? <StatusBadge grade={item.peakGrade} score={item.peakScore} compact /> : "—"}</td><td>{item.status}</td><td><button className="text-button">보기</button></td></tr>)}</tbody></table></div> : <TableState state="empty" message="과거 세션이 없습니다." />}</Card></div>;
}

// 전류는 크기만 그린다 — 부호는 충·방전 방향이지 추세 차트의 관심사가 아니다.
export function trendSeriesValue(metricKey: TrendResponse["series"][number]["metric"], value: number | null): number | null {
  return metricKey === "curr" ? magnitude(value) : value;
}

function TrendCharts({ data }: { data: TrendResponse }) {
  const metrics = [{ key: "volt", label: "전압", unit: "V", color: "#2563eb" }, { key: "curr", label: "전류", unit: "A", color: "#7c3aed" }, { key: "temp", label: "대표 온도", unit: "°C", color: "#c2410c" }, { key: "soc", label: "SOC", unit: "%", color: "#0f766e" }] as const;
  return <div className="trend-chart-grid">{metrics.map((metric) => { const series = data.series.find((item) => item.metric === metric.key); const points = data.buckets.map((at, index) => ({ at: formatTime(at), value: trendSeriesValue(metric.key, series?.points[index] ?? null) })); return <div className="chart-card" key={metric.key}><div className="chart-heading"><strong>{metric.label}</strong><span>{metric.unit}</span></div><ResponsiveContainer width="100%" height={170}><LineChart data={points}><CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" /><XAxis dataKey="at" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} /><YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={32} /><Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }} /><Line type="monotone" dataKey="value" connectNulls={false} stroke={metric.color} strokeWidth={2} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>; })}</div>;
}

export function AnomalyPage() {
  const summary = useAnomalySummary(); const evidence = useEvidence(); const events = useEvents(new URLSearchParams({ severity: "CAUTION,WARNING,DANGER", size: "5" }));
  if (summary.isPending) return <TableState state="loading" />;
  const distribution = summary.data?.riskDistribution ?? { NORMAL: 0, CAUTION: 0, WARNING: 0, DANGER: 0 };
  const bars = (["NORMAL", "CAUTION", "WARNING", "DANGER"] as Grade[]).map((grade) => ({ grade, label: grade === "NORMAL" ? "정상" : grade === "CAUTION" ? "주의" : grade === "WARNING" ? "경고" : "위험", value: distribution[grade] }));
  const maxContribution = Math.max(...(evidence.data?.contributions.map((item) => item.contribution) ?? [1]));
  return <div className="page-stack"><PageHeading eyebrow="ANOMALY DETECTION" title="이상 탐지" description="현재 위험도와 모델 근거를 확인합니다." actions={<span className="connection-pill"><span className="connection-dot online" />{summary.data?.model.status === "RUNNING" ? "모델 실행 중" : summary.data?.model.status}</span>} /><div className="kpi-grid"><Card><span>활성 이상 항목</span><strong className="mono">{summary.data?.activeCount ?? "—"}</strong></Card><Card><span>오늘 발생 이상</span><strong className="mono">{summary.data?.todayCount ?? "—"}</strong></Card><Card><span>최고 이상점수</span><strong className="mono">{score100(summary.data?.peakScore)}</strong><small>{formatDateTime(summary.data?.peakAt)}</small></Card><Card><span>AI 모델 상태</span><strong className="model-running">● {summary.data?.model.status === "RUNNING" ? "실행 중" : summary.data?.model.status ?? "—"}</strong><small>{summary.data?.model.version ?? "모델 버전 미상"}</small></Card></div><div className="two-column-layout"><Card><div className="card-title-row"><h2>위험도 분포</h2><span className="field-hint">소유 배터리 기준</span></div><ResponsiveContainer width="100%" height={250}><BarChart data={bars} layout="vertical" margin={{ left: 10, right: 20 }}><CartesianGrid horizontal={false} stroke="var(--border)" /><XAxis type="number" allowDecimals={false} hide /><YAxis dataKey="label" type="category" width={48} tickLine={false} axisLine={false} /><Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }} /><Bar dataKey="value" radius={[0, 5, 5, 0]}>{bars.map((bar) => <Cell key={bar.grade} fill={`var(--grade-${bar.grade.toLowerCase()})`} />)}</Bar></BarChart></ResponsiveContainer><div className="distribution-list">{bars.map((bar) => <div key={bar.grade}><span className={`grade-shape ${bar.grade === "NORMAL" ? "circle" : bar.grade === "CAUTION" ? "diamond" : bar.grade === "WARNING" ? "triangle" : "square"}`} /><span>{bar.label}</span><strong className="mono">{bar.value}</strong></div>)}</div></Card><Card><div className="card-title-row"><h2>이상 근거 (XAI)</h2><span className="field-hint">양의 기여만 표시</span></div>{evidence.isPending ? <TableState state="loading" /> : evidence.data ? <div className="evidence-list">{evidence.data.contributions.map((item) => <div key={item.feature} className="evidence-row"><div><strong>{featureLabel(item.feature)}</strong><span className="mono">+{item.contribution.toFixed(2)}</span></div><div className="evidence-track"><span style={{ width: `${Math.max(3, item.contribution / maxContribution * 100)}%` }} /></div></div>)}</div> : <TableState state="empty" message="근거 데이터가 없습니다." />}</Card></div><Card><div className="card-title-row"><h2>활성 이상 이벤트</h2><Link className="text-button" to="/events">전체 이력 보기 →</Link></div>{events.data?.items.length ? <div className="event-list">{events.data.items.map((event) => <EventRow event={event} key={event.id} />)}</div> : <TableState state="empty" message="활성 이상 이벤트가 없습니다." />}</Card></div>;
}

function featureLabel(feature: string): string { return ({ dT_dt: "dT/dt · 온도 상승률", I_smooth: "I_smooth · 전류 변화량", V_drop: "V_drop · 전압 강하", SOC_delta: "SOC_delta · SOC 변화율" } as Record<string, string>)[feature] ?? feature; }
function eventGrade(event: BatteryEvent): Grade { return event.severity === "CUT" ? "DANGER" : event.grade ?? event.severity; }
function EventRow({ event, onClick }: { event: BatteryEvent; onClick?: () => void }) { return <button className="event-row" onClick={onClick}><span className="event-time mono">{formatTime(event.occurredAt)}</span><span className="event-main"><strong>{eventTypeLabel(event.type)}</strong><small>{event.batteryLabel ?? "배터리 미지정"} · {event.source}</small></span><StatusBadge grade={eventGrade(event)} score={event.score} compact /></button>; }
function eventTypeLabel(type: string): string { return ({ RELAY_AUTO_CUT: "릴레이 자동 차단", TEMP_THRESHOLD_EXCEEDED: "온도 임계값 초과", CURRENT_CHANGE_SPIKE: "전류 변화량 급상승", ANOMALY_GRADE_CHANGED: "이상점수 등급 전이", DEVICE_HEARTBEAT_MISSED: "디바이스 하트비트 미수신" } as Record<string, string>)[type] ?? type; }

export function TrendPage({ me }: { me: MeResponse }) {
  const batteries = useBatteries(); const [period, setPeriod] = useState<"24h" | "7d" | "30d">("7d"); const [selected, setSelected] = useState<string[]>(me.activeSession?.batteryId ? [me.activeSession.batteryId] : []); const [compareOpen, setCompareOpen] = useState(false); const [exportMessage, setExportMessage] = useState<string | null>(null); const query = new URLSearchParams({ period }); if (selected.length) query.set("batteryIds", selected.join(",")); const trend = useTrends(query);
  const exportFile = async (kind: "csv" | "pdf") => { setExportMessage(null); try { const params = new URLSearchParams({ batteryId: me.activeSession?.batteryId ?? "", sessionId: me.activeSession?.id ?? "", from: new Date(Date.now() - 3_600_000).toISOString(), to: new Date().toISOString() }); const blob = await api.download(kind === "csv" ? "/api/metrics/export.csv" : "/api/trends/export.pdf", params); const href = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = href; anchor.download = kind === "csv" ? "battery-raw.csv" : "trend-report.pdf"; anchor.click(); URL.revokeObjectURL(href); } catch (error) { setExportMessage(error instanceof ApiError && error.code === "RUNTIME_NOT_READY" ? "PDF 보고서는 집계 export provider가 준비된 뒤 사용할 수 있습니다." : "파일을 내보내지 못했습니다. 잠시 후 다시 시도하세요."); } };
  return <div className="page-stack"><PageHeading eyebrow="TRENDS" title="추세 차트" description="4개 지표를 기간별로 확인합니다." actions={<div className="button-row"><Button variant="secondary" onClick={() => void exportFile("csv")}><Download size={16} /> Raw CSV</Button><Button variant="secondary" onClick={() => void exportFile("pdf")}><FileText size={16} /> PDF</Button></div>} />{exportMessage && <p className="form-message" role="status">{exportMessage}</p>}<Card><div className="toolbar"><div className="segmented">{(["24h", "7d", "30d"] as const).map((item) => <button key={item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item === "24h" ? "24시간" : item === "7d" ? "7일" : "30일"}</button>)}</div><div className="compare-control"><Button variant="secondary" onClick={() => setCompareOpen((value) => !value)}>비교 추가 ({selected.length})</Button>{compareOpen && <div className="compare-menu">{batteries.data?.items.map((battery) => <label key={battery.id}><input type="checkbox" checked={selected.includes(battery.id)} onChange={() => setSelected((current) => current.includes(battery.id) ? current.filter((id) => id !== battery.id) : [...current, battery.id])} />{battery.label}</label>)}</div>}</div></div>{trend.isPending ? <TableState state="loading" /> : trend.data ? <TrendCharts data={trend.data} /> : <TableState state="empty" message="선택한 기간에 추세 데이터가 없습니다." />}</Card></div>;
}

export function EventsPage() {
  const [severity, setSeverity] = useState<"ALL" | "DANGER" | "WARNING" | "CAUTION" | "CUT" | "NORMAL">("ALL"); const [page, setPage] = useState(1); const [q, setQ] = useState(""); const [detail, setDetail] = useState<BatteryEvent | null>(null); const params = new URLSearchParams({ page: String(page), size: "20" }); if (q) params.set("q", q); if (severity !== "ALL") params.set("severity", severity); const events = useEvents(params);
  const filters = [{ key: "ALL", label: "전체" }, { key: "DANGER", label: "위험" }, { key: "WARNING", label: "경고" }, { key: "CAUTION", label: "주의" }, { key: "CUT", label: "차단" }, { key: "NORMAL", label: "정상" }] as const;
  return <div className="page-stack"><PageHeading eyebrow="EVENT HISTORY" title="이벤트 이력" description="이상 이벤트와 시스템 안전 동작을 확인합니다." /><Card><div className="toolbar"><input className="toolbar-search" value={q} onChange={(event) => { setQ(event.target.value); setPage(1); }} placeholder="배터리 라벨 검색" aria-label="이벤트 검색" /><div className="filter-chips">{filters.map((filter) => <button key={filter.key} className={severity === filter.key ? "active" : ""} onClick={() => { setSeverity(filter.key); setPage(1); }}>{filter.label}</button>)}</div></div>{events.isPending ? <TableState state="loading" /> : events.error ? <TableState state="error" message={errorMessage(events.error)} /> : events.data?.items.length ? <><div className="data-table-wrap"><table className="data-table"><thead><tr><th>시간</th><th>이벤트</th><th>배터리</th><th>이상점수</th><th>상태</th><th /></tr></thead><tbody>{events.data.items.map((event) => <tr key={event.id}><td className="mono">{formatTime(event.occurredAt)}</td><td><strong>{eventTypeLabel(event.type)}</strong><small className="table-sub">{event.source}</small></td><td>{event.batteryLabel ?? "—"}</td><td className="mono">{event.score == null ? "—" : score100(event.score)}</td><td><StatusBadge grade={eventGrade(event)} compact /></td><td><button className="text-button" onClick={() => setDetail(event)}>상세</button></td></tr>)}</tbody></table></div><Pagination page={events.data.page} onChange={setPage} /></> : <TableState state="empty" message="조건에 맞는 이벤트가 없습니다." />}</Card>{detail && <Modal title={eventTypeLabel(detail.type)} description={`${formatDateTime(detail.occurredAt, true)} · ${detail.batteryLabel ?? "배터리 미지정"}`} onClose={() => setDetail(null)}><div className="detail-list"><div><span>배터리</span><strong>{detail.batteryLabel ?? "—"}</strong></div><div><span>이상점수</span><strong className="mono">{detail.score == null ? "—" : score100(detail.score)}</strong></div><div><span>탐지 주체</span><strong>{detail.source}</strong></div><div><span>원인</span><strong>{detail.causeCode ? eventTypeLabel(detail.causeCode) : "—"}</strong></div><div><span>조치</span><strong>{detail.actionCode ? eventTypeLabel(detail.actionCode) : "—"}</strong></div></div></Modal>}</div>;
}

export function AlertsPage() {
  const summary = useAlertSummary(); const [page, setPage] = useState(1); const [raw, setRaw] = useState<Alert | null>(null); const params = new URLSearchParams({ page: String(page), size: "20" }); const alerts = useAlerts(params); const ack = useAckAlert(); const ackAll = useAckAll();
  return <div className="page-stack"><PageHeading eyebrow="ALERT CENTER" title="알림 센터" description="위험·경고·점검 알림과 확인 상태를 관리합니다." actions={<Button variant="secondary" loading={ackAll.isPending} onClick={() => void ackAll.mutateAsync()}>모두 확인</Button>} /><Card className="alert-summary"><div><span className="eyebrow">TODAY'S ALERTS</span><h2>확인이 필요한 알림 <strong className="mono">{summary.data?.unacknowledgedCount ?? 0}</strong>건</h2></div><div className="summary-counts"><span><b className="mono">{summary.data?.today.DANGER ?? 0}</b>위험</span><span><b className="mono">{summary.data?.today.WARNING ?? 0}</b>경고</span><span><b className="mono">{summary.data?.today.NORMAL_OR_CHECK ?? 0}</b>정상·점검</span></div></Card><Card>{alerts.isPending ? <TableState state="loading" /> : alerts.data?.items.length ? <div className="alert-list">{alerts.data.items.map((alert) => <AlertRow alert={alert} key={alert.id} onAck={() => void ack.mutateAsync(alert.id)} onRaw={() => setRaw(alert)} />)}</div> : <TableState state="empty" message="알림 이력이 없습니다." />}{alerts.data && <Pagination page={alerts.data.page} onChange={setPage} />}</Card>{raw && <RawModal alert={raw} onClose={() => setRaw(null)} />}</div>;
}

function AlertRow({ alert, onAck, onRaw }: { alert: Alert; onAck: () => void; onRaw: () => void }) { const severity = alert.severity === "DANGER" ? "DANGER" : alert.severity === "WARNING" ? "WARNING" : alert.severity === "CHECK" ? "CAUTION" : "NORMAL"; const unack = alert.severity === "DANGER" && !alert.acknowledgedAt; return <article className={`alert-row ${unack ? "unread" : ""}`}><div className={`alert-icon ${severity.toLowerCase()}`}><AlertTriangle size={18} /></div><div className="alert-copy"><div><strong>{alertTitle(alert.titleCode)}</strong><StatusBadge grade={severity} compact /></div><p>{alertDescription(alert.titleCode, alert.params)}</p><small>{alert.batteryLabel ?? "디바이스"} · {formatDateTime(alert.occurredAt, true)}</small><div className="alert-channels">{alert.channels.map((channel) => <span key={channel}>✓ {channel}</span>)}</div></div>{unack && <div className="alert-actions"><Button variant="danger" onClick={onAck}>확인 (Ack)</Button><Button variant="danger-outline" onClick={onRaw}>Raw 데이터</Button></div>}</article>; }
function alertTitle(code: string): string { return ({ TEMP_THRESHOLD_EXCEEDED: "온도 임계값 초과", CURRENT_CHANGE_SPIKE: "전류 변화량 급상승", SOC_DROP: "SOC 급락 감지", DEVICE_HEARTBEAT_MISSED: "디바이스 하트비트 미수신", ANOMALY_GRADE_ESCALATED: "이상 등급 상승" } as Record<string, string>)[code] ?? code; }
function alertDescription(code: string, params?: Record<string, number | string | null>): string { if (code === "TEMP_THRESHOLD_EXCEEDED") return `표면 온도 ${params?.tempC ?? "—"}°C, 상승률 급상승이 감지되었습니다.`; if (code === "CURRENT_CHANGE_SPIKE") return `전류 변화량 ${params?.multiplier ?? "—"}배가 감지되었습니다.`; if (code === "ANOMALY_GRADE_ESCALATED") return `이상점수 ${params?.score ?? "—"} — ${params?.from ?? "—"}에서 ${params?.to ?? "—"}(으)로 상승했습니다.`; return "새로운 안전 이벤트를 확인하세요."; }
function RawModal({ alert, onClose }: { alert: Alert; onClose: () => void }) { const entries = Object.entries(alert.rawSnapshot ?? {}).map(([key, value]) => [rawKey(key), value == null ? "null" : String(value)] as const); return <Modal title="Raw 데이터" description={`${alert.batteryLabel ?? "—"} · ${formatDateTime(alert.occurredAt, true)}`} onClose={onClose} wide><div className="raw-list">{entries.length ? entries.map(([key, value]) => <div key={key}><code>{key}</code><span className="mono">{value}</span></div>) : <TableState state="empty" message="원본 스냅샷이 없습니다." />}</div></Modal>; }
function rawKey(key: string): string { return ({ tempContact: "temp_contact", tempIrSurface: "temp_ir_surface", representativeTempC: "representative_temp_c", voltageV: "voltage_v", currentA: "current_a", anomalyScore: "anomaly_score", relayState: "relay_state", batteryId: "battery_id", socPct: "soc_pct" } as Record<string, string>)[key] ?? key; }

export function NoticesPage() {
  const notices = useNotices(); const [category, setCategory] = useState<"ALL" | NoticeCategory>("ALL"); const [detailId, setDetailId] = useState<string | null>(null); const detail = useQuery({ queryKey: ["notice", detailId], queryFn: () => api.get<{ id: string; category: NoticeCategory; title: string; body: string; publishedAt: string }>(`/api/notices/${detailId}`), enabled: Boolean(detailId) }); const items = notices.data?.items.filter((notice) => category === "ALL" || notice.category === category) ?? []; const filters: Array<[typeof category, string]> = [["ALL", "전체"], ["IMPORTANT", "중요"], ["MAINTENANCE", "점검"], ["FEATURE", "기능"], ["INFO", "안내"]];
  return <div className="page-stack"><PageHeading eyebrow="NOTICES" title="공지사항" description="서비스 소식과 점검 안내를 확인합니다." /><Card><div className="filter-chips">{filters.map(([key, label]) => <button key={key} className={category === key ? "active" : ""} onClick={() => setCategory(key)}>{label}</button>)}</div>{notices.isPending ? <TableState state="loading" /> : items.length ? <div className="notice-list">{items.map((notice) => <button key={notice.id} className="notice-item" onClick={() => setDetailId(notice.id)}><span className={`category-pill category-${notice.category.toLowerCase()}`}>{categoryLabel(notice.category)}</span><span><strong>{notice.title}</strong><small>{notice.summary}</small></span><time className="mono">{formatDateTime(notice.publishedAt)}</time></button>)}</div> : <TableState state="empty" message="공지사항이 없습니다." />}</Card>{detailId && <Modal title={detail.data?.title ?? "공지사항"} description={detail.data ? `${categoryLabel(detail.data.category)} · ${formatDateTime(detail.data.publishedAt)}` : ""} onClose={() => setDetailId(null)}>{detail.isPending ? <TableState state="loading" /> : <div className="notice-body">{detail.data?.body ?? "본문이 없습니다."}</div>}</Modal>}</div>;
}
function categoryLabel(value: NoticeCategory): string { return ({ IMPORTANT: "중요", MAINTENANCE: "점검", FEATURE: "기능", INFO: "안내" } as Record<NoticeCategory, string>)[value]; }

export function PowerbankDiagnosisPage({ me }: { me: MeResponse }) {
  const batteryId = me.activeSession?.batteryId;
  const battery = useBattery(batteryId, Boolean(batteryId));
  const active = useActiveDiagnosis(Boolean(batteryId));
  const history = useDiagnosisHistory(batteryId, Boolean(batteryId));
  const quick = useDiagnosisStart("quick");
  const capacity = useDiagnosisStart("capacity");
  const stop = useDiagnosisStop();
  const [ack, setAck] = useState(false);
  const [quickSocHint, setQuickSocHint] = useState<"" | `${SocHintLevel}`>("");
  const [dischargeCurrentA, setDischargeCurrentA] = useState("1");
  const [fullyChargedConfirmed, setFullyChargedConfirmed] = useState(false);
  const [selectedDiagnosisId, setSelectedDiagnosisId] = useState<string | null>(null);
  const detail = useDiagnosisDetail(selectedDiagnosisId ?? undefined, Boolean(selectedDiagnosisId));
  const supported = battery.data?.targetMode === 2;
  const allowed = supported && battery.data?.diagnosisCapability?.executionAllowed === true;
  const dischargeCurrent = Number(dischargeCurrentA);
  const capacityInputValid = Number.isFinite(dischargeCurrent) && dischargeCurrent > 0;
  const run = async (kind: "quick" | "capacity") => {
    if (!ack || !allowed) return;
    try {
      if (kind === "quick") {
        await quick.mutateAsync(buildQuickDiagnosisBody(quickSocHint === "" ? null : Number(quickSocHint) as SocHintLevel));
      } else {
        await capacity.mutateAsync(buildCapacityDiagnosisBody(dischargeCurrent, fullyChargedConfirmed));
      }
    } catch {
      // The mutation error is rendered below.
    }
  };
  if (!batteryId) return <div className="page-stack"><PageHeading eyebrow="F21 · POWER-BANK DIAGNOSIS" title="보조배터리 진단" description="모드 2 자산의 열화 진단을 실행합니다." /><GateCard /></div>;
  return <div className="page-stack">
    <PageHeading eyebrow="F21 · POWER-BANK DIAGNOSIS" title="보조배터리 진단" description={`${battery.data?.label ?? "—"} · 모드 2 안전 진단`} />
    <Card className="diagnosis-context"><div><span className="eyebrow">CONNECTED ASSET</span><h2>{battery.data?.label ?? "—"}</h2><p>{battery.data?.maker ?? "제조사 미입력"} · {battery.data?.model ?? "모델 미입력"}</p></div><div className="diagnosis-values"><div><small>상대 SOC</small><strong className="mono">{battery.data?.latest?.socPct == null ? "—" : `${battery.data.latest.socPct}%`}</strong><span>{battery.data?.latest?.socBasis === "RELATIVE_SESSION_START" ? "세션 시작 기준" : "기준 없음"}</span></div><div><small>정격 용량</small><strong className="mono">{battery.data?.capacityWh == null ? "—" : `${battery.data.capacityWh} Wh`}</strong></div></div></Card>
    {!supported && <Card className="notice-callout"><LockKeyhole size={20} /><div><strong>모드 2 보조배터리 전용</strong><p>연결된 자산이 모드 1 외부 셀이므로 진단 경로가 잠겨 있습니다.</p></div></Card>}
    {supported && !allowed && <Card className="notice-callout safety-locked"><LockKeyhole size={20} /><div><strong>{capabilityLock(battery.data?.diagnosisCapability?.reasonCode).title}</strong><p>{capabilityLock(battery.data?.diagnosisCapability?.reasonCode).body}</p><span className="mono">{battery.data?.diagnosisCapability?.reasonCode ?? "SAFETY_PROFILE_NOT_READY"}</span></div></Card>}
    <div className="diagnosis-actions">
      <Card><div className="card-title-row"><div><h2>빠른 진단</h2><p>약 2분 · 낮은 신뢰도 · 잔량 힌트</p></div><BatteryCharging size={20} /></div><p>빠른 진단 결과는 열화 건강도로 사용하지 않으며, 서버 capability가 준비된 경우에만 실행됩니다.</p><Field label="겉면 잔량 힌트"><select value={quickSocHint} onChange={(event) => setQuickSocHint(event.target.value as "" | `${SocHintLevel}`)} disabled={!allowed}><option value="">모름</option><option value="1">1단계</option><option value="2">2단계</option><option value="3">3단계</option><option value="4">4단계</option></select></Field><Button variant="secondary" disabled={!allowed || !ack} loading={quick.isPending} onClick={() => void run("quick")}>빠른 진단 시작</Button></Card>
      <Card><div className="card-title-row"><div><h2>정밀 용량 테스트</h2><p>수 시간 · 높은 신뢰도 · 완충 확인 필수</p></div><BarChart3 size={20} /></div><p>정격 용량과 완충 상태를 서버가 확인한 뒤에만 시작됩니다.</p><Field label="방전 전류 (A)" hint="기본 1.0 A"><input value={dischargeCurrentA} onChange={(event) => setDischargeCurrentA(event.target.value)} type="number" min="0.01" step="0.01" disabled={!allowed} /></Field><label className="checkbox-field"><input type="checkbox" checked={fullyChargedConfirmed} onChange={(event) => setFullyChargedConfirmed(event.target.checked)} disabled={!allowed} /><span>완충 상태임을 확인했습니다.</span></label><Button variant="secondary" disabled={!allowed || !ack || !battery.data?.capacityWh || !fullyChargedConfirmed || !capacityInputValid} loading={capacity.isPending} onClick={() => void run("capacity")}>정밀 용량 테스트 시작</Button></Card>
    </div>
    <label className="safety-ack"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} disabled={!allowed} /><span>진단 중 이상 알림은 억제되지만 Fail-Safe 자동 차단은 항상 우선함을 확인했습니다.</span></label>
    {(quick.error || capacity.error) && <p className="form-error">{errorMessage(quick.error ?? capacity.error)}</p>}
    {active.data && <Card className="diagnosis-progress"><div className="card-title-row"><div><h2>진단 진행 중</h2><p>{active.data.kind === "QUICK" ? "빠른 진단" : "정밀 용량 테스트"} · {active.data.phase ?? "진행"}</p></div><Button variant="danger-outline" loading={stop.isPending} onClick={() => void stop.mutateAsync()}>진단 중단</Button></div><div className="progress-track"><span style={{ width: `${progressPct(active.data.startedAt, active.data.estimatedEndAt) ?? 0}%` }} /></div><div className="diagnosis-live-values"><span>목표 부하 <strong className="mono">{metricValue(active.data.loadTargetA, 2)} A</strong></span><span>실측 부하 <strong className="mono">{metricValue(active.data.loadActualA, 2)} A</strong></span></div></Card>}
    <Card><div className="card-title-row"><h2>과거 진단 이력</h2><span className="field-hint">유효한 결과만 건강도에 반영</span></div>{history.isPending ? <TableState state="loading" message="진단 이력을 불러오는 중입니다." /> : history.error ? <TableState state="error" message={errorMessage(history.error)} /> : history.data?.items.length ? <div className="diagnosis-history-list">{history.data.items.map((item) => <div className="diagnosis-history-row" key={item.id}><div><strong>{item.kind === "QUICK" ? "빠른 진단" : "정밀 용량 테스트"}</strong><small>{statusLabel(item.status)} · {formatDateTime(item.measuredAt ?? item.startedAt)}{item.confidence ? ` · ${item.confidence}` : ""}</small></div><span className="mono">{item.summary?.sohRelPct == null ? "—" : `${item.summary.sohRelPct}%`}</span><Button variant="ghost" onClick={() => setSelectedDiagnosisId(item.id)}>상세</Button></div>)}</div> : <TableState state="empty" message="유효한 진단 이력이 없습니다." />}</Card>
    {selectedDiagnosisId && <Modal title={detail.data?.kind === "QUICK" ? "빠른 진단 상세" : "정밀 용량 테스트 상세"} description={detail.data ? `${statusLabel(detail.data.status)}${detail.data.abortReason ? ` · ${abortReasonLabel(detail.data.abortReason)}` : ""} · ${formatDateTime(detail.data.measuredAt ?? detail.data.startedAt)}` : ""} onClose={() => setSelectedDiagnosisId(null)} wide>{detail.isPending ? <TableState state="loading" /> : detail.error ? <TableState state="error" message={errorMessage(detail.error)} /> : detail.data ? <div className="diagnosis-detail"><div className="detail-summary"><span>상태<strong>{statusLabel(detail.data.status)}</strong></span><span>신뢰도<strong>{detail.data.confidence ?? "—"}</strong></span><span>시작<strong>{formatDateTime(detail.data.startedAt)}</strong></span></div>{detail.data.kind === "QUICK" ? <div className="raw-list"><div><code>잔량 힌트</code><span>{detail.data.socHintLevel ?? "모름"}</span></div><div><code>규제 무릎 전류</code><span className="mono">{metricValue(detail.data.quick?.regulationKneeA, 2)} A</span></div><div><code>열 기울기</code><span className="mono">{metricValue(detail.data.quick?.thermalSlopeCPerMin, 2)} °C/min</span></div><div><code>판정</code><span>{gradeLabel(detail.data.quick?.grade as string | null)}</span></div></div> : <div className="raw-list"><div><code>방전 전류</code><span className="mono">{metricValue(detail.data.capacity?.dischargeCurrentA, 2)} A</span></div><div><code>전달 용량</code><span className="mono">{metricValue(detail.data.capacity?.deliveredWh, 1)} Wh</span></div><div><code>상대 SOH</code><span className="mono">{metricValue(detail.data.capacity?.sohRelPct, 1)}%</span></div><div><code>기준 결과</code><span>{detail.data.capacity?.isBaseline ? "기준" : "비교"}</span></div></div>}</div> : null}</Modal>}
  </div>;
}

const relaySchema = z.object({ reason: z.string().min(1, "사유를 입력하세요."), password: z.string().min(1, "비밀번호를 입력하세요.") });
type RelayForm = z.infer<typeof relaySchema>;
function RelayModal({ action, relay, onClose }: { action: "cut" | "restore"; relay: Relay; onClose: () => void }) { const mutation = useRelayMutation(action); const form = useForm<RelayForm>({ resolver: zodResolver(relaySchema), defaultValues: { reason: "", password: "" } }); const submit = form.handleSubmit(async (values) => { try { await mutation.mutateAsync(values); onClose(); } catch { /* error is shown below */ } }); return <Modal title={action === "cut" ? "릴레이 차단 승인" : "릴레이 복구 승인"} description="서버가 재인증·사유·현재 인터락 상태를 모두 검증한 뒤 실행합니다." onClose={onClose}><form onSubmit={submit} className="form-stack"><Field label="사유 입력 (필수)" error={form.formState.errors.reason?.message}><textarea {...form.register("reason")} rows={3} placeholder={action === "cut" ? "온도 임계값 초과로 긴급 차단…" : "점검 완료, 정상 확인 후 복구…"} /></Field><Field label="비밀번호 재인증" error={form.formState.errors.password?.message}><input {...form.register("password")} type="password" autoComplete="current-password" /></Field>{mutation.error && <p className="form-error">{errorMessage(mutation.error)}</p>}<div className="modal-actions"><Button variant="secondary" onClick={onClose}>취소</Button><Button type="submit" variant={action === "cut" ? "danger-outline" : "primary"} loading={mutation.isPending}>{action === "cut" ? "승인 · 차단" : "승인 · 복구"}</Button></div></form></Modal>; }

export function RelayPage() {
  const relay = useRelay(); const history = useRelayHistory(); const [action, setAction] = useState<"cut" | "restore" | null>(null); if (relay.isPending) return <TableState state="loading" />; if (!relay.data) return <Card><TableState state="error" message={errorMessage(relay.error)} /></Card>; const current = relay.data; return <div className="page-stack"><PageHeading eyebrow="SAFETY CONTROL" title="릴레이 제어 · Kill-Switch" description="원격 차단·복구는 항상 서버 승인 게이트를 거칩니다." /><Card className={`relay-state-card ${current.state === "OPEN" ? "relay-open" : "relay-closed"}`}><div className="relay-state-icon"><ShieldAlert size={28} /></div><div><span className="eyebrow">CURRENT RELAY STATE</span><h2>{current.state === "OPEN" ? "차단됨 (OPEN)" : "연결됨 (CLOSED)"}</h2><p>{current.interlock.engaged ? `Fail-Safe 인터락 유지 · ${current.interlock.condition ?? "조건 확인 필요"}` : `마지막 변경 ${formatDateTime(current.changedAt, true)}`}</p></div><div className="relay-actions">{current.state === "CLOSED" ? <Button variant="danger-outline" onClick={() => setAction("cut")}>릴레이 차단</Button> : <Button variant="primary" disabled={!current.interlock.canRestore} onClick={() => setAction("restore")}>릴레이 복구</Button>}</div></Card><div className="two-column-layout"><Card><div className="card-title-row"><h2>안전 원칙</h2><ShieldCheck size={20} /></div><ul className="principle-list"><li>Fail-Safe 인터락은 사용자 조작보다 우선합니다.</li><li>차단·복구 모두 사유와 비밀번호 재인증이 필수입니다.</li><li>서버 성공 응답 전에는 화면 상태를 바꾸지 않습니다.</li><li>자동 복구는 없으며, 자동 차단은 서버 이벤트로만 표시합니다.</li></ul></Card><Card><div className="card-title-row"><h2>최근 제어 이력</h2><span className="field-hint">감사 추적</span></div>{history.isPending ? <TableState state="loading" /> : history.data?.items.length ? <div className="control-history">{history.data.items.map((item) => <div key={item.id}><span className={`history-dot ${item.action === "RELAY_AUTO_CUT" ? "danger" : "primary"}`} /><div><strong>{item.action === "RELAY_AUTO_CUT" ? "Fail-Safe 자동 차단" : item.action === "RELAY_CUT" ? "수동 릴레이 차단" : "수동 릴레이 복구"}</strong><small>{formatDateTime(item.at, true)} · {item.reason ?? item.reasonCode ?? "시스템"}</small></div></div>)}</div> : <TableState state="empty" message="제어 이력이 없습니다." />}</Card></div>{action && <RelayModal action={action} relay={current} onClose={() => setAction(null)} />}</div>;
}

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "현재 비밀번호를 입력하세요."),
  newPassword: z.string().regex(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/, "영문·숫자·특수문자를 포함한 8자 이상이어야 합니다."),
  newPasswordConfirm: z.string().min(1, "새 비밀번호를 다시 입력하세요."),
}).refine((values) => values.newPassword === values.newPasswordConfirm, { path: ["newPasswordConfirm"], message: "새 비밀번호가 일치하지 않습니다." });
type PasswordFormValues = z.infer<typeof passwordSchema>;

function PasswordChangeForm() {
  const form = useForm<PasswordFormValues>({ resolver: zodResolver(passwordSchema), defaultValues: { currentPassword: "", newPassword: "", newPasswordConfirm: "" } });
  const [message, setMessage] = useState("");
  const submit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    setMessage("");
    try {
      await api.changePassword({ currentPassword, newPassword });
      form.reset();
      setMessage("비밀번호가 변경되었습니다.");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  });
  return <div className="password-section"><div className="section-heading-inline"><div><h2>비밀번호 변경</h2><p>새 비밀번호는 영문·숫자·특수문자를 포함한 8자 이상이어야 합니다.</p></div></div><form onSubmit={submit} className="form-stack"><Field label="현재 비밀번호" error={form.formState.errors.currentPassword?.message}><input {...form.register("currentPassword")} type="password" autoComplete="current-password" /></Field><Field label="새 비밀번호" error={form.formState.errors.newPassword?.message}><input {...form.register("newPassword")} type="password" autoComplete="new-password" /></Field><Field label="새 비밀번호 확인" error={form.formState.errors.newPasswordConfirm?.message}><input {...form.register("newPasswordConfirm")} type="password" autoComplete="new-password" /></Field><div className="settings-actions"><Button variant="secondary" type="submit" loading={form.formState.isSubmitting}>비밀번호 변경</Button></div>{message && <p className="form-message" role="status">{message}</p>}</form></div>;
}

const alertChannelOptions: Array<[keyof AlertChannels, string, string]> = [
  ["KAKAO", "카카오톡 알림", "위험·경고 발생 시 즉시 발송"],
  ["EMAIL", "이메일", "일일 요약 및 위험 알림"],
  ["SMS", "SMS", "위험 등급만 발송"],
  ["WEBPUSH", "웹푸시 (PWA)", "브라우저·모바일 푸시"],
];

type VoiceToggleField = "connectionEnabled" | "anomalyEnabled" | "failsafeRelayEnabled" | "deviceErrorEnabled" | "networkEnabled";
const voiceAlertOptions: Array<[VoiceToggleField, string, string]> = [
  ["connectionEnabled", "장비 연결/해제", "라즈베리파이 연결·해제 시 안내"],
  ["anomalyEnabled", "이상 탐지 경보", "주의·경고·위험 등급 진입 시 안내"],
  ["failsafeRelayEnabled", "Fail-Safe 릴레이 차단", "안전 회로가 릴레이를 차단했을 때 안내"],
  ["deviceErrorEnabled", "센서/장비 오류", "센서 오류·통신 두절 시 안내"],
  ["networkEnabled", "네트워크 상태", "브로커·백엔드 연결 상태 변화 안내"],
];

export function SettingsPage({ me, onProfileSaved, onPreferencesSaved }: { me: MeResponse; onProfileSaved: (user: MeResponse["user"]) => void; onPreferencesSaved: (preferences: MeResponse["preferences"]) => void }) {
  const [tab, setTab] = useState("alerts");
  const [saved, setSaved] = useState("");
  const [channels, setChannels] = useState<AlertChannels>({ KAKAO: false, EMAIL: false, SMS: false, WEBPUSH: false });
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsReady, setAlertsReady] = useState(false);
  const [alertsAttempt, setAlertsAttempt] = useState(0);
  const [alertsSaving, setAlertsSaving] = useState(false);
  const [alertsError, setAlertsError] = useState("");
  const [voice, setVoice] = useState<VoiceAlertSettings | null>(null);
  const [voiceLoading, setVoiceLoading] = useState(true);
  const [voiceReady, setVoiceReady] = useState(false);
  const [voiceAttempt, setVoiceAttempt] = useState(0);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const profile = useForm({ defaultValues: { name: me.user?.name ?? "", email: me.user?.email ?? "", phone: me.user?.phone ?? "" } });

  useEffect(() => {
    let mounted = true;
    setAlertsLoading(true);
    setAlertsReady(false);
    void api.getAlertSettings().then((response) => {
      if (mounted) {
        setChannels(response.channels);
        setAlertsReady(true);
        setAlertsError("");
      }
    }).catch(() => {
      if (mounted) {
        setAlertsReady(false);
        setAlertsError("알림 설정을 불러오지 못했습니다. 서버 설정을 확인한 뒤 다시 시도하세요.");
      }
    }).finally(() => {
      if (mounted) setAlertsLoading(false);
    });
    return () => { mounted = false; };
  }, [alertsAttempt]);

  useEffect(() => {
    let mounted = true;
    setVoiceLoading(true);
    setVoiceReady(false);
    void api.getVoiceAlertSettings().then((response) => {
      if (mounted) {
        setVoice(response);
        setVoiceReady(true);
        setVoiceError("");
      }
    }).catch(() => {
      if (mounted) {
        setVoiceReady(false);
        setVoiceError("음성 안내 설정을 불러오지 못했습니다. 서버 설정을 확인한 뒤 다시 시도하세요.");
      }
    }).finally(() => {
      if (mounted) setVoiceLoading(false);
    });
    return () => { mounted = false; };
  }, [voiceAttempt]);

  const submit = profile.handleSubmit(async (values) => {
    try { const user = await api.updateMe(values); onProfileSaved(user); setSaved("계정 정보가 저장되었습니다."); } catch { setSaved("저장하지 못했습니다."); }
  });
  const selectTheme = async (theme: "light" | "dark" | "system") => {
    try { const preferences = await api.updatePreferences({ ...me.preferences, theme }); onPreferencesSaved(preferences); setSaved("테마가 저장되었습니다."); } catch { setSaved("테마를 저장하지 못했습니다."); }
  };
  const toggleChannel = async (key: keyof AlertChannels, value: boolean) => {
    if (!alertsReady) return;
    const previous = channels;
    const next = { ...previous, [key]: value };
    setChannels(next);
    setAlertsSaving(true);
    setAlertsError("");
    try {
      const response = await api.updateAlertSettings(next);
      setChannels(response.channels);
      setSaved("알림 설정이 저장되었습니다.");
    } catch {
      setChannels(previous);
      setAlertsError("알림 설정을 저장하지 못했습니다.");
      setSaved("알림 설정을 저장하지 못했습니다.");
    } finally {
      setAlertsSaving(false);
    }
  };
  const patchVoice = async (patch: Partial<Omit<VoiceAlertSettings, "updatedAt">>) => {
    if (!voice || !voiceReady) return;
    const previous = voice;
    setVoice({ ...previous, ...patch });
    setVoiceSaving(true);
    setVoiceError("");
    try {
      const response = await api.updateVoiceAlertSettings(patch);
      setVoice(response);
      setSaved("음성 안내 설정이 저장되었습니다.");
    } catch {
      setVoice(previous);
      setVoiceError("음성 안내 설정을 저장하지 못했습니다.");
      setSaved("음성 안내 설정을 저장하지 못했습니다.");
    } finally {
      setVoiceSaving(false);
    }
  };
  return <div className="page-stack"><PageHeading eyebrow="SETTINGS" title="설정" description="알림 수신·계정 정보·테마·음성 안내를 관리합니다." />{saved && <div className="save-message" role="status"><Check size={16} />{saved}</div>}<Card><Tabs value={tab} onChange={setTab} items={[{ value: "alerts", label: "알림 수신" }, { value: "account", label: "계정 정보" }, { value: "theme", label: "테마" }, { value: "voice", label: "음성 안내" }]} />{tab === "alerts" && <div className="settings-section"><div className="section-heading-inline"><div><h2>알림 수신 채널</h2><p>동일 이벤트는 서버 정책에 따라 중복 발송이 억제됩니다.</p></div></div>{alertsLoading ? <TableState state="loading" message="서버 알림 설정을 불러오는 중입니다." /> : <>{alertChannelOptions.map(([key, label, hint]) => <label className="toggle-row" key={key}><span><strong>{label}</strong><small>{hint}</small></span><input type="checkbox" checked={channels[key]} disabled={!alertsReady || alertsSaving} onChange={(event) => void toggleChannel(key, event.target.checked)} /></label>)}{alertsError && <div className="form-error" role="alert"><span>{alertsError}</span><Button variant="ghost" onClick={() => setAlertsAttempt((attempt) => attempt + 1)}>다시 시도</Button></div>}</>}</div>}{tab === "account" && <div className="settings-section"><form onSubmit={submit} className="form-stack"><Field label="이름"><input {...profile.register("name")} /></Field><Field label="이메일"><input {...profile.register("email")} type="email" /></Field><Field label="전화번호" hint="SMS·카카오 알림 수신에 사용됩니다."><input {...profile.register("phone")} /></Field><div className="settings-actions"><Button variant="primary" type="submit" loading={profile.formState.isSubmitting}>변경 저장</Button></div></form><PasswordChangeForm /></div>}{tab === "theme" && <div className="settings-section"><div className="section-heading-inline"><div><h2>테마</h2><p>라이트·다크·시스템 테마를 선택합니다.</p></div></div><div className="theme-options">{(["light", "dark", "system"] as const).map((theme) => <button key={theme} className={me.preferences.theme === theme ? "active" : ""} onClick={() => void selectTheme(theme)}><span className={`theme-preview theme-${theme}`} /><strong>{theme === "light" ? "라이트" : theme === "dark" ? "다크" : "시스템"}</strong><small>{me.preferences.theme === theme ? "현재 선택" : "선택"}</small></button>)}</div></div>}{tab === "voice" && <div className="settings-section"><div className="section-heading-inline"><div><h2>음성 안내</h2><p>라즈베리파이 스피커로 재생되는 사전 녹음 안내입니다. 릴레이·Fail-Safe 판단에는 영향을 주지 않습니다.</p></div></div>{voiceLoading || !voice ? <TableState state="loading" message="음성 안내 설정을 불러오는 중입니다." /> : <>
    <label className="toggle-row"><span><strong>음성 안내 전체</strong><small>끄면 볼륨·카테고리 설정과 무관하게 모든 음성 안내가 정지됩니다.</small></span><input type="checkbox" checked={voice.enabled} disabled={!voiceReady || voiceSaving} onChange={(event) => void patchVoice({ enabled: event.target.checked })} /></label>
    <div className="toggle-row"><span><strong>음량</strong><small>{voice.volume}%</small></span><input type="range" min={0} max={100} step={5} value={voice.volume} disabled={!voice.enabled || !voiceReady || voiceSaving} onChange={(event) => setVoice({ ...voice, volume: Number(event.target.value) })} onMouseUp={(event) => void patchVoice({ volume: Number((event.target as HTMLInputElement).value) })} onTouchEnd={(event) => void patchVoice({ volume: Number((event.target as HTMLInputElement).value) })} onKeyUp={(event) => void patchVoice({ volume: Number((event.target as HTMLInputElement).value) })} /></div>
    {voiceAlertOptions.map(([key, label, hint]) => <label className="toggle-row" key={key}><span><strong>{label}</strong><small>{hint}</small></span><input type="checkbox" checked={voice[key]} disabled={!voice.enabled || !voiceReady || voiceSaving} onChange={(event) => void patchVoice({ [key]: event.target.checked })} /></label>)}
    {voiceError && <div className="form-error" role="alert"><span>{voiceError}</span><Button variant="ghost" onClick={() => setVoiceAttempt((attempt) => attempt + 1)}>다시 시도</Button></div>}
  </>}</div>}</Card></div>;
}
