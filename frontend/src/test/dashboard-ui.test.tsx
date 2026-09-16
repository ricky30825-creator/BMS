import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DashboardPage } from "../pages/UserPages";
import type { Dashboard, MeResponse } from "../types";
import type { DashboardMetricParam } from "../api/normalize";

const session = { id: "ses_1", batteryId: "B1", batteryLabel: "DEMO-PACK-001", status: "ACTIVE" as const, startedAt: "2026-08-25T00:00:00.000Z", measurementPhase: "MEASURING" as const };

const me: MeResponse = {
  user: { id: "u1", name: "홍길동", email: "hong@example.com", phone: null, role: "USER", status: "ACTIVE" },
  activeSession: session,
  unreadAlertCount: 0,
  activeAnomalyCount: 0,
  preferences: { theme: "light", lang: "ko" },
};

function dashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    session,
    battery: { id: "B1", label: "DEMO-PACK-001", chemistry: "LI_ION", seriesCount: 1, maker: null, model: "18650", targetMode: 1, capacityWh: null, ratedOutputCurrentA: null, opsStatus: "NORMAL", latest: null, health: null },
    metrics: {
      voltageV: { value: 11.9, status: null },
      currentA: { value: -2.4, status: null },
      tempContact: { value: 31.2, status: "OK" },
      tempIrSurface: { value: 30.4, status: "OK" },
      representativeTempC: { value: 31.2, status: "OK", source: "CONTACT" },
      socPct: { value: 78, status: null },
      socBasis: "ABSOLUTE_GAUGE",
      measuredAt: "2026-08-25T00:00:00.000Z",
    },
    anomaly: { score: 0.18, grade: "NORMAL" },
    relay: { batteryId: "B1", state: "CLOSED", changedAt: "2026-08-25T00:00:00.000Z", changedBy: { type: "SYSTEM" }, interlock: { engaged: false, condition: null, canRestore: true } },
    notices: [],
    snapshotCursor: "1",
    ...overrides,
  };
}

