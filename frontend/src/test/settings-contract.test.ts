import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";

describe("settings and password contracts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the complete canonical alert channel object and keeps credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ channels: { KAKAO: false, EMAIL: true, SMS: false, WEBPUSH: true } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const channels = { KAKAO: false, EMAIL: true, SMS: false, WEBPUSH: true };
    await api.updateAlertSettings(channels);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PATCH");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(String(init.body))).toEqual({ channels });
  });

  it("does not send the confirmation field when changing a password", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await api.changePassword({ currentPassword: "old-pass", newPassword: "New-pass1!" });
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toContain("/api/me/password");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ currentPassword: "old-pass", newPassword: "New-pass1!" });
    expect(JSON.parse(String(init.body))).not.toHaveProperty("newPasswordConfirm");
  });
});
