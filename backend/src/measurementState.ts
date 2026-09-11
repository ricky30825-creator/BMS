export type MeasurementPhase = "WAITING_FOR_MEASUREMENT" | "MEASURING";

/**
 * A session is not evidence that a device is sending data. The first sensor
 * frame for this session is the first measurement strictly after startedAt.
 */
export function measurementPhaseFor(startedAt: string, measuredAt: string | null | undefined): MeasurementPhase {
  const startedMs = Date.parse(startedAt);
  const measuredMs = measuredAt == null ? Number.NaN : Date.parse(measuredAt);
  return Number.isFinite(startedMs) && Number.isFinite(measuredMs) && measuredMs > startedMs
    ? "MEASURING"
    : "WAITING_FOR_MEASUREMENT";
}
