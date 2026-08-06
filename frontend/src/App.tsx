import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "./components/Shell";
import { Modal } from "./components/ui";
import { api } from "./api/client";
import { useMe } from "./api/hooks";
import { useRealtime } from "./realtime/useRealtime";
import { AdminAuditPage, AdminBatteryPage, AdminEventTrendPage, AdminNoticePage, AdminOverviewPage, AdminUsersPage } from "./pages/AdminPages";
import { AlertsPage, AnomalyPage, BatteryDetailPage, BatteryPage, DashboardPage, EventsPage, NoticesPage, PowerbankDiagnosisPage, RelayPage, SettingsPage, TrendPage } from "./pages/UserPages";
import { FindPage, LandingPage, LoginPage, SignupPage } from "./pages/PublicPages";
import type { MeResponse } from "./types";
import { queryClient } from "./queryClient";

function ProtectedRoutes({ me, realtime }: { me: MeResponse; realtime: ReturnType<typeof useRealtime> }) {
  const isAdmin = me.user?.role === "ADMIN";
  return <Routes>
    <Route path="/login" element={<Navigate to="/battery" replace />} />
    <Route path="/dashboard" element={<DashboardPage realtime={realtime} me={me} />} />
    <Route path="/battery" element={<BatteryPage />} />
    <Route path="/battery/:id" element={<RouteWithBatteryId me={me} />} />
    <Route path="/anomaly" element={<AnomalyPage />} />
    <Route path="/trend" element={<TrendPage me={me} />} />
    <Route path="/events" element={<EventsPage />} />
    <Route path="/alertHistory" element={<AlertsPage />} />
    <Route path="/notices" element={<NoticesPage />} />
    <Route path="/powerbankDiag" element={<PowerbankDiagnosisPage me={me} />} />
    <Route path="/relay" element={<RelayPage />} />
    <Route path="/settings" element={<SettingsPage me={me} onProfileSaved={() => { void queryClient.invalidateQueries({ queryKey: ["me"] }); }} onPreferencesSaved={() => { void queryClient.invalidateQueries({ queryKey: ["me"] }); }} />} />
    {isAdmin && <>
      <Route path="/admin" element={<AdminOverviewPage />} />
      <Route path="/adminUsers" element={<AdminUsersPage />} />
      <Route path="/adminBattery" element={<AdminBatteryPage />} />
      <Route path="/adminNotice" element={<AdminNoticePage />} />
      <Route path="/adminAudit" element={<AdminAuditPage />} />
      <Route path="/adminEventTrend" element={<AdminEventTrendPage />} />
    </>}
    <Route path="*" element={<Navigate to={isAdmin ? "/admin" : "/battery"} replace />} />
  </Routes>;
}

function RouteWithBatteryId({ me }: { me: MeResponse }) {
  const location = useLocation();
  const id = location.pathname.split("/")[2] ?? me.activeSession?.batteryId ?? "";
  return <BatteryDetailPage id={id} />;
}

function PublicRoutes({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  return <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/login" element={<LoginPage onSuccess={onSignedIn} />} />
    <Route path="/signup" element={<SignupPage />} />
    <Route path="/find" element={<FindPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}

function AppContent() {
  const meQuery = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [autoCut, setAutoCut] = useState<Record<string, unknown> | null>(null);
  const me = meQuery.data;
  const realtime = useRealtime({ sessionKey: me?.activeSession?.id, enabled: Boolean(me?.activeSession), onAutoCut: (payload) => setAutoCut((payload ?? {}) as Record<string, unknown>), onSessionEnded: () => { void meQuery.refetch(); navigate("/battery"); }, onAuthFailure: () => { void meQuery.refetch(); navigate("/login"); } });
  const theme = me?.preferences?.theme ?? "light";
  useEffect(() => { const root = document.documentElement; const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches; root.dataset.theme = theme === "system" ? (systemDark ? "dark" : "light") : theme; }, [theme]);
  const signInComplete = async () => { await meQuery.refetch(); navigate("/battery"); };
  const signOut = async () => { try { await api.signOut(); } finally { qc.clear(); navigate("/"); } };
  if (meQuery.isPending) return <div className="boot-screen"><div className="boot-mark">⌁</div><p>셀가드 관제를 준비하는 중입니다.</p></div>;
  if (!me?.user) return <PublicRoutes onSignedIn={signInComplete} />;
  return <><AppShell me={me} onLogout={signOut} onTheme={async (next) => { try { await api.updatePreferences({ ...(me.preferences ?? { theme: "light", lang: "ko" }), theme: next }); await meQuery.refetch(); } catch { /* settings page exposes the failure */ } }}><ProtectedRoutes me={me} realtime={realtime} /></AppShell>{autoCut && <Modal title="서버 Fail-Safe · 자동 릴레이 차단" description="서버가 독립 안전 조건을 확정하여 릴레이를 자동으로 차단했습니다." onClose={() => setAutoCut(null)}><div className="auto-cut-panel"><div className="auto-cut-icon"><ShieldAlertIcon /></div><div><strong>대상 배터리</strong><span>{String(autoCut.batteryLabel ?? "—")}</span></div><div><strong>감지 온도</strong><span className="mono">{autoCut.representativeTempC == null ? "—" : `${String(autoCut.representativeTempC)} °C`}</span></div><div><strong>트리거</strong><span className="mono">{String(autoCut.triggerCode ?? "—")}</span></div></div><div className="modal-actions"><button className="button button-primary" onClick={() => setAutoCut(null)}>확인</button></div></Modal>}</>;
}

function ShieldAlertIcon() { return <span className="auto-cut-shield">!</span>; }

export default function App() { return <QueryClientProvider client={queryClient}><AppContent /></QueryClientProvider>; }
