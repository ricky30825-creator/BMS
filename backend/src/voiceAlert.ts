export type VoiceAlertSettings = {
  enabled: boolean;
  volume: number;
  connectionEnabled: boolean;
  anomalyEnabled: boolean;
  failsafeRelayEnabled: boolean;
  deviceErrorEnabled: boolean;
  networkEnabled: boolean;
  updatedAt: string;
};

export const DEFAULT_VOICE_ALERT_SETTINGS: VoiceAlertSettings = {
  enabled: true,
  volume: 70,
  connectionEnabled: true,
  anomalyEnabled: true,
  failsafeRelayEnabled: true,
  deviceErrorEnabled: true,
  networkEnabled: false,
  updatedAt: new Date(0).toISOString()
};

const BOOLEAN_FIELDS = ["enabled", "connectionEnabled", "anomalyEnabled", "failsafeRelayEnabled", "deviceErrorEnabled", "networkEnabled"] as const;
const ALLOWED_FIELDS = new Set<string>([...BOOLEAN_FIELDS, "volume"]);

function isoNow(): string {
  return new Date().toISOString();
}

export function applyVoiceAlertPatch(current: VoiceAlertSettings, patch: unknown): VoiceAlertSettings {
  const body = (patch ?? {}) as Record<string, unknown>;
  const unknown = Object.keys(body).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknown.length) throw new Error("VALIDATION_FAILED");
  for (const field of BOOLEAN_FIELDS) {
    if (body[field] !== undefined && typeof body[field] !== "boolean") throw new Error("VALIDATION_FAILED");
  }
  if (body.volume !== undefined && (typeof body.volume !== "number" || !Number.isFinite(body.volume) || body.volume < 0 || body.volume > 100)) {
    throw new Error("VALIDATION_FAILED");
  }
  const next: VoiceAlertSettings = { ...current };
  for (const field of BOOLEAN_FIELDS) {
    if (body[field] !== undefined) next[field] = body[field] as boolean;
  }
  if (body.volume !== undefined) next.volume = body.volume as number;
  next.updatedAt = isoNow();
  return next;
}
