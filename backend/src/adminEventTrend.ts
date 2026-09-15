import type { EventTrendPeriod } from "./store.js";

export const ADMIN_EVENT_TREND_PERIODS = ["24h", "7d", "30d"] as const satisfies readonly EventTrendPeriod[];
export const DEFAULT_ADMIN_EVENT_TREND_PERIOD: EventTrendPeriod = "7d";

/**
 * Parse the public event-trend query parameter at the HTTP boundary.
 *
 * F20 defaults to the 7-day view (the initial administrator dashboard view),
 * while an explicitly supplied empty/unknown/repeated value is invalid. This
 * keeps the store contract strict and prevents a malformed request from being
 * silently converted into a different period.
 */
export function parseAdminEventTrendPeriod(value: unknown): EventTrendPeriod | null {
  if (value === undefined) return DEFAULT_ADMIN_EVENT_TREND_PERIOD;
  if (typeof value !== "string") return null;
  return (ADMIN_EVENT_TREND_PERIODS as readonly string[]).includes(value)
    ? value as EventTrendPeriod
    : null;
}
