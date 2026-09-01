import { describe, expect, it } from "vitest";
import { createSimulatorSource } from "./simulator.js";
import type { DemoBattery, DemoDiagnosis } from "../store/types.js";

const battery = (id: string): DemoBattery => ({
  id, ownerId: "hong", label: id, model: "USB", maker: null, chemistry: "LI_PO",
  targetMode: 2, seriesCount: null, capacityWh: 37, ratedOutputCurrentA: 2,
  opsStatus: "NORMAL", version: 0, adminMemo: "", memo: "",
  latest: { voltageV: 5, currentA: -1, powerW: -5, tempContact: null, tempIrSurface: 30, socPct: 90, score: 0.1, measuredAt: "2026-09-01T00:00:00.000Z" },
} as DemoBattery);

const diagnosis = (kind: "QUICK" | "CAPACITY"): DemoDiagnosis => ({
  id: "dg_1", batteryId: "PB-A", sessionId: "s1", kind, status: "RUNNING",
  phase: kind === "QUICK" ? "P0" : "CAPACITY", input: {}, result: null,
  startedAt: "2026-09-01T00:00:00.000Z", estimatedEndAt: null, completedAt: null,
  progress: { loadTargetA: null, loadActualA: null, partialMetrics: null, windows: [], deliveredWh: 0, vLightLoadV: null },
});

describe("createSimulatorSource", () => {
  it("같은 자산은 항상 같은 결과를 낸다 — 재현 가능해야 한다", () => {
    const source = createSimulatorSource();
    const a = source.sample(battery("PB-A"), diagnosis("QUICK"), 5_000, 0.1, 0);
    const b = source.sample(battery("PB-A"), diagnosis("QUICK"), 5_000, 0.1, 0);
    expect(a).toEqual(b);
  });

  it("자산마다 특성이 다르다 — 전부 같은 등급이 나오면 진단이 무의미하다", () => {
    const source = createSimulatorSource();
    const highLoad = 2.0;
    const voltages = ["PB-A", "PB-B", "PB-C", "PB-D"].map(
      (id) => source.sample(battery(id), diagnosis("QUICK"), 100_000, highLoad, 0).voltageV
    );
    expect(new Set(voltages).size).toBeGreaterThan(1);
  });

  it("경부하에서는 출력전압이 5V 근처다", () => {
    const source = createSimulatorSource();
    const sample = source.sample(battery("PB-A"), diagnosis("QUICK"), 5_000, 0.1, 0);
    expect(sample.voltageV).toBeGreaterThan(4.9);
    expect(sample.voltageV).toBeLessThan(5.2);
  });

  it("방전 전류는 음수다 — 부호 규약을 지킨다", () => {
    const source = createSimulatorSource();
    expect(source.sample(battery("PB-A"), diagnosis("QUICK"), 5_000, 1.0, 0).currentA).toBeLessThan(0);
  });

  it("부하가 커지면 표면온도가 오른다 — P3 기울기가 잡혀야 한다", () => {
    const source = createSimulatorSource();
    const early = source.sample(battery("PB-A"), diagnosis("QUICK"), 50_000, 1.5, 0);
    const late = source.sample(battery("PB-A"), diagnosis("QUICK"), 90_000, 1.5, 0);
    expect(late.tempIrSurfaceC!).toBeGreaterThan(early.tempIrSurfaceC!);
  });

  it("용량을 다 뽑으면 전압이 무너진다 — 정상 컷오프 경로", () => {
    const source = createSimulatorSource();
    const drained = source.sample(battery("PB-A"), diagnosis("CAPACITY"), 3_600_000, 1.0, 999);
    expect(drained.voltageV).toBeLessThan(4.0);
  });

  it("모드 2에는 가스 센서가 없는 프로필이라 gasRaw는 null이다", () => {
    const source = createSimulatorSource();
    expect(source.sample(battery("PB-A"), diagnosis("QUICK"), 5_000, 0.1, 0).gasRaw).toBeNull();
  });
});
