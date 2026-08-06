import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClientProvider, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AppShell } from "./components/Shell";
import { Modal } from "./components/ui";
import { api, subscribeAuthFailure } from "./api/client";
import { useMe } from "./api/hooks";
import { useRealtime } from "./realtime/useRealtime";
import { AdminAuditPage, AdminBatteryPage, AdminEventTrendPage, AdminNoticePage, AdminOverviewPage, AdminUsersPage } from "./pages/AdminPages";
import { AlertsPage, AnomalyPage, BatteryDetailPage, BatteryPage, DashboardPage, EventsPage, NoticesPage, PowerbankDiagnosisPage, RelayPage, SettingsPage, TrendPage } from "./pages/UserPages";
import { FindPage, LandingPage, LoginPage, SignupPage } from "./pages/PublicPages";
import type { MeResponse } from "./types";
import { queryClient } from "./queryClient";

const sessionRequiredPaths = new Set(["/dashboard", "/anomaly", "/trend", "/events", "/alertHistory", "/notices", "/powerbankDiag", "/relay", "/settings"]);

export function authenticatedLandingPath(me: MeResponse): "/admin" | "/battery" {
  return me.user?.role === "ADMIN" ? "/admin" : "/battery";
}

export function requiresActiveSession(pathname: string): boolean {
  return sessionRequiredPaths.has(pathname);
}

export async function expireAuthentication(qc: QueryClient, preferences: MeResponse["preferences"] | undefined): Promise<void> {
  try {
    await qc.cancelQueries();
  } finally {
    qc.clear();
    qc.setQueryData<MeResponse>(["me"], {
      user: null,
      activeSession: null,
      unreadAlertCount: 0,
      activeAnomalyCount: 0,
      preferences: preferences ?? { theme: "light", lang: "ko" },
    });
  }
}

function ProtectedRoutes({ me, realtime }: { me: MeResponse; realtime: ReturnType<typeof useRealtime> }) {
  const isAdmin = me.user?.role === "ADMIN";
  const landingPath = authenticatedLandingPath(me);
  const sessionRoute = (path: string, element: ReactNode) => (
    <Route path={path} element={!isAdmin && requiresActiveSession(path) ? <ActiveSessionRoute>{element}</ActiveSessionRoute> : element} />
  );
  return <Routes>
    <Route path="/login" element={<Navigate to={landingPath} replace />} />
    {sessionRoute("/dashboard", <DashboardPage realtime={realtime} me={me} />)}
    <Route path="/battery" element={<BatteryPage />} />
    <Route path="/battery/:id" element={<RouteWithBatteryId me={me} />} />
    {sessionRoute("/anomaly", <AnomalyPage />)}
    {sessionRoute("/trend", <TrendPage me={me} />)}
    {sessionRoute("/events", <EventsPage />)}
    {sessionRoute("/alertHistory", <AlertsPage />)}
    {sessionRoute("/notices", <NoticesPage />)}
    {sessionRoute("/powerbankDiag", <PowerbankDiagnosisPage me={me} />)}
    {sessionRoute("/relay", <RelayPage />)}
    {sessionRoute("/settings", <SettingsPage me={me} onProfileSaved={() => { void queryClient.invalidateQueries({ queryKey: ["me"] }); }} onPreferencesSaved={() => { void queryClient.invalidateQueries({ queryKey: ["me"] }); }} />)}
    {isAdmin && <>
      <Route path="/admin" element={<AdminOverviewPage />} />
      <Route path="/adminUsers" element={<AdminUsersPage />} />
      <Route path="/adminBattery" element={<AdminBatteryPage />} />
      <Route path="/adminNotice" element={<AdminNoticePage />} />
      <Route path="/adminAudit" element={<AdminAuditPage />} />
      <Route path="/adminEventTrend" element={<AdminEventTrendPage />} />
    </>}
    <Route path="*" element={<Navigate to={landingPath} replace />} />
  </Routes>;
}

function ActiveSessionRoute({ children }: { children: ReactNode }) {
  const { data: me, refetch } = useMe();
  const [sessionChecked, setSessionChecked] = useState(Boolean(me?.activeSession));

  useEffect(() => {
    if (me?.activeSession) return;
    let disposed = false;
    void refetch().finally(() => { if (!disposed) setSessionChecked(true); });
    return () => { disposed = true; };
  }, [refetch]);

  if (me?.activeSession) return children;
  if (!sessionChecked) return <div className="boot-screen"><div className="boot-mark">⌁</div><p>측정 세션을 확인하는 중입니다.</p></div>;
  return <Navigate to="/battery" replace />;
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
  const meRef = useRef(me);
  const authFailureInProgress = useRef(false);
  meRef.current = me;
  const handleAuthFailure = useCallback(() => {
    const currentMe = meRef.current;
    if (!currentMe?.user || authFailureInProgress.current) return;
    authFailureInProgress.current = true;
    void expireAuthentication(qc, currentMe.preferences).finally(() => navigate("/login", { replace: true }));
  }, [navigate, qc]);
  useEffect(() => subscribeAuthFailure(handleAuthFailure), [handleAuthFailure]);
  useEffect(() => { if (me?.user) authFailureInProgress.current = false; }, [me?.user?.id]);
  const realtime = useRealtime({ sessionKey: me?.activeSession?.id, enabled: Boolean(me?.activeSession), onAutoCut: (payload) => setAutoCut((payload ?? {}) as Record<string, unknown>), onSessionEnded: () => { void meQuery.refetch(); navigate("/battery"); }, onAuthFailure: handleAuthFailure });
  const theme = me?.preferences?.theme ?? "light";
  useEffect(() => { const root = document.documentElement; const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches; root.dataset.theme = theme === "system" ? (systemDark ? "dark" : "light") : theme; }, [theme]);
  const signInComplete = async () => { const result = await meQuery.refetch(); if (result.data?.user) navigate(authenticatedLandingPath(result.data)); };
  const signOut = async () => { try { await api.signOut(); } finally { qc.clear(); navigate("/"); } };
  if (meQuery.isPending) return <div className="boot-screen"><div className="boot-mark">⌁</div><p>셀가드 관제를 준비하는 중입니다.</p></div>;
  if (!me?.user) return <PublicRoutes onSignedIn={signInComplete} />;
  return <><AppShell me={me} onLogout={signOut} onTheme={async (next) => { try { await api.updatePreferences({ ...(me.preferences ?? { theme: "light", lang: "ko" }), theme: next }); await meQuery.refetch(); } catch { /* settings page exposes the failure */ } }}><ProtectedRoutes me={me} realtime={realtime} /></AppShell>{autoCut && <Modal title="서버 Fail-Safe · 자동 릴레이 차단" description="서버가 독립 안전 조건을 확정하여 릴레이를 자동으로 차단했습니다." onClose={() => setAutoCut(null)}><div className="auto-cut-panel"><div className="auto-cut-icon"><ShieldAlertIcon /></div><div><strong>대상 배터리</strong><span>{String(autoCut.batteryLabel ?? "—")}</span></div><div><strong>감지 온도</strong><span className="mono">{autoCut.representativeTempC == null ? "—" : `${String(autoCut.representativeTempC)} °C`}</span></div><div><strong>트리거</strong><span className="mono">{String(autoCut.triggerCode ?? "—")}</span></div></div><div className="modal-actions"><button className="button button-primary" onClick={() => setAutoCut(null)}>확인</button></div></Modal>}</>;
}

function ShieldAlertIcon() { return <span className="auto-cut-shield">!</span>; }

export default function App() { return <QueryClientProvider client={queryClient}><AppContent /></QueryClientProvider>; }
