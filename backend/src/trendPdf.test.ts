import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderTrendPdf, safeFilenameSegment } from "./trendPdf.js";
import type { TrendMetric, TrendResponse } from "./store/types.js";

const POPPLER_AVAILABLE = ["pdfinfo", "pdftotext", "pdftoppm"].every((command) =>
  spawnSync(command, ["-v"], { stdio: "ignore" }).status === 0,
);

const metrics: TrendMetric[] = ["volt", "curr", "temp", "soc", "anomaly"];
const report: TrendResponse = {
  period: "7d",
  buckets: ["2026-09-14T00:00:00.000Z", "2026-09-15T00:00:00.000Z"],
  series: metrics.map((metric) => ({
    batteryId: "pack-unsafe",
    batteryLabel: "<script>alert(1)</script> 아주 긴 배터리 이름",
    metric,
    unit: metric === "volt" ? "V" : metric === "curr" ? "A" : metric === "temp" ? "°C" : metric === "soc" ? "%" : "score",
    points: metric === "volt" ? [3.7, 3.9] : metric === "curr" ? [1.2, -0.4] : metric === "temp" ? [41.25, null] : metric === "soc" ? [80, 81] : [0.12, 0.91],
  })),
};

function inspectWithPoppler(pdf: Buffer): { text: string; pages: number; renderedPage: Buffer } {
  const directory = mkdtempSync(join(tmpdir(), "cellguard-trend-pdf-"));
  const pdfPath = join(directory, "report.pdf");
  const renderPrefix = join(directory, "page");
  try {
    writeFileSync(pdfPath, pdf);
    const text = execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8" });
    const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
    execFileSync("pdftoppm", ["-f", "1", "-l", "1", "-png", pdfPath, renderPrefix], { encoding: "utf8" });
    const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0);
    return { text, pages, renderedPage: readFileSync(`${renderPrefix}-1.png`) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("trend PDF export", () => {
  it("returns an in-memory PDF with Korean text, table pages, and safe labels", async () => {
    const pdf = await renderTrendPdf(report, ["pack-unsafe"], metrics, new Date("2026-09-15T12:34:56.000Z"));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1_000);
    const safe = safeFilenameSegment("../../<script> pack/1");
    expect(safe).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(safe).not.toContain("/");
    if (!POPPLER_AVAILABLE) return;
    const inspected = inspectWithPoppler(pdf);
    expect(inspected.pages).toBe(2);
    expect(inspected.text).toContain("CellGuard 추세 보고서");
    expect(inspected.text).toContain("대표 온도");
    expect(inspected.renderedPage.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  it("keeps an empty report valid and explicitly marks missing data", async () => {
    const empty: TrendResponse = { period: "24h", buckets: [], series: [] };
    const pdf = await renderTrendPdf(empty, [], metrics, new Date("2026-09-15T12:34:56.000Z"));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    if (!POPPLER_AVAILABLE) return;
    const inspected = inspectWithPoppler(pdf);
    expect(inspected.pages).toBe(2);
    expect(inspected.text).toContain("no data");
  });
});
