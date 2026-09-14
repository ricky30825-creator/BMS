import { createHash, createHmac, randomUUID } from "node:crypto";
import { batteryById, csvForBattery, sessionById } from "./store.js";
import { env } from "./config/env.js";

export type ExportStatus = "QUEUED" | "RUNNING" | "READY" | "FAILED" | "EXPIRED";

export type ExportJob = {
  id: string;
  ownerId: string;
  sessionId: string;
  batteryId: string;
  kind: "RAW_METRICS_CSV";
  from: string;
  to: string;
  status: ExportStatus;
  csv: string | null;
  sha256: string | null;
  rowCount: number | null;
  expiresAt: string | null;
  createdAt: string;
};

const jobs = new Map<string, ExportJob>();
const READY_DELAY_MS = 300;
const DOWNLOAD_TTL_MS = 10 * 60 * 1000;

function isoNow(): string {
  return new Date().toISOString();
}

export async function createExportJob(ownerId: string, sessionId: string, from: string, to: string): Promise<ExportJob> {
  const session = await sessionById(sessionId);
  if (!session || session.ownerId !== ownerId) throw new Error("NOT_FOUND");
  const battery = await batteryById(session.batteryId);
  if (!battery) throw new Error("NOT_FOUND");
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs >= toMs) throw new Error("VALIDATION_FAILED");
  const job: ExportJob = {
    id: `exp_${randomUUID()}`,
    ownerId,
    sessionId,
    batteryId: battery.id,
    kind: "RAW_METRICS_CSV",
    from,
    to,
    status: "QUEUED",
    csv: null,
    sha256: null,
    rowCount: null,
    expiresAt: null,
    createdAt: isoNow()
  };
  jobs.set(job.id, job);
  return { ...job };
}

export function exportJobById(id: string): ExportJob | undefined {
  const job = jobs.get(id);
  return job ? { ...job } : undefined;
}

export async function completeExportJob(id: string): Promise<ExportJob | undefined> {
  const job = jobs.get(id);
  if (!job) return undefined;
  if (job.status !== "QUEUED") return { ...job };
  const battery = await batteryById(job.batteryId);
  if (!battery) {
    job.status = "FAILED";
    return { ...job };
  }
  const csv = await csvForBattery(job.batteryId, job.sessionId, job.from, job.to);
  job.csv = csv;
  job.rowCount = Math.max(0, csv.trimEnd().split("\n").length - 1);
  job.sha256 = createHash("sha256").update(csv).digest("hex");
  job.status = "READY";
  job.expiresAt = new Date(Date.now() + DOWNLOAD_TTL_MS).toISOString();
  return { ...job };
}

export function scheduleExportCompletion(id: string, onReady: (job: ExportJob) => void): void {
  setTimeout(() => {
    void completeExportJob(id)
      .then((job) => {
        if (job && job.status === "READY") return onReady(job);
        return undefined;
      })
      .catch((error) => {
        console.error("export job failed", error);
      });
  }, READY_DELAY_MS);
}

export function signDownload(id: string, expiresAtMs: number): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(`${id}:${expiresAtMs}`).digest("hex");
}

export function verifyDownload(id: string, expiresAtMs: number, token: string): boolean {
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return false;
  return signDownload(id, expiresAtMs) === token;
}
