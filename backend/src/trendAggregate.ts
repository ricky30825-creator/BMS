import type { EventTrendPeriod, TrendMetric, TrendResponse, TrendSeries } from "./store/types.js";

export type TrendWindow = {
  count: number;
  stepMs: number;
  startMs: number;
  endExclusiveMs: number;
};

export const TREND_PERIODS = ["24h", "7d", "30d"] as const satisfies readonly EventTrendPeriod[];
export const PHYSICAL_TREND_METRICS = ["volt", "curr", "temp", "soc"] as const satisfies readonly TrendMetric[];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Return the UTC bucket window shared by PostgreSQL and memory providers.
 * 24h deliberately contains the current bucket plus the preceding 24 hourly
 * buckets, matching the public contract's 25-point series.
 */
export function trendWindow(period: EventTrendPeriod, now = Date.now()): TrendWindow {
  const count = period === "24h" ? 25 : period === "7d" ? 7 : period === "30d" ? 30 : 0;
  if (!count || !Number.isFinite(now)) throw new Error("VALIDATION_FAILED");
  const current = new Date(now);
  const endBucketMs = period === "24h"
    ? Math.floor(now / HOUR_MS) * HOUR_MS
    : Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate());
  const stepMs = period === "24h" ? HOUR_MS : DAY_MS;
  return {
    count,
    stepMs,
    startMs: endBucketMs - (count - 1) * stepMs,
    endExclusiveMs: endBucketMs + stepMs,
  };
}

export function trendBuckets(period: EventTrendPeriod, now = Date.now()): string[] {
  const window = trendWindow(period, now);
  return Array.from({ length: window.count }, (_, index) => new Date(window.startMs + index * window.stepMs).toISOString());
}

export function trendMetricUnit(metric: TrendMetric): string {
  switch (metric) {
    case "volt": return "V";
    case "curr": return "A";
    case "temp": return "°C";
    case "soc": return "%";
    case "anomaly": return "score";
  }
}

export function emptyTrendResponse(
  batteryIds: readonly string[],
  batteryLabels: ReadonlyMap<string, string>,
  period: EventTrendPeriod,
  metrics: readonly TrendMetric[],
  now = Date.now(),
): TrendResponse {
  const buckets = trendBuckets(period, now);
  const series: TrendSeries[] = [];
  for (const batteryId of batteryIds) {
    for (const metric of metrics) {
      series.push({
        batteryId,
        batteryLabel: batteryLabels.get(batteryId) ?? batteryId,
        metric,
        unit: trendMetricUnit(metric),
        points: Array<number | null>(buckets.length).fill(null),
      });
    }
  }
  return { period, buckets, series };
}

export function bucketIndex(at: string | number | Date, window: TrendWindow): number {
  const timestamp = at instanceof Date ? at.getTime() : typeof at === "number" ? at : Date.parse(at);
  if (!Number.isFinite(timestamp)) return -1;
  const index = Math.floor((timestamp - window.startMs) / window.stepMs);
  return index >= 0 && index < window.count ? index : -1;
}
