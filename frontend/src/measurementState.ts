export type MeasurementPhase = "WAITING_FOR_MEASUREMENT" | "MEASURING";

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
