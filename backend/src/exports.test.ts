import { describe, expect, it } from "vitest";
import { batteryById, startSession } from "./store.js";
import { completeExportJob, createExportJob, exportJobById, signDownload, verifyDownload } from "./exports.js";

describe("createExportJob", () => {
  it("rejects an unknown session", async () => {
    await expect(createExportJob("hong", "does-not-exist", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z")).rejects.toThrow("NOT_FOUND");
  });

  it("rejects a session owned by someone else", async () => {
    const session = await startSession("hong", "DEMO-PACK-001");
    await expect(createExportJob("kimeng", session.id, "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z")).rejects.toThrow("NOT_FOUND");
  });

  it("rejects an inverted or invalid range", async () => {
    const session = await startSession("hong", "DEMO-PACK-001");
    await expect(createExportJob("hong", session.id, "2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z")).rejects.toThrow("VALIDATION_FAILED");
    await expect(createExportJob("hong", session.id, "not-a-date", "2026-01-01T00:00:00Z")).rejects.toThrow("VALIDATION_FAILED");
  });

  it("creates a QUEUED job for a valid request", async () => {
    const session = await startSession("hong", "DEMO-PACK-001");
    const job = await createExportJob("hong", session.id, "2020-01-01T00:00:00Z", "2030-01-01T00:00:00Z");
    expect(job.status).toBe("QUEUED");
    expect(job.kind).toBe("RAW_METRICS_CSV");
    expect(exportJobById(job.id)).toEqual(job);
  });
});

describe("completeExportJob", () => {
  it("produces a 1-row CSV when the battery's latest reading falls inside the range", async () => {
    const session = await startSession("hong", "DEMO-PACK-001");
    const battery = (await batteryById("DEMO-PACK-001"))!;
    const from = new Date(Date.parse(battery.latest.measuredAt) - 1000).toISOString();
    const to = new Date(Date.parse(battery.latest.measuredAt) + 1000).toISOString();
    const job = await createExportJob("hong", session.id, from, to);
    const ready = (await completeExportJob(job.id))!;
    expect(ready.status).toBe("READY");
    expect(ready.rowCount).toBe(1);
    expect(ready.csv).toContain("measured_at,device_id,battery_id");
    expect(ready.sha256).toHaveLength(64);
    expect(ready.expiresAt).not.toBeNull();
  });

  it("produces a 0-row CSV when the range excludes the only stored reading", async () => {
    const session = await startSession("hong", "DEMO-PACK-001");
    const job = await createExportJob("hong", session.id, "2000-01-01T00:00:00Z", "2000-01-02T00:00:00Z");
    const ready = (await completeExportJob(job.id))!;
    expect(ready.status).toBe("READY");
    expect(ready.rowCount).toBe(0);
  });
});

describe("download signing", () => {
  it("verifies a token signed for the same id/expiry and rejects tampering or expiry", () => {
    const expiresAtMs = Date.now() + 60_000;
    const token = signDownload("exp_1", expiresAtMs);
    expect(verifyDownload("exp_1", expiresAtMs, token)).toBe(true);
    expect(verifyDownload("exp_1", expiresAtMs, "wrong")).toBe(false);
    expect(verifyDownload("exp_1", Date.now() - 1, token)).toBe(false);
  });
});
