import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

import type { TrendMetric, TrendResponse, TrendSeries } from "./store/types.js";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FONT_PATH = join(dirname(fileURLToPath(import.meta.url)), "../assets/fonts/NotoSansKR-Korean.ttf");

const metricLabels: Record<TrendMetric, string> = {
  volt: "전압",
  curr: "전류",
  temp: "대표 온도",
  soc: "SOC",
  anomaly: "이상점수",
};

const metricColors: Record<TrendMetric, string> = {
  volt: "#2563eb",
  curr: "#7c3aed",
  temp: "#c2410c",
  soc: "#0f766e",
  anomaly: "#b91c1c",
};

function pdfText(value: unknown, limit = 120): string {
  const text = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(text).slice(0, limit).join("") || "-";
}

export function safeFilenameSegment(value: string, fallback = "batteries"): string {
  const safe = Array.from(value.normalize("NFKC").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, ""))
    .slice(0, 48)
    .join("");
  return safe || fallback;
}

function formatValue(value: number | null, metric: TrendMetric): string {
  if (value === null || !Number.isFinite(value)) return "-";
  if (metric === "anomaly") return value.toFixed(3);
  return value.toFixed(2);
}

function valuesFor(series: TrendSeries | undefined): number[] {
  return (series?.points ?? []).filter((value): value is number => value !== null && Number.isFinite(value));
}

function aggregateLabel(metric: TrendMetric): "평균" | "최고" {
  return metric === "temp" || metric === "anomaly" ? "최고" : "평균";
}

function aggregateValue(values: readonly number[], metric: TrendMetric): number | null {
  if (!values.length) return null;
  if (metric === "temp" || metric === "anomaly") return Math.max(...values);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function seriesFor(report: TrendResponse, batteryId: string, metric: TrendMetric): TrendSeries | undefined {
  return report.series.find((series) => series.batteryId === batteryId && series.metric === metric);
}

function addText(doc: PDFKit.PDFDocument, value: unknown, x: number, y: number, options: PDFKit.Mixins.TextOptions = {}): void {
  doc.text(pdfText(value), x, y, options);
}

function drawHeader(doc: PDFKit.PDFDocument, report: TrendResponse, generatedAt: string): void {
  doc.save();
  doc.fillColor("#0f172a");
  addText(doc, "CellGuard 추세 보고서", MARGIN, 38, { width: CONTENT_WIDTH, lineBreak: false });
  doc.fontSize(9).fillColor("#64748b");
  addText(doc, "집계 데이터 보고서", MARGIN, 61, { width: CONTENT_WIDTH, lineBreak: false });
  doc.moveTo(MARGIN, 78).lineTo(PAGE_WIDTH - MARGIN, 78).lineWidth(1).strokeColor("#e2e8f0").stroke();
  doc.restore();

  doc.fontSize(9).fillColor("#334155");
  addText(doc, `기간: ${report.period}`, MARGIN, 96, { lineBreak: false });
  addText(doc, `생성 시각: ${generatedAt}`, MARGIN + 145, 96, { lineBreak: false });
}

function drawSummary(doc: PDFKit.PDFDocument, report: TrendResponse, batteryIds: readonly string[], metrics: readonly TrendMetric[]): void {
  let y = 123;
  doc.fontSize(12).fillColor("#0f172a");
  addText(doc, "요약", MARGIN, y, { lineBreak: false });
  y += 24;

  doc.fontSize(9).fillColor("#334155");
  addText(doc, `배터리: ${batteryIds.length}개`, MARGIN, y, { lineBreak: false });
  addText(doc, `지표: ${metrics.map((metric) => metricLabels[metric]).join(", ")}`, MARGIN + 145, y, { width: CONTENT_WIDTH - 145, lineBreak: false });
  y += 22;

  const cellWidth = CONTENT_WIDTH / Math.min(3, Math.max(1, batteryIds.length));
  batteryIds.forEach((batteryId, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const x = MARGIN + column * cellWidth;
    const cardY = y + row * 84;
    const label = report.series.find((series) => series.batteryId === batteryId)?.batteryLabel ?? batteryId;
    doc.roundedRect(x, cardY, cellWidth - 8, 72, 6).fillColor("#f8fafc").fillAndStroke("#f8fafc", "#e2e8f0");
    doc.fontSize(9).fillColor("#0f172a");
    addText(doc, label, x + 10, cardY + 9, { width: cellWidth - 28, lineBreak: false, ellipsis: true });
    doc.fontSize(8).fillColor("#475569");
    metrics.slice(0, 3).forEach((metric, metricIndex) => {
      const values = valuesFor(seriesFor(report, batteryId, metric));
      const aggregate = aggregateValue(values, metric);
      const summary = aggregate === null ? "no data" : `${values.length}개 · ${aggregateLabel(metric)} ${formatValue(aggregate, metric)}`;
      addText(doc, `${metricLabels[metric]}: ${summary}`, x + 10, cardY + 28 + metricIndex * 13, { width: cellWidth - 28, lineBreak: false });
    });
  });
}

function drawLegend(doc: PDFKit.PDFDocument, metrics: readonly TrendMetric[], y: number): void {
  let x = MARGIN;
  doc.fontSize(8).fillColor("#475569");
  for (const metric of metrics) {
    doc.circle(x + 3, y + 4, 3).fillColor(metricColors[metric]).fill();
    addText(doc, metricLabels[metric], x + 10, y, { lineBreak: false });
    x += Math.max(64, doc.widthOfString(metricLabels[metric]) + 28);
    if (x > PAGE_WIDTH - MARGIN - 60) break;
  }
}

function drawBatteryTable(doc: PDFKit.PDFDocument, report: TrendResponse, batteryId: string, metrics: readonly TrendMetric[], generatedAt: string): void {
  const batteryLabel = report.series.find((series) => series.batteryId === batteryId)?.batteryLabel ?? batteryId;
  drawHeader(doc, report, generatedAt);
  doc.fontSize(13).fillColor("#0f172a");
  addText(doc, `배터리: ${batteryLabel}`, MARGIN, 128, { width: CONTENT_WIDTH, lineBreak: false, ellipsis: true });
  drawLegend(doc, metrics, 151);

  const tableTop = 176;
  const timeWidth = 155;
  const metricWidth = (CONTENT_WIDTH - timeWidth) / Math.max(1, metrics.length);
  const rowHeight = 18;
  doc.fontSize(7.5);
  doc.rect(MARGIN, tableTop, CONTENT_WIDTH, rowHeight).fillColor("#e2e8f0").fill();
  doc.fillColor("#0f172a");
  addText(doc, "구간 (UTC)", MARGIN + 6, tableTop + 5, { width: timeWidth - 10, lineBreak: false });
  metrics.forEach((metric, index) => addText(doc, metricLabels[metric], MARGIN + timeWidth + index * metricWidth + 4, tableTop + 5, { width: metricWidth - 8, lineBreak: false }));

  const seriesByMetric = new Map(metrics.map((metric) => [metric, seriesFor(report, batteryId, metric)]));
  const hasData = metrics.some((metric) => valuesFor(seriesByMetric.get(metric)).length > 0);
  report.buckets.forEach((at, rowIndex) => {
    const y = tableTop + rowHeight + rowIndex * rowHeight;
    if (y + rowHeight > PAGE_HEIGHT - 42) return;
    if (rowIndex % 2 === 0) doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight).fillColor("#f8fafc").fill();
    doc.fillColor("#334155");
    addText(doc, at, MARGIN + 6, y + 5, { width: timeWidth - 10, lineBreak: false });
    metrics.forEach((metric, metricIndex) => {
      const value = seriesByMetric.get(metric)?.points[rowIndex] ?? null;
      addText(doc, formatValue(value, metric), MARGIN + timeWidth + metricIndex * metricWidth + 4, y + 5, { width: metricWidth - 8, lineBreak: false });
    });
  });
  if (!report.buckets.length || !hasData) {
    doc.fontSize(10).fillColor("#64748b");
    addText(doc, "no data", MARGIN, tableTop + rowHeight + 14, { lineBreak: false });
  }
  doc.fontSize(7).fillColor("#94a3b8");
  addText(doc, "* 결측 구간은 0이 아닌 - 로 표시됩니다. 모든 시간은 UTC입니다.", MARGIN, PAGE_HEIGHT - 29, { lineBreak: false });
}

