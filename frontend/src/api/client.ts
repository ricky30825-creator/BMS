import type { AlertChannels, AlertSettings, ApiUser, ErrorCode, MeResponse, Preferences } from "../types";

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function toApiPath(path: string): string {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text) as unknown; } catch { return text; }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json; charset=utf-8");
  const response = await fetch(toApiPath(path), { ...init, headers, credentials: "include" });
  const body = await readBody(response);
  if (!response.ok) {
    const value = body as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null;
    throw new ApiError(response.status, (value?.error?.code ?? "UNKNOWN") as ErrorCode, value?.error?.message ?? response.statusText, value?.error?.details);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string, params?: URLSearchParams | Record<string, string | number | undefined>) => {
    const query = params instanceof URLSearchParams ? params : new URLSearchParams(Object.entries(params ?? {}).flatMap(([key, value]) => value === undefined ? [] : [[key, String(value)]]));
    return request<T>(`${path}${query.toString() ? `?${query.toString()}` : ""}`);
  },
  post: <T>(path: string, body?: unknown, headers?: HeadersInit) => request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers }),
  patch: <T>(path: string, body?: unknown, headers?: HeadersInit) => request<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body), headers }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: "DELETE", body: body === undefined ? undefined : JSON.stringify(body) }),
  download: async (path: string, params?: URLSearchParams): Promise<Blob> => {
    const query = params?.toString() ? `?${params.toString()}` : "";
    const response = await fetch(toApiPath(`${path}${query}`), { credentials: "include" });
    if (!response.ok) {
      const body = await readBody(response) as { error?: { code?: string; message?: string } } | null;
      throw new ApiError(response.status, (body?.error?.code ?? "UNKNOWN") as ErrorCode, body?.error?.message ?? response.statusText);
    }
    return response.blob();
  },
  me: () => request<MeResponse>("/api/me"),
  signOut: () => request<void>("/api/auth/sign-out", { method: "POST" }),
  signIn: async (email: string, password: string): Promise<MeResponse> => {
    try {
      await request("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
    } catch (error) {
      if (import.meta.env.VITE_DEMO_MODE !== "true") throw error;
      const role = email.trim().toLowerCase() === "lee@lab.io" ? "ADMIN" : "USER";
      await request("/api/demo/login", { method: "POST", body: JSON.stringify({ email, password, role }) });
    }
    return api.me();
  },
  signUp: (body: { name: string; email: string; phone: string; password: string; termsVersion: string; privacyVersion: string; acceptedAt: string }) => request("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify(body) }),
  findEmail: (body: { name: string; phone: string }) => request<{ email: string | null }>("/api/account/email-lookup", { method: "POST", body: JSON.stringify(body) }),
  resetPassword: (email: string) => request("/api/auth/forget-password", { method: "POST", body: JSON.stringify({ email }) }),
  updateMe: (body: Partial<Pick<ApiUser, "name" | "email" | "phone">>) => request<ApiUser>("/api/me", { method: "PATCH", body: JSON.stringify(body) }),
  getAlertSettings: () => request<AlertSettings>("/api/settings/alerts"),
  updateAlertSettings: (channels: AlertChannels) => request<AlertSettings>("/api/settings/alerts", { method: "PATCH", body: JSON.stringify({ channels }) }),
  changePassword: (body: { currentPassword: string; newPassword: string }) => request<void>("/api/me/password", { method: "POST", body: JSON.stringify(body) }),
  updatePreferences: (body: Preferences) => request<Preferences>("/api/settings/preferences", { method: "PATCH", body: JSON.stringify(body) }),
};

export function idempotencyKey(prefix: string): string {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

export function apiBaseUrl(): string {
  if (API_BASE) return API_BASE;
  return window.location.origin;
}
