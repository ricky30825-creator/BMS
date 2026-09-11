export type MeasurementPhase = "WAITING_FOR_MEASUREMENT" | "MEASURING";

/**
 * A session is not a physical connection until the server has observed a
 * sensor frame for that session. Keep this check in one place so navigation,
 * shell chrome, and asset cards cannot drift apart.
 */
export function isMeasuringSession(session: { measurementPhase?: MeasurementPhase } | null | undefined): boolean {
  return session?.measurementPhase === "MEASURING";
}

export function measurementPhaseFor(startedAt: string | null | undefined, measuredAt: string | null | undefined): MeasurementPhase {
  const startedMs = startedAt == null ? Number.NaN : Date.parse(startedAt);
  const measuredMs = measuredAt == null ? Number.NaN : Date.parse(measuredAt);
  return Number.isFinite(startedMs) && Number.isFinite(measuredMs) && measuredMs > startedMs
    ? "MEASURING"
    : "WAITING_FOR_MEASUREMENT";
}

export function measurementPhaseLabel(phase: MeasurementPhase): "장비 연결 대기" | "연결됨 · 측정 중" {
  return phase === "MEASURING" ? "연결됨 · 측정 중" : "장비 연결 대기";
}