function renderDashboard(data: Dashboard, refetchMetric: (metric: DashboardMetricParam) => Promise<void> = async () => undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardPage realtime={{ state: "live", dashboard: data, lastAt: null, refetchMetric }} me={me} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("dashboard quick metric cards", () => {
  it("shows discharge current without a sign and states the direction as a label", () => {
    const { container } = renderDashboard(dashboard());
    const currentCard = container.querySelector(".dashboard-metric-card.curr");

    expect(currentCard).toHaveTextContent("2.4");
    expect(currentCard?.textContent).not.toContain("-2.4");
    expect(currentCard).toHaveTextContent("방전");
  });

  it("labels a positive current as charging and still shows no sign", () => {
    const data = dashboard();
    data.metrics.currentA = { value: 1.2, status: null };
    const { container } = renderDashboard(data);
    const currentCard = container.querySelector(".dashboard-metric-card.curr");

    expect(currentCard).toHaveTextContent("1.2");
    expect(currentCard).toHaveTextContent("충전");
  });

  it("draws no sparkline when the server series is too short to be a trend", () => {
    const data = dashboard({ quickTrend: { metric: "temp", points: [{ at: "2026-08-25T00:00:00.000Z", value: 31.2 }] } });
    const { container } = renderDashboard(data);

    expect(container.querySelectorAll(".metric-mini-line")).toHaveLength(0);
  });

  it("draws no sparkline when the server omits the quick trend entirely", () => {
    const { container } = renderDashboard(dashboard());

    expect(container.querySelectorAll(".metric-mini-line")).toHaveLength(0);
  });

  it("draws the served series on the card it belongs to and on no other card", () => {
    const data = dashboard({
      quickTrend: {
        metric: "temp",
        points: [
          { at: "2026-08-25T00:00:00.000Z", value: 30 },
          { at: "2026-08-25T00:00:01.000Z", value: 32 },
          { at: "2026-08-25T00:00:02.000Z", value: 31 },
        ],
      },
    });
    const { container } = renderDashboard(data);
    const lines = container.querySelectorAll(".metric-mini-line");

    expect(lines).toHaveLength(1);
    expect(container.querySelector(".dashboard-metric-card.temp .metric-mini-line")).toBeInTheDocument();
  });

  it("plots the served values rather than a fixed decorative shape", () => {
    const rising = dashboard({ quickTrend: { metric: "soc", points: [{ at: "a", value: 10 }, { at: "b", value: 90 }] } });
    const falling = dashboard({ quickTrend: { metric: "soc", points: [{ at: "a", value: 90 }, { at: "b", value: 10 }] } });

    const risingPoints = renderDashboard(rising).container.querySelector(".metric-mini-line polyline")?.getAttribute("points");
    const fallingPoints = renderDashboard(falling).container.querySelector(".metric-mini-line polyline")?.getAttribute("points");

    expect(risingPoints).toBeTruthy();
    expect(fallingPoints).toBeTruthy();
    expect(risingPoints).not.toEqual(fallingPoints);
  });

  it("skips gaps instead of plotting missing samples as zero", () => {
    const data = dashboard({ quickTrend: { metric: "volt", points: [{ at: "a", value: 11.9 }, { at: "b", value: null }, { at: "c", value: 12.1 }] } });
    const { container } = renderDashboard(data);
    const points = container.querySelector(".metric-mini-line polyline")?.getAttribute("points");

    expect(points?.trim().split(/\s+/)).toHaveLength(2);
  });
});

describe("dashboard trend chart", () => {
  it("keeps the anomaly score unsigned rendering independent of current sign", () => {
    const { container } = renderDashboard(dashboard());

    expect(container.querySelector(".score-gauge-value")).toHaveTextContent("18");
  });

  it("freezes only the chart, catches up on resume, and unpauses on metric change", async () => {
    const user = userEvent.setup();
    const initial = dashboard({ quickTrend: { metric: "temp", points: [{ at: "2026-08-25T00:00:01.000Z", value: 31.2 }] } });
    const { container, rerender } = renderDashboard(initial);
    const rerenderDashboard = (data: Dashboard) => rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <DashboardPage realtime={{ state: "live", dashboard: data, lastAt: null, refetchMetric: async () => undefined }} me={me} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "차트 일시 정지" }));
    expect(screen.getByRole("status")).toHaveTextContent("실시간 측정은 계속 수신 중입니다.");

    const updated = dashboard({
      metrics: { ...initial.metrics, representativeTempC: { value: 34.6, status: "OK", source: "CONTACT" } },
      quickTrend: { metric: "temp", points: [
        { at: "2026-08-25T00:00:01.000Z", value: 31.2 },
        { at: "2026-08-25T00:00:02.000Z", value: 34.6 },
      ] },
    });
    rerenderDashboard(updated);
    expect(container.querySelector(".dashboard-metric-card.temp")).toHaveTextContent("34.6");
    expect(screen.getByRole("group", { name: /마지막 표시값 31.2 °C/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "실시간 이어보기" }));
    expect(screen.getByRole("group", { name: /마지막 표시값 34.6 °C/ })).toBeInTheDocument();
    await user.click(container.querySelector(".dashboard-metric-card.soc")!);
    expect(screen.getByRole("button", { name: "차트 일시 정지" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("dashboard metric selection", () => {
  it("requests the server's series for the clicked metric card using its ?metric= alias", async () => {
    const refetchMetric = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { container } = renderDashboard(dashboard(), refetchMetric);

    await user.click(container.querySelector(".dashboard-metric-card.volt")!);
    expect(refetchMetric).toHaveBeenCalledWith("volt");

    await user.click(container.querySelector(".dashboard-metric-card.soc")!);
    expect(refetchMetric).toHaveBeenCalledWith("soc");
  });

  it("draws the newly selected metric's line once the server responds with its series", async () => {
    const refetchMetric = vi.fn().mockReturnValue(new Promise<void>(() => undefined));
    const user = userEvent.setup();
    const { container, rerender } = renderDashboard(dashboard(), refetchMetric);

    await user.click(container.querySelector(".dashboard-metric-card.volt")!);
    expect(container.querySelectorAll(".metric-mini-line")).toHaveLength(0);

    const withVoltSeries = dashboard({ quickTrend: { metric: "volt", points: [{ at: "a", value: 11.8 }, { at: "b", value: 12.1 }] } });
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <DashboardPage realtime={{ state: "live", dashboard: withVoltSeries, lastAt: null, refetchMetric }} me={me} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(container.querySelector(".dashboard-metric-card.volt .metric-mini-line")).toBeInTheDocument();
  });
});
