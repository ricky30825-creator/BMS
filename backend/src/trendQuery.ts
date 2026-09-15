import type { EventTrendPeriod, TrendMetric } from "./store/types.js";
import { TREND_METRICS } from "./store/types.js";
import { TREND_PERIODS } from "./trendAggregate.js";

export function parseTrendPeriod(value: unknown, required = false): EventTrendPeriod | null {
  if (value === undefined && !required) return "7d";
  return typeof value === "string" && (TREND_PERIODS as readonly string[]).includes(value)
    ? value as EventTrendPeriod
    : null;
}

/** Undefined means use the active-session default; null means malformed input. */
export function parseTrendBatteryIds(value: unknown, max = 5): string[] | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) return null;
  const ids = value.split(",").map((id) => id.normalize("NFKC").trim());
  if (ids.some((id) => id.length === 0) || ids.length > max || new Set(ids).size !== ids.length) return null;
  return ids;
}

/** Undefined means all PDF metrics; null means malformed or disallowed input. */
export function parseTrendMetrics(value: unknown, allowAnomaly = true): TrendMetric[] | null {
  if (value === undefined) return [...TREND_METRICS];
  if (typeof value !== "string" || value.length === 0) return null;
  const allowed: readonly TrendMetric[] = allowAnomaly ? TREND_METRICS : TREND_METRICS.filter((metric): metric is Exclude<TrendMetric, "anomaly"> => metric !== "anomaly");
  const metrics = value.split(",").map((metric) => metric.normalize("NFKC").trim());
  if (metrics.some((metric) => !allowed.includes(metric as TrendMetric)) || new Set(metrics).size !== metrics.length || metrics.length === 0) return null;
  return metrics as TrendMetric[];
}
