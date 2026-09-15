import { describe, expect, it } from "vitest";
import { normalizeAdminInput } from "../mocks/handlers";
import { reconcileDraft } from "../api/adminDraft";
import { adminEventTrendBucketLabel } from "../pages/AdminPages";

describe("admin battery input contract", () => {
  it("normalizes NFKC and trims status reasons and memos", () => {
    expect(normalizeAdminInput("  ＡＢＣ  ", 500, false)).toBe("ABC");
    expect(normalizeAdminInput("  관리자 메모  ", 2_000, true)).toBe("관리자 메모");
    expect(normalizeAdminInput("   ", 2_000, true)).toBe("");
  });

  it("requires a non-empty reason and enforces normalized length limits", () => {
    expect(() => normalizeAdminInput("  ", 500, false)).toThrow("REASON_REQUIRED");
    expect(() => normalizeAdminInput("가".repeat(501), 500, false)).toThrow("INPUT_TOO_LONG");
    expect(() => normalizeAdminInput("가".repeat(2_001), 2_000, true)).toThrow("INPUT_TOO_LONG");
    expect(normalizeAdminInput("가".repeat(500), 500, false)).toHaveLength(500);
    expect(normalizeAdminInput("가".repeat(2_000), 2_000, true)).toHaveLength(2_000);
  });
});

describe("admin detail draft reconciliation", () => {
  it("adopts a fresh server value when the draft is clean", () => {
    expect(reconcileDraft("old", "old", "fresh")).toEqual({ draft: "fresh", baseline: "fresh", conflict: false });
  });

  it("preserves a dirty draft and reports an external server conflict", () => {
    expect(reconcileDraft("my edit", "old", "other admin edit")).toEqual({ draft: "my edit", baseline: "other admin edit", conflict: true });
  });

  it("keeps a dirty draft without a false conflict when the server is unchanged", () => {
    expect(reconcileDraft("my edit", "old", "old")).toEqual({ draft: "my edit", baseline: "old", conflict: false });
  });
});

describe("admin event trend labels", () => {
  it("formats API UTC buckets in the browser locale", () => {
    const bucket = "2026-09-15T12:34:00.000Z";
    expect(adminEventTrendBucketLabel(bucket, "24h", "en-US")).toContain("12:34");
    expect(adminEventTrendBucketLabel(bucket, "7d", "ko-KR")).toContain("화");
    expect(adminEventTrendBucketLabel(bucket, "30d", "en-US")).toContain("9/15");
  });

  it("does not turn malformed timestamps into a misleading date", () => {
    expect(adminEventTrendBucketLabel("not-a-date", "7d", "en-US")).toBe("—");
  });
});
