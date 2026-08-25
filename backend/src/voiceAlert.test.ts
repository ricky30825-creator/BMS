import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE_ALERT_SETTINGS, applyVoiceAlertPatch } from "./voiceAlert.js";

describe("applyVoiceAlertPatch", () => {
  it("merges a partial patch onto the current settings and stamps updatedAt", () => {
    const before = { ...DEFAULT_VOICE_ALERT_SETTINGS, updatedAt: "2026-01-01T00:00:00.000Z" };
    const next = applyVoiceAlertPatch(before, { enabled: false, volume: 40 });
    expect(next.enabled).toBe(false);
    expect(next.volume).toBe(40);
    expect(next.connectionEnabled).toBe(before.connectionEnabled);
    expect(next.updatedAt).not.toBe(before.updatedAt);
  });

  it("rejects a volume outside 0-100", () => {
    expect(() => applyVoiceAlertPatch(DEFAULT_VOICE_ALERT_SETTINGS, { volume: 140 })).toThrow("VALIDATION_FAILED");
    expect(() => applyVoiceAlertPatch(DEFAULT_VOICE_ALERT_SETTINGS, { volume: -1 })).toThrow("VALIDATION_FAILED");
  });

  it("rejects a non-boolean toggle field", () => {
    expect(() => applyVoiceAlertPatch(DEFAULT_VOICE_ALERT_SETTINGS, { anomalyEnabled: "yes" })).toThrow("VALIDATION_FAILED");
  });

  it("rejects unknown fields", () => {
    expect(() => applyVoiceAlertPatch(DEFAULT_VOICE_ALERT_SETTINGS, { language: "en" })).toThrow("VALIDATION_FAILED");
  });

  it("keeps every toggle/volume field unchanged when the patch is empty", () => {
    const before = { ...DEFAULT_VOICE_ALERT_SETTINGS, updatedAt: "2026-01-01T00:00:00.000Z" };
    const next = applyVoiceAlertPatch(before, {});
    const { updatedAt: _before, ...beforeRest } = before;
    const { updatedAt: _next, ...nextRest } = next;
    expect(nextRest).toEqual(beforeRest);
  });
});
