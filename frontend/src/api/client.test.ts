import { afterEach, describe, expect, it, vi } from "vitest";
import { api, demoAuthorization, isGlobalAuthFailure, signOutPath, subscribeAuthFailure } from "./client";

function failedResponse(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code, message: code } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("global REST authentication failures", () => {
  it("publishes protected REST authentication expiry", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAuthFailure(listener);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failedResponse(401, "UNAUTHENTICATED")));

    await expect(api.get("/api/batteries")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("publishes account suspension but not reauthentication failure", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAuthFailure(listener);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(failedResponse(403, "ACCOUNT_SUSPENDED"))
      .mockResolvedValueOnce(failedResponse(401, "REAUTH_REQUIRED"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get("/api/batteries")).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED" });
    await expect(api.changePassword({ currentPassword: "wrong", newPassword: "New-password1!" })).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("does not publish invalid login credentials", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAuthFailure(listener);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failedResponse(401, "UNAUTHENTICATED")));

    await expect(api.signIn("unknown@example.com", "wrong")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("keeps role denial separate from authentication expiry", () => {
    expect(isGlobalAuthFailure("/api/admin/overview", "FORBIDDEN")).toBe(false);
    expect(isGlobalAuthFailure("/api/batteries", "SESSION_EXPIRED")).toBe(true);
    expect(isGlobalAuthFailure("/api/demo/logout", "UNAUTHENTICATED")).toBe(false);
  });

  it("omits demo authorization from Better Auth and production requests", async () => {
    const me = { user: null, activeSession: null, unreadAlertCount: 0, activeAnomalyCount: 0, preferences: { theme: "light", lang: "ko" } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(me), { status: 200 }))
      .mockResolvedValueOnce(new Response("measured_at\n", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await api.signIn("hong@cellguard.io", "demo-password");
    await api.download("/api/metrics/export.csv");

    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has("Authorization")).toBe(false);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).has("Authorization")).toBe(false);
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).has("Authorization")).toBe(false);
  });

  it("adds demo authorization only to protected REST and download paths", () => {
    expect(demoAuthorization("/api/me", "demo-token", true)).toBe("Demo demo-token");
    expect(demoAuthorization("/api/metrics/export.csv", "demo-token", true)).toBe("Demo demo-token");
    expect(demoAuthorization("/api/auth/sign-in/email", "demo-token", true)).toBeNull();
    expect(demoAuthorization("/api/demo/login", "demo-token", true)).toBeNull();
    expect(demoAuthorization("/api/demo/logout", "demo-token", true)).toBe("Demo demo-token");
    expect(demoAuthorization("/api/me", "demo-token", false)).toBeNull();
    expect(signOutPath(true)).toBe("/api/demo/logout");
    expect(signOutPath(false)).toBe("/api/auth/sign-out");
  });
});
