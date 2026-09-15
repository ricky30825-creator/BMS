import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderTrendPdf, safeFilenameSegment } from "./trendPdf.js";
import type { TrendMetric, TrendResponse } from "./store/types.js";

const require = createRequire(import.meta.url);
const PNG = require("png-js") as new (data: Buffer) => {
  width: number;
  height: number;
  decode(callback: (pixels: Uint8Array) => void): void;
};

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

type RenderedPng = { width: number; height: number; pixels: Uint8Array };

function decodePng(data: Buffer): Promise<RenderedPng> {
  return new Promise((resolve, reject) => {
    try {
      const png = new PNG(data);
      png.decode((pixels) => resolve({ width: png.width, height: png.height, pixels }));
    } catch (error) {
      reject(error);
    }
  });
}

function inspectWithPoppler(pdf: Buffer, page = 1): Promise<{ text: string; pages: number; renderedPage: Buffer; png: RenderedPng }> {
  const directory = mkdtempSync(join(tmpdir(), "cellguard-trend-pdf-"));
  const pdfPath = join(directory, "report.pdf");
  const renderPrefix = join(directory, "page");
  writeFileSync(pdfPath, pdf);
  const text = execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8" });
  const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  execFileSync("pdftoppm", ["-f", String(page), "-l", String(page), "-r", "144", "-png", pdfPath, renderPrefix], { encoding: "utf8" });
  const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0);
  const renderedPage = readFileSync(`${renderPrefix}-${page}.png`);
  return decodePng(renderedPage).then((png) => {
    rmSync(directory, { recursive: true, force: true });
    return { text, pages, renderedPage, png };
  }, (error) => {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  });
}

function inkInRegion(png: RenderedPng, left: number, top: number, right: number, bottom: number): number {
  let count = 0;
  const x0 = Math.max(0, Math.floor(left));
  const y0 = Math.max(0, Math.floor(top));
  const x1 = Math.min(png.width, Math.ceil(right));
  const y1 = Math.min(png.height, Math.ceil(bottom));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * png.width + x) * 4;
      if (png.pixels[offset] < 245 || png.pixels[offset + 1] < 245 || png.pixels[offset + 2] < 245) count += 1;
    }
  }
  return count;
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
    const inspected = await inspectWithPoppler(pdf);
    expect(inspected.pages).toBe(2);
    expect(inspected.text).toContain("CellGuard 추세 보고서");
    expect(inspected.text).toContain("대표 온도");
    expect(inspected.renderedPage.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    // The title sits above the rule and summary cards. Checking separate
    // regions catches the prior WOFF2 failure where extraction succeeded but
    // Poppler painted no glyphs at all.
    expect(inkInRegion(inspected.png, 60, 60, 320, 145)).toBeGreaterThan(20);
    expect(inkInRegion(inspected.png, 300, 60, 700, 145)).toBeGreaterThan(20);
  });

  it("keeps an empty report valid and explicitly marks missing data", async () => {
    const empty: TrendResponse = { period: "24h", buckets: [], series: [] };
    const pdf = await renderTrendPdf(empty, [], metrics, new Date("2026-09-15T12:34:56.000Z"));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    if (!POPPLER_AVAILABLE) return;
    const inspected = await inspectWithPoppler(pdf);
    expect(inspected.pages).toBe(2);
    expect(inspected.text).toContain("no data");
  });

  it("renders long Korean and ASCII battery labels across a two-battery report", async () => {
    const twoBatteryReport: TrendResponse = {
      period: "30d",
      buckets: ["2026-08-17T00:00:00.000Z", "2026-08-18T00:00:00.000Z"],
      series: ["pack-a", "pack-b"].flatMap((batteryId, index) => metrics.map((metric) => ({
        batteryId,
        batteryLabel: index === 0 ? "PACK-A 아주 긴 배터리 이름 with ASCII and 한글" : "PACK-B 두 번째 매우 긴 배터리 이름 <unsafe>",
        metric,
        unit: "",
        points: metric === "temp" ? [41 + index, 42 + index] : metric === "anomaly" ? [0.12 + index * 0.1, 0.9] : [1 + index, 2 + index],
      }))),
    };
    const pdf = await renderTrendPdf(twoBatteryReport, ["pack-a", "pack-b"], metrics, new Date("2026-09-15T12:34:56.000Z"));
    if (!POPPLER_AVAILABLE) return;

    const pageOne = await inspectWithPoppler(pdf, 1);
    const pageTwo = await inspectWithPoppler(pdf, 2);
    const pageThree = await inspectWithPoppler(pdf, 3);
    expect(pageOne.pages).toBe(3);
    expect(pageOne.text).toContain("PACK-A 아주 긴 배터리 이름 with ASCII and 한글");
    expect(pageOne.text).toContain("PACK-B 두 번째 매우 긴 배터리 이름 <unsafe>");
    expect(pageTwo.text).toContain("PACK-A 아주 긴 배터리 이름 with ASCII and 한글");
    expect(pageThree.text).toContain("PACK-B 두 번째 매우 긴 배터리 이름 <unsafe>");
    expect(inkInRegion(pageOne.png, 70, 65, 1080, 145)).toBeGreaterThan(100);
    expect(inkInRegion(pageTwo.png, 70, 230, 1080, 350)).toBeGreaterThan(100);
    expect(inkInRegion(pageThree.png, 70, 230, 1080, 350)).toBeGreaterThan(100);
  });
});
