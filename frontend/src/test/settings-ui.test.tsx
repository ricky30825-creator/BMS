import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { SettingsPage } from "../pages/UserPages";
import type { MeResponse } from "../types";

const me: MeResponse = { user: { id: "u1", name: "홍길동", email: "hong@example.com", phone: null, role: "USER", status: "ACTIVE" }, activeSession: null, unreadAlertCount: 0, activeAnomalyCount: 0, preferences: { theme: "light", lang: "ko" } };

describe("settings alert UI", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads server channels, applies the canonical response, and rolls back failures", async () => {
    vi.spyOn(api, "getAlertSettings").mockResolvedValue({ channels: { KAKAO: false, EMAIL: true, SMS: false, WEBPUSH: true }, policy: {} });
    const update = vi.spyOn(api, "updateAlertSettings").mockResolvedValueOnce({ channels: { KAKAO: true, EMAIL: true, SMS: false, WEBPUSH: false }, policy: {} }).mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    const { container } = render(<SettingsPage me={me} onProfileSaved={() => undefined} onPreferencesSaved={() => undefined} />);
    const toggles = () => [...container.querySelectorAll<HTMLInputElement>(".toggle-row input")];
    await waitFor(() => expect(toggles()[0]).not.toBeChecked());
    expect(toggles()[3]).toBeChecked();

    await user.click(toggles()[0]);
    await waitFor(() => expect(update).toHaveBeenCalledWith({ KAKAO: true, EMAIL: true, SMS: false, WEBPUSH: true }));
    await waitFor(() => expect(toggles()[3]).not.toBeChecked());

    await user.click(toggles()[1]);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(toggles()[1]).toBeChecked());
    expect(document.body).toHaveTextContent("알림 설정을 저장하지 못했습니다.");
  });

  it("does not PATCH after the canonical GET fails and exposes retry", async () => {
    const get = vi.spyOn(api, "getAlertSettings")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ channels: { KAKAO: true, EMAIL: false, SMS: false, WEBPUSH: false }, policy: {} });
    const update = vi.spyOn(api, "updateAlertSettings").mockResolvedValue({ channels: { KAKAO: false, EMAIL: false, SMS: false, WEBPUSH: false }, policy: {} });
    const user = userEvent.setup();
    const { container } = render(<SettingsPage me={me} onProfileSaved={() => undefined} onPreferencesSaved={() => undefined} />);
    const toggles = () => [...container.querySelectorAll<HTMLInputElement>(".toggle-row input")];
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await expect(screen.findByText("알림 설정을 불러오지 못했습니다.", { exact: false })).resolves.toBeInTheDocument();
    expect(toggles()[0]).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(toggles()[0]).toBeEnabled());
    await user.click(toggles()[0]);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });

  it("validates the confirmation locally and sends only current and new passwords", async () => {
    vi.spyOn(api, "getAlertSettings").mockResolvedValue({ channels: { KAKAO: true, EMAIL: true, SMS: false, WEBPUSH: false }, policy: {} });
    const changePassword = vi.spyOn(api, "changePassword").mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<SettingsPage me={me} onProfileSaved={() => undefined} onPreferencesSaved={() => undefined} />);
    await user.click(screen.getByRole("tab", { name: "계정 정보" }));
    await user.type(screen.getByLabelText("현재 비밀번호"), "old-pass");
    await user.type(screen.getByLabelText("새 비밀번호"), "New-pass1!");
    await user.type(screen.getByLabelText("새 비밀번호 확인"), "New-pass1!");
    await user.click(screen.getByRole("button", { name: "비밀번호 변경" }));
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith({ currentPassword: "old-pass", newPassword: "New-pass1!" }));
    expect(screen.getByRole("status")).toHaveTextContent("비밀번호가 변경되었습니다.");
  });
});

describe("settings voice-alert UI", () => {
  afterEach(() => vi.restoreAllMocks());

  const defaultVoiceSettings = { enabled: true, volume: 70, connectionEnabled: true, anomalyEnabled: true, failsafeRelayEnabled: true, deviceErrorEnabled: true, networkEnabled: false, updatedAt: "2026-01-01T00:00:00.000Z" };

  it("loads server settings into the voice-alert tab and PATCHes on toggle", async () => {
    vi.spyOn(api, "getAlertSettings").mockResolvedValue({ channels: { KAKAO: true, EMAIL: true, SMS: false, WEBPUSH: true }, policy: {} });
    vi.spyOn(api, "getVoiceAlertSettings").mockResolvedValue(defaultVoiceSettings);
    const update = vi.spyOn(api, "updateVoiceAlertSettings").mockResolvedValue({ ...defaultVoiceSettings, networkEnabled: true, updatedAt: "2026-01-02T00:00:00.000Z" });
    const user = userEvent.setup();
    render(<SettingsPage me={me} onProfileSaved={() => undefined} onPreferencesSaved={() => undefined} />);
    await user.click(screen.getByRole("tab", { name: "음성 안내" }));
    await waitFor(() => expect(screen.getByText("이상 탐지 경보")).toBeInTheDocument());
    const networkToggle = screen.getByText("네트워크 상태").closest(".toggle-row")!.querySelector("input")!;
    expect(networkToggle).not.toBeChecked();

    await user.click(networkToggle);
    await waitFor(() => expect(update).toHaveBeenCalledWith({ networkEnabled: true }));
    await waitFor(() => expect(networkToggle).toBeChecked());
    expect(document.body).toHaveTextContent("음성 안내 설정이 저장되었습니다.");
  });

  it("disables the category toggles and volume slider while the master switch is off, and rolls back a failed PATCH", async () => {
    vi.spyOn(api, "getAlertSettings").mockResolvedValue({ channels: { KAKAO: true, EMAIL: true, SMS: false, WEBPUSH: true }, policy: {} });
    vi.spyOn(api, "getVoiceAlertSettings").mockResolvedValue({ ...defaultVoiceSettings, enabled: false });
    const update = vi.spyOn(api, "updateVoiceAlertSettings").mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(<SettingsPage me={me} onProfileSaved={() => undefined} onPreferencesSaved={() => undefined} />);
    await user.click(screen.getByRole("tab", { name: "음성 안내" }));
    await waitFor(() => expect(screen.getByText("이상 탐지 경보")).toBeInTheDocument());
    const volumeSlider = screen.getByText("음량").closest(".toggle-row")!.querySelector("input")!;
    expect(volumeSlider).toBeDisabled();
    const anomalyToggle = screen.getByText("이상 탐지 경보").closest(".toggle-row")!.querySelector("input")!;
    expect(anomalyToggle).toBeDisabled();

    const masterToggle = screen.getByText("음성 안내 전체").closest(".toggle-row")!.querySelector("input")!;
    await user.click(masterToggle);
    await waitFor(() => expect(update).toHaveBeenCalledWith({ enabled: true }));
    await waitFor(() => expect(masterToggle).not.toBeChecked());
    expect(document.body).toHaveTextContent("음성 안내 설정을 저장하지 못했습니다.");
  });
});
