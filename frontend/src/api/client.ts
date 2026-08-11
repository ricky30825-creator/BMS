import type { AlertChannels, AlertSettings, ApiUser, ErrorCode, MeResponse, Preferences } from "../types";

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

function demoTransportEnabled(): boolean {
  return typeof __CELLGUARD_DEV_SERVER__ !== "undefined" && __CELLGUARD_DEV_SERVER__ && import.meta.env.VITE_DEMO_MODE === "true";
}

let demoToken: string | null = null;

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

type AuthFailureListener = (error: ApiError) => void;
const authFailureListeners = new Set<AuthFailureListener>();
const globalAuthFailureCodes = new Set<string>(["UNAUTHENTICATED", "ACCOUNT_SUSPENDED", "SESSION_EXPIRED", "AUTH_EXPIRED"]);
const credentialEntryPaths = new Set(["/api/auth/sign-in/email", "/api/demo/login", "/api/demo/logout"]);

export function subscribeAuthFailure(listener: AuthFailureListener): () => void {
  authFailureListeners.add(listener);
  return () => { authFailureListeners.delete(listener); };
}

export function isGlobalAuthFailure(path: string, code: string): boolean {
  return !credentialEntryPaths.has(path.split("?")[0]) && globalAuthFailureCodes.has(code);
}

function apiError(response: Response, body: unknown, path: string): ApiError {
  const value = body as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null;
  const error = new ApiError(response.status, (value?.error?.code ?? "UNKNOWN") as ErrorCode, value?.error?.message ?? response.statusText, value?.error?.details);
  if (isGlobalAuthFailure(path, error.code)) {
    for (const listener of [...authFailureListeners]) listener(error);
  }
  return error;
}

function toApiPath(path: string): string {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export function demoAuthorization(path: string, token: string | null, enabled = demoTransportEnabled()): string | null {
  if (!enabled || !token || path.startsWith("/api/auth/") || path === "/api/demo/login") return null;
  return `Demo ${token}`;
}

export function signOutPath(demoEnabled = demoTransportEnabled()): string {
  return demoEnabled ? "/api/demo/logout" : "/api/auth/sign-out";
}

function withDemoAuthorization(path: string, headers: Headers): void {
  // Demo tokens are an explicit development transport. Better Auth routes
  // remain cookie-based and never receive this header.
  const authorization = demoAuthorization(path, demoToken);
  if (authorization) headers.set("Authorization", authorization);
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text) as unknown; } catch { return text; }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json; charset=utf-8");
  withDemoAuthorization(path, headers);
  const response = await fetch(toApiPath(path), { ...init, headers, credentials: "include" });
  const body = await readBody(response);
  if (!response.ok) {
    throw apiError(response, body, path);
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
    const headers = new Headers();
    withDemoAuthorization(path, headers);
    const response = await fetch(toApiPath(`${path}${query}`), { headers, credentials: "include" });
    if (!response.ok) {
      throw apiError(response, await readBody(response), path);
    }
    return response.blob();
  },
  me: () => request<MeResponse>("/api/me"),
  signOut: async () => {
    try {
      await request<void>(signOutPath(), { method: "POST" });
    } finally {
      demoToken = null;
    }
  },
  signIn: async (email: string, password: string): Promise<MeResponse> => {
    if (demoTransportEnabled()) {
      const { demoRoleForEmail } = await import("../mocks/localDemoAuth");
      const result = await request<{ token?: unknown }>("/api/demo/login", { method: "POST", body: JSON.stringify({ email, password, role: demoRoleForEmail(email) }) });
      if (typeof result.token !== "string" || result.token.length === 0) throw new ApiError(502, "UNKNOWN", "Demo authentication did not return a token.");
      demoToken = result.token;
      return api.me();
    }
    await request("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
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

export function demoAuthToken(): string | null {
  return demoTransportEnabled() ? demoToken : null;
}
