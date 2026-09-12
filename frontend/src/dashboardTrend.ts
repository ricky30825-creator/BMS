import type { Dashboard, DashboardMetrics } from "./types";
import type { DashboardMetricParam } from "./api/normalize";

export const DASHBOARD_TREND_WINDOW = 24;

type TrendPoint = NonNullable<Dashboard["quickTrend"]>["points"][number];

function metricValue(metrics: DashboardMetrics, metric: DashboardMetricParam): number | null {
  return metric === "volt"
    ? metrics.voltageV.value
    : metric === "curr"
      ? metrics.currentA.value
      : metric === "soc"
        ? metrics.socPct.value
        : metrics.representativeTempC.value;
}

function isAfterSessionStart(at: string, startedAt: string | null | undefined): boolean {
  if (!startedAt) return true;
  const startedMs = Date.parse(startedAt);
  const pointMs = Date.parse(at);
  return !Number.isFinite(startedMs) || !Number.isFinite(pointMs) || pointMs > startedMs;
}

export function sessionTrendPoints(points: TrendPoint[] | undefined, startedAt: string | null | undefined): TrendPoint[] {
  return (points ?? []).filter((point) => isAfterSessionStart(point.at, startedAt));
}

export function rightAlignTrend(points: TrendPoint[] | undefined, startedAt: string | null | undefined): TrendPoint[] {
  const visible = sessionTrendPoints(points, startedAt).slice(-DASHBOARD_TREND_WINDOW);
  if (!visible.length) return [];
  return [
    ...Array.from({ length: DASHBOARD_TREND_WINDOW - visible.length }, () => ({ at: "", value: null })),
    ...visible,
  ];
}

export function appendDashboardTrendPoint(
  current: Dashboard["quickTrend"],
  metrics: DashboardMetrics,
  preferredMetric: DashboardMetricParam | undefined,
  startedAt: string | null | undefined,
): Dashboard["quickTrend"] {
  if (!metrics.measuredAt) return current;
  const metric = current?.metric ?? preferredMetric ?? "temp";
  const nextPoint: TrendPoint = { at: metrics.measuredAt, value: metricValue(metrics, metric) };
  const previous = sessionTrendPoints(current?.points, startedAt);
  const points = previous.some((point) => point.at === nextPoint.at)
    ? previous.map((point) => point.at === nextPoint.at ? nextPoint : point)
    : [...previous, nextPoint];
  return { metric, points: points.slice(-DASHBOARD_TREND_WINDOW) };
}
