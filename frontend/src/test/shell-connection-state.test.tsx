import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppShell } from "../components/Shell";
import type { MeResponse } from "../types";

const baseMe: MeResponse = {
  user: { id: "u1", name: "홍길동", email: "hong@example.com", phone: null, role: "USER", status: "ACTIVE" },
  activeSession: { id: "s1", batteryId: "b1", batteryLabel: "PACK-001", status: "ACTIVE", startedAt: "2026-09-11T00:00:00.000Z", measurementPhase: "WAITING_FOR_MEASUREMENT" },
  unreadAlertCount: 0,
  activeAnomalyCount: 0,
  preferences: { theme: "light", lang: "ko" },
};

function renderShell(me: MeResponse) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AppShell me={me} onLogout={async () => undefined} onTheme={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("app shell connection state", () => {
  it("does not call an active session measuring until a sensor frame is observed", () => {
    renderShell(baseMe);
    expect(screen.getByText("장비 연결 대기")).toBeInTheDocument();
    expect(screen.queryByText("연결됨 · 측정 중")).not.toBeInTheDocument();
  });

  it("shows measuring only for a session with a post-start sensor frame", () => {
    renderShell({ ...baseMe, activeSession: { ...baseMe.activeSession!, measurementPhase: "MEASURING" } });
    expect(screen.getByText("연결됨 · 측정 중")).toBeInTheDocument();
    expect(screen.queryByText("장비 연결 대기")).not.toBeInTheDocument();
  });
});