/** Render an aggregate trend response into an in-memory PDF buffer. */
export async function renderTrendPdf(report: TrendResponse, batteryIds: readonly string[], metrics: readonly TrendMetric[], generatedAt = new Date()): Promise<Buffer> {
  if (!existsSync(FONT_PATH)) throw new Error("PDF_FONT_NOT_FOUND");
  const document = new PDFDocument({ size: "A4", margin: MARGIN, autoFirstPage: true, compress: true });
  const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));
  });

  document.font(FONT_PATH).fontSize(18).fillColor("#0f172a");
  drawHeader(document, report, generatedAt.toISOString());
  drawSummary(document, report, batteryIds, metrics);
  document.fontSize(8).fillColor("#64748b");
  addText(document, "세부 집계 표", MARGIN, 420, { lineBreak: false });
  document.fontSize(7.5);
  addText(document, "온도·이상점수는 구간 최고값, 전압·전류·SOC는 구간 평균값입니다.", MARGIN, 436, { width: CONTENT_WIDTH, lineBreak: false });

  for (const batteryId of batteryIds) {
    document.addPage();
    document.font(FONT_PATH).fontSize(13);
    drawBatteryTable(document, report, batteryId, metrics, generatedAt.toISOString());
  }
  if (batteryIds.length === 0) {
    document.addPage();
    document.font(FONT_PATH).fontSize(13).fillColor("#0f172a");
    drawHeader(document, report, generatedAt.toISOString());
    addText(document, "no data", MARGIN, 132, { lineBreak: false });
  }
  document.end();
  return output;
}
