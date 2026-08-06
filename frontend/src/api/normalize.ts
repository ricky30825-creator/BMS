import type { Battery, Dashboard, DashboardMetrics, Grade, LatestMetric, MetricStatus, Relay } from "../types";

export function gradeFromScore(score: number): Grade {
  if (score < 0.3) return "NORMAL";
  if (score < 0.6) return "CAUTION";
  if (score < 0.8) return "WARNING";
  return "DANGER";
}

function metric(value: number | null, status: MetricStatus = null) {
  return { value, status };
}

type RawBattery = Omit<Partial<Battery>, "latest"> & { latest?: Partial<LatestMetric> & { grade?: Grade } | null };

export function normalizeBattery(raw: RawBattery): Battery {
  const latest = raw.latest ? { ...raw.latest } : null;
  if (!latest) return { ...raw, latest: null, id: raw.id ?? "", label: raw.label ?? "", chemistry: raw.chemistry ?? "LI_ION", seriesCount: raw.seriesCount ?? null, maker: raw.maker ?? null, model: raw.model ?? null, targetMode: raw.targetMode ?? 1, capacityWh: raw.capacityWh ?? null, ratedOutputCurrentA: raw.ratedOutputCurrentA ?? null, opsStatus: raw.opsStatus ?? "NORMAL", health: raw.health ?? null };
  const score = typeof latest.score === "number" ? latest.score : 0;
  const normalizedLatest: LatestMetric = {
    score,
    grade: latest.grade ?? gradeFromScore(score),
    voltageV: latest.voltageV ?? null,
    currentA: latest.currentA ?? null,
    powerW: latest.powerW ?? null,
    representativeTempC: latest.representativeTempC ?? null,
    representativeTempSource: latest.representativeTempSource ?? null,
    tempContact: latest.tempContact ?? null,
    tempIrSurface: latest.tempIrSurface ?? null,
    socPct: latest.socPct ?? null,
    socBasis: latest.socBasis ?? null,
    measuredAt: latest.measuredAt ?? null,
  };
  return {
    id: raw.id ?? "", label: raw.label ?? "", chemistry: raw.chemistry ?? "LI_ION", seriesCount: raw.seriesCount ?? null,
    maker: raw.maker ?? null, model: raw.model ?? null, targetMode: raw.targetMode ?? 1, hardwareProfile: raw.hardwareProfile,
    capacityWh: raw.capacityWh ?? null, ratedOutputCurrentA: raw.ratedOutputCurrentA ?? null, opsStatus: raw.opsStatus ?? "NORMAL",
    memo: raw.memo ?? null, adminMemo: raw.adminMemo, version: raw.version, isConnected: raw.isConnected,
    latest: normalizedLatest, health: raw.health ?? null, diagnosisCapability: raw.diagnosisCapability,
  };
}

export function normalizeDashboard(raw: Record<string, unknown>): Dashboard {
  const rawBattery = raw.battery as Partial<Battery> & { latest?: Partial<LatestMetric> | null };
  const battery = normalizeBattery(rawBattery);
  const rawMetrics = (raw.metrics ?? {}) as Partial<DashboardMetrics> & Partial<LatestMetric>;
  const value = (key: keyof LatestMetric): number | null => {
    const item = rawMetrics[key] as { value?: number | null } | number | null | undefined;
    return typeof item === "object" && item !== null && "value" in item ? item.value ?? null : typeof item === "number" ? item : null;
  };
  const status = (key: keyof DashboardMetrics): MetricStatus => {
    const item = rawMetrics[key] as { status?: MetricStatus } | undefined;
    return typeof item === "object" && item !== null && "status" in item ? item.status ?? null : null;
  };
  const fallback = battery.latest;
  const representativeMetric = rawMetrics.representativeTempC as ({ value?: number | null; source?: "CONTACT" | "IR_SURFACE" | null } | number | null | undefined);
  const representativeSource = typeof representativeMetric === "object" && representativeMetric !== null && "source" in representativeMetric
    ? representativeMetric.source ?? null
    : fallback?.representativeTempSource ?? null;
  const metrics: DashboardMetrics = {
    voltageV: metric(value("voltageV") ?? fallback?.voltageV ?? null, status("voltageV")),
    currentA: metric(value("currentA") ?? fallback?.currentA ?? null, status("currentA")),
    powerW: metric(value("powerW") ?? fallback?.powerW ?? null, status("powerW")),
    tempContact: metric(value("tempContact") ?? fallback?.tempContact ?? null, status("tempContact")),
    tempIrSurface: metric(value("tempIrSurface") ?? fallback?.tempIrSurface ?? null, status("tempIrSurface")),
    representativeTempC: { ...metric(value("representativeTempC") ?? fallback?.representativeTempC ?? null, status("representativeTempC")), source: representativeSource },
    socPct: metric(value("socPct") ?? fallback?.socPct ?? null, status("socPct")),
    socBasis: rawMetrics.socBasis ?? fallback?.socBasis ?? null,
    measuredAt: rawMetrics.measuredAt ?? fallback?.measuredAt ?? new Date().toISOString(),
  };
  return {
    session: raw.session as Dashboard["session"], battery, metrics,
    anomaly: (raw.anomaly as Dashboard["anomaly"] | undefined) ?? { score: fallback?.score ?? 0, grade: fallback?.grade ?? "NORMAL" },
    relay: raw.relay as Relay,
    notices: (raw.notices as Dashboard["notices"] | undefined) ?? [],
    quickTrend: raw.quickTrend as Dashboard["quickTrend"],
    snapshotCursor: String(raw.snapshotCursor ?? (raw.sync as { snapshotCursor?: string } | undefined)?.snapshotCursor ?? "0"),
  };
}
