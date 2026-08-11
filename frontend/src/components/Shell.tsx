import { useEffect, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Bell, Battery, ChartLine, ClipboardList, Gauge, Globe2, LayoutDashboard, LogOut, Menu, Moon, Settings, ShieldCheck, Siren, Sun, Users, X } from "lucide-react";
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

const pageMeta: Record<string, [string, string]> = {
  "/dashboard": ["실시간 관제", "PACK-001 · 세션 진행 중"],
  "/battery": ["배터리 관리", "저장된 배터리 선택 · 새 배터리 등록"],
  "/anomaly": ["이상 탐지 관리", "AI 이상점수 · 위험도 분포"],
  "/trend": ["추세 차트", "기간·지표별 시계열 조회"],
  "/events": ["이벤트 이력", "이상 이벤트 목록 및 상세"],
  "/alertHistory": ["알림 센터", "인앱·카카오 알림 이력"],
  "/notices": ["공지사항", "서비스 소식과 점검 안내"],
  "/powerbankDiag": ["보조배터리 진단", "모드 2 · 열화 진단과 안전 상태"],
  "/relay": ["릴레이 제어 · Kill-Switch", "원격 차단·복구와 Fail-Safe 상태"],
  "/settings": ["설정", "알림 수신 · 계정 정보 · 테마"],
  "/admin": ["관리자 대시보드", "전체 운영 현황과 위험 이벤트"],
  "/adminUsers": ["유저 계정 관리", "계정 상태와 등록 배터리"],
  "/adminBattery": ["배터리 운영 관리", "운영 상태와 관리자 메모"],
  "/adminNotice": ["공지사항 관리", "공지 작성·게시·보관"],
  "/adminEventTrend": ["이벤트 추이", "기간별 이상 이벤트 발생량"],
  "/adminAudit": ["감사 로그", "관리자 조작과 안전 제어 기록"],
};

export function AppShell({ me, onLogout, onTheme, children }: { me: MeResponse; onLogout: () => Promise<void>; onTheme: (theme: "light" | "dark" | "system") => void; children?: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [notificationOpen, setNotificationOpen] = useState(false);
  const isAdmin = me.user?.role === "ADMIN";
  const preferences = me.preferences ?? { theme: "light" as const, lang: "ko" as const };
  const connected = Boolean(me.activeSession);
  const nav = isAdmin ? adminNav : userNav.map((item) => ({ ...item,
    badge: item.path === "/alertHistory" ? me.unreadAlertCount : item.path === "/anomaly" ? me.activeAnomalyCount : undefined,
  }));
  const locked = !isAdmin && !connected;
  const isActive = (path: string) => location.pathname === path || (path === "/battery" && location.pathname.startsWith("/battery/"));
  const showNotice = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 3200); };

  useEffect(() => {
    setMobileOpen(false);
    setNotificationOpen(false);
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.pathname]);

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

  const [pageTitle, pageSub] = pageMeta[location.pathname] ?? [isAdmin ? "운영 콘솔" : "배터리 안전 관제", ""];

  return <div className="app-shell">
    <aside className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}>{navContent}<button className="collapse-button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}>{collapsed ? <Menu size={18} /> : <X size={18} />}</button></aside>
    {mobileOpen && <button className="mobile-scrim" aria-label="메뉴 닫기" onClick={() => setMobileOpen(false)} />}
    <main className="main-column"><header className="topbar"><button className="mobile-menu-button icon-button" onClick={() => setMobileOpen(true)} aria-label="메뉴 열기"><Menu size={20} /></button><div className="topbar-context"><strong className="topbar-title">{pageTitle}</strong><span className="topbar-subtitle">{pageSub}</span></div><div className="topbar-actions"><span className="connection-pill"><span className={`connection-dot ${connected ? "online" : "offline"}`} />{connected ? "연결됨 · 측정 중" : "배터리 미연결"}</span><div className="notification-control"><button className="icon-button" onClick={() => setNotificationOpen((value) => !value)} aria-label="알림 열기" aria-expanded={notificationOpen}><Bell size={18} />{me.unreadAlertCount > 0 && <span className="notification-dot" />}</button>{notificationOpen && <div className="notification-popover"><div className="notification-head"><strong>알림 센터</strong><span>{me.unreadAlertCount} 미확인</span></div><div className="notification-item danger"><span className="notification-icon"><Siren size={15} /></span><span><strong>온도 임계값 초과</strong><small>PACK-001 · 방금 전</small></span></div><div className="notification-item warning"><span className="notification-icon"><Gauge size={15} /></span><span><strong>이상점수 상승</strong><small>PACK-004 · 8분 전</small></span></div><button className="notification-more" onClick={() => navigate("/alertHistory")}>알림 센터 전체 보기</button></div>}</div><button className="language-button" onClick={() => showNotice("언어 전환은 준비 중입니다.")} aria-label="언어 전환"><Globe2 size={15} />한</button><button className="icon-button theme-button" onClick={() => onTheme(preferences.theme === "dark" ? "light" : "dark")} aria-label="테마 전환">{preferences.theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button><Link className="icon-button" to="/settings" aria-label="설정"><Settings size={18} /></Link><button className="topbar-logout" onClick={() => { void onLogout(); }}>로그아웃</button></div></header><div className="content-area">{children ?? <Outlet />}</div></main>
    <nav className="mobile-nav" aria-label="모바일 메뉴">{nav.slice(0, 5).map((item) => { const Icon = item.icon; return <button key={item.path} className={isActive(item.path) ? "active" : ""} onClick={() => go(item)}><Icon size={18} /><span>{item.label}</span></button>; })}</nav>
    {notice && <div className="toast" role="status">{notice}</div>}
  </div>;
}

export function PublicHeader({ onLogin, onSignUp }: { onLogin: () => void; onSignUp: () => void }) {
  return <header className="public-header"><Link to="/"><Logo /></Link><nav className="public-nav" aria-label="소개 메뉴"><a href="#preview">제품</a><a href="#how">작동 방식</a><a href="#preview">실시간 관제</a><a href="#preview">AI 이상탐지</a></nav><div className="public-actions"><button className="button button-ghost" onClick={onLogin}>로그인</button><button className="button button-primary" onClick={onSignUp}>무료로 시작</button></div></header>;
}
