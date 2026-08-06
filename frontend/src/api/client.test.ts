import { afterEach, describe, expect, it, vi } from "vitest";
import { api, isGlobalAuthFailure, subscribeAuthFailure } from "./client";

function failedResponse(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code, message: code } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
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
  });
});
