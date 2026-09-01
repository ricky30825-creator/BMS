import { describe, expect, it } from "vitest";
import { abortReasonLabel, capabilityLock, gradeLabel, progressPct, statusLabel } from "../api/diagnosisLabels";

describe("gradeLabel", () => {
  it("서버 code를 한국어 문구로 옮긴다 — 서버는 문구를 만들지 않는다", () => {
    expect(gradeLabel("HEALTHY")).toBe("양호");
    expect(gradeLabel("SUSPECT_DEGRADED")).toBe("열화 의심");
    expect(gradeLabel("BASELINE_PENDING")).toBe("기준 없음");
  });

  it("모르는 code는 그대로 보여준다 — 빈칸보다 낫다", () => {
    expect(gradeLabel("NEW_CODE")).toBe("NEW_CODE");
  });

  it("null이면 대시", () => expect(gradeLabel(null)).toBe("—"));
});

describe("abortReasonLabel", () => {
  it("중단 사유 8종을 옮긴다", () => {
    expect(abortReasonLabel("USER")).toBe("사용자 중단");
    expect(abortReasonLabel("TEMP_SLOPE")).toBe("온도 상승률 초과");
    expect(abortReasonLabel("VOLTAGE_COLLAPSE")).toBe("출력전압 붕괴");
  });
});

describe("statusLabel", () => {
  it("진행 상태를 옮긴다", () => {
    expect(statusLabel("RUNNING")).toBe("진행 중");
    expect(statusLabel("COMPLETED")).toBe("완료");
    expect(statusLabel("ABORTED")).toBe("중단됨");
  });
});

describe("progressPct", () => {
  it("시작·예상종료 사이의 경과 비율이다", () => {
    const started = "2026-09-01T00:00:00.000Z";
    const ends = "2026-09-01T00:02:00.000Z";
    expect(progressPct(started, ends, new Date("2026-09-01T00:01:00.000Z").getTime())).toBe(50);
  });

  it("0~100으로 자른다", () => {
    const started = "2026-09-01T00:00:00.000Z";
    const ends = "2026-09-01T00:02:00.000Z";
    expect(progressPct(started, ends, new Date("2026-09-01T00:10:00.000Z").getTime())).toBe(100);
  });

  it("예상 종료를 모르면 null — 32%를 하드코딩하지 않는다", () => {
    expect(progressPct("2026-09-01T00:00:00.000Z", null, Date.now())).toBeNull();
  });
});

describe("capabilityLock", () => {
  it("잠금 사유마다 다른 문구를 낸다", () => {
    expect(capabilityLock("RELAY_CUT").title).toBe("릴레이 차단 상태");
    expect(capabilityLock("DEVICE_OFFLINE").title).toBe("진단기 오프라인");
  });
  it("모르는 코드에도 문구가 나온다 — 빈 카드를 만들지 않는다", () => {
    expect(capabilityLock("SOMETHING_NEW").title).not.toBe("");
    expect(capabilityLock(null).body).not.toBe("");
  });
});
