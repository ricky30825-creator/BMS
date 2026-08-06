import { useEffect, useRef, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, CircleAlert, LoaderCircle, X } from "lucide-react";
import { format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";
import { ko } from "date-fns/locale";
import type { Grade, MetricStatus } from "../types";

export const gradeLabels: Record<Grade, string> = { NORMAL: "정상", CAUTION: "주의", WARNING: "경고", DANGER: "위험" };
export const gradeShapes: Record<Grade, string> = { NORMAL: "circle", CAUTION: "diamond", WARNING: "triangle", DANGER: "square" };
export const gradeClass: Record<Grade, string> = { NORMAL: "grade-normal", CAUTION: "grade-caution", WARNING: "grade-warning", DANGER: "grade-danger" };

export function score100(score: number | null | undefined): string {
  return score == null || Number.isNaN(score) ? "—" : String(Math.round(score * 100));
}

export function formatDateTime(value: string | null | undefined, withSeconds = false): string {
  if (!value) return "—";
  const parsed = parseISO(value);
  if (!isValid(parsed)) return "—";
  return format(parsed, withSeconds ? "yyyy.MM.dd HH:mm:ss" : "yyyy.MM.dd HH:mm", { locale: ko });
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = parseISO(value);
  return isValid(parsed) ? format(parsed, "HH:mm:ss") : "—";
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = parseISO(value);
  return isValid(parsed) ? formatDistanceToNowStrict(parsed, { addSuffix: true, locale: ko }) : "—";
}

export function StatusBadge({ grade, score, compact = false }: { grade: Grade; score?: number | null; compact?: boolean }) {
  return <span className={`status-badge ${gradeClass[grade]} ${compact ? "compact" : ""}`} aria-label={`${gradeLabels[grade]} ${score100(score)}`}>
    <span className={`grade-shape ${gradeShapes[grade]}`} aria-hidden="true" />
    <span>{gradeLabels[grade]}</span>
    {score !== undefined && <strong className="mono">{score100(score)}</strong>}
  </span>;
}

export function MetricStatusBadge({ status }: { status: MetricStatus }) {
  if (!status) return null;
  const labels: Record<Exclude<MetricStatus, null>, string> = { OK: "정상", WARN: "경고", CRIT: "위험" };
  return <span className={`metric-status metric-${status.toLowerCase()}`}><span className="status-dot" />{labels[status]}</span>;
}

export function Logo({ inverse = false }: { inverse?: boolean }) {
  return <div className={`logo ${inverse ? "logo-inverse" : ""}`}><span className="logo-mark" aria-hidden="true">⌁</span><span>셀가드</span></div>;
}

export function Button({ children, variant = "secondary", type = "button", disabled, loading, onClick, className = "", title }: {
  children: ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger" | "danger-outline"; type?: "button" | "submit" | "reset"; disabled?: boolean; loading?: boolean; onClick?: () => void; className?: string; title?: string;
}) {
  return <button type={type} className={`button button-${variant} ${className}`} disabled={disabled || loading} onClick={onClick} title={title}>
    {loading && <LoaderCircle size={16} className="spin" aria-hidden="true" />}{children}
  </button>;
}

export function Card({ children, className = "", as: Tag = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <Tag className={`card ${className}`}>{children}</Tag>;
}

export function PageHeading({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</div>;
}

export function Modal({ title, description, children, onClose, wide = false }: { title: string; description?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = panel.current?.querySelector<HTMLElement>("button, input, select, textarea, [tabindex]:not([tabindex='-1'])");
    focusable?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((item) => !item.hasAttribute("disabled"));
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`modal-panel ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={panel}>
      <div className="modal-heading"><div><h2 id="modal-title">{title}</h2>{description && <p>{description}</p>}</div><button className="icon-button" onClick={onClose} aria-label="닫기"><X size={18} /></button></div>
      {children}
    </div>
  </div>;
}

export function Tabs({ items, value, onChange }: { items: Array<{ value: string; label: string }>; value: string; onChange: (value: string) => void }) {
  return <div className="tabs" role="tablist">{items.map((item) => <button key={item.value} role="tab" aria-selected={value === item.value} className={value === item.value ? "active" : ""} onClick={() => onChange(item.value)}>{item.label}</button>)}</div>;
}

export function TableState({ state, message = "데이터를 불러오는 중입니다." }: { state: "loading" | "error" | "empty"; message?: string }) {
  if (state === "loading") return <div className="table-state"><LoaderCircle className="spin" size={22} /><span>{message}</span></div>;
  if (state === "error") return <div className="table-state table-state-error"><CircleAlert size={22} /><span>{message}</span></div>;
  return <div className="table-state"><span>{message}</span></div>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Check size={22} /></div><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>;
}

export function Pagination({ page, onChange }: { page: { number: number; totalPages: number }; onChange: (page: number) => void }) {
  if (page.totalPages <= 1) return null;
  return <div className="pagination"><Button variant="ghost" onClick={() => onChange(Math.max(1, page.number - 1))} disabled={page.number <= 1} title="이전"><ChevronLeft size={16} /></Button><span className="mono">{page.number} / {page.totalPages}</span><Button variant="ghost" onClick={() => onChange(Math.min(page.totalPages, page.number + 1))} disabled={page.number >= page.totalPages} title="다음"><ChevronRight size={16} /></Button></div>;
}

export function Field({ label, error, children, hint }: { label: string; error?: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}{error && <span className="field-error">{error}</span>}</label>;
}
