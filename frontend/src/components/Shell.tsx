import { useEffect, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Bell, Battery, ChartLine, ClipboardList, Gauge, LayoutDashboard, LogOut, Menu, Moon, Settings, ShieldCheck, Siren, Sun, Users, X } from "lucide-react";
import type { MeResponse } from "../types";
import { Logo } from "./ui";

type NavItem = { path: string; label: string; icon: typeof LayoutDashboard; badge?: number };
const userNav: NavItem[] = [
  { path: "/dashboard", label: "대시보드", icon: LayoutDashboard },
  { path: "/battery", label: "배터리 관리", icon: Battery },
  { path: "/anomaly", label: "이상 탐지", icon: Gauge },
  { path: "/trend", label: "추세 차트", icon: ChartLine },
  { path: "/events", label: "이벤트 이력", icon: ClipboardList },
  { path: "/alertHistory", label: "알림 센터", icon: Bell },
  { path: "/notices", label: "공지사항", icon: Siren },
  { path: "/powerbankDiag", label: "보조배터리 진단", icon: Battery },
  { path: "/relay", label: "릴레이 제어", icon: ShieldCheck },
  { path: "/settings", label: "설정", icon: Settings },
];
const adminNav: NavItem[] = [
  { path: "/admin", label: "관리자 대시보드", icon: LayoutDashboard },
  { path: "/adminUsers", label: "유저 관리", icon: Users },
  { path: "/adminBattery", label: "배터리 운영 관리", icon: Battery },
  { path: "/adminNotice", label: "공지사항 관리", icon: Siren },
  { path: "/adminEventTrend", label: "이벤트 추이", icon: ChartLine },
  { path: "/adminAudit", label: "감사 로그", icon: ClipboardList },
];

export function AppShell({ me, onLogout, onTheme, children }: { me: MeResponse; onLogout: () => Promise<void>; onTheme: (theme: "light" | "dark" | "system") => void; children?: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const isAdmin = me.user?.role === "ADMIN";
  const preferences = me.preferences ?? { theme: "light" as const, lang: "ko" as const };
  const connected = Boolean(me.activeSession);
  const nav = isAdmin ? adminNav : userNav.map((item) => ({ ...item,
    badge: item.path === "/alertHistory" ? me.unreadAlertCount : item.path === "/anomaly" ? me.activeAnomalyCount : undefined,
  }));
  const locked = !isAdmin && !connected;
  const isActive = (path: string) => location.pathname === path || (path === "/battery" && location.pathname.startsWith("/battery/"));
  const showNotice = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 3200); };

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const go = (item: NavItem) => {
    if (locked && item.path !== "/battery") { showNotice("먼저 배터리를 연결하면 이 화면을 사용할 수 있습니다."); return; }
    navigate(item.path);
  };

  const navContent = <>
    <div className="shell-brand"><Logo /><span className="environment-tag">{isAdmin ? "ADMIN" : "USER"}</span></div>
    <nav className="side-nav" aria-label="주 메뉴">{nav.map((item) => { const Icon = item.icon; const itemLocked = locked && item.path !== "/battery"; return <button key={item.path} className={`nav-item ${isActive(item.path) ? "active" : ""} ${itemLocked ? "locked" : ""}`} onClick={() => go(item)} aria-disabled={itemLocked} title={itemLocked ? "배터리를 연결하세요" : item.label}><Icon size={18} /><span>{item.label}</span>{itemLocked ? <ShieldCheck size={14} className="nav-lock" aria-label="잠김" /> : item.badge ? <span className="nav-badge">{item.badge}</span> : null}</button>; })}</nav>
    <div className="shell-bottom">
      <div className="account-chip"><span className="avatar">{(me.user?.name ?? "?").slice(0, 1)}</span><span className="account-copy"><strong>{me.user?.name ?? "사용자"}</strong><small>{me.user?.email}</small></span></div>
      <button className="nav-item" onClick={() => { void onLogout(); }}><LogOut size={18} /><span>로그아웃</span></button>
    </div>
  </>;

  return <div className="app-shell">
    <aside className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}>{navContent}<button className="collapse-button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}>{collapsed ? <Menu size={18} /> : <X size={18} />}</button></aside>
    {mobileOpen && <button className="mobile-scrim" aria-label="메뉴 닫기" onClick={() => setMobileOpen(false)} />}
    <main className="main-column"><header className="topbar"><button className="mobile-menu-button icon-button" onClick={() => setMobileOpen(true)} aria-label="메뉴 열기"><Menu size={20} /></button><div className="topbar-context"><span className="topbar-title">셀가드</span><span className="topbar-separator">/</span><span>{isAdmin ? "운영 콘솔" : "배터리 안전 관제"}</span></div><div className="topbar-actions"><span className="connection-pill"><span className={`connection-dot ${connected ? "online" : "offline"}`} />{connected ? "세션 연결됨" : "배터리 미연결"}</span><button className="icon-button" onClick={() => onTheme(preferences.theme === "dark" ? "light" : "dark")} aria-label="테마 전환">{preferences.theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button><Link className="icon-button" to="/settings" aria-label="설정"><Settings size={18} /></Link></div></header><div className="content-area">{children ?? <Outlet />}</div></main>
    <nav className="mobile-nav" aria-label="모바일 메뉴">{nav.slice(0, 5).map((item) => { const Icon = item.icon; return <button key={item.path} className={isActive(item.path) ? "active" : ""} onClick={() => go(item)}><Icon size={18} /><span>{item.label}</span></button>; })}</nav>
    {notice && <div className="toast" role="status">{notice}</div>}
  </div>;
}

export function PublicHeader({ onLogin, onSignUp }: { onLogin: () => void; onSignUp: () => void }) {
  return <header className="public-header"><Link to="/"><Logo /></Link><div className="public-actions"><button className="button button-ghost" onClick={onLogin}>로그인</button><button className="button button-primary" onClick={onSignUp}>무료로 시작하기</button></div></header>;
}
