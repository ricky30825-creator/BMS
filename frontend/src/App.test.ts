import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { authenticatedLandingPath, expireAuthentication, requiresActiveSession } from "./App";
import type { MeResponse } from "./types";

const me = (role: "USER" | "ADMIN"): MeResponse => ({
  user: { id: "u_1", name: "테스터", email: "test@example.com", role, status: "ACTIVE" },
  activeSession: null,
  unreadAlertCount: 2,
  activeAnomalyCount: 1,
  preferences: { theme: "dark", lang: "ko" },
});

describe("authentication and session routing", () => {
  it("lands authenticated users on the role-specific home", () => {
    expect(authenticatedLandingPath(me("USER"))).toBe("/battery");
    expect(authenticatedLandingPath(me("ADMIN"))).toBe("/admin");
  });

  it("allows only battery management routes before a user session starts", () => {
    expect(requiresActiveSession("/battery")).toBe(false);
    expect(requiresActiveSession("/battery/b_pack_001")).toBe(false);
    for (const path of ["/dashboard", "/anomaly", "/trend", "/events", "/alertHistory", "/notices", "/powerbankDiag", "/relay", "/settings"]) {
      expect(requiresActiveSession(path)).toBe(true);
    }
  });

  it("replaces stale authenticated cache with an anonymous session", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["me"], me("USER"));
    qc.setQueryData(["dashboard"], { snapshotCursor: "10" });

    await expireAuthentication(qc, { theme: "dark", lang: "ko" });

    expect(qc.getQueryData(["me"])).toEqual({
      user: null,
      activeSession: null,
      unreadAlertCount: 0,
      activeAnomalyCount: 0,
      preferences: { theme: "dark", lang: "ko" },
    });
    expect(qc.getQueryData(["dashboard"])).toBeUndefined();
  });
});
