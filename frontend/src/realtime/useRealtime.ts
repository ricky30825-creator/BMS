import { useCallback, useEffect, useRef, useState } from "react";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { api, apiBaseUrl, demoAuthToken } from "../api/client";
import { announceDiagnosisCompletion } from "../api/diagnosis";
import { normalizeDashboard, normalizeDashboardAnomaly, normalizeDashboardMetrics, normalizeRelay, type DashboardMetricParam } from "../api/normalize";
import { measurementPhaseFor } from "../measurementState";
import { appendDashboardTrendPoint } from "../dashboardTrend";
import type { Alert, BatteryEvent, Dashboard, Diagnosis, Grade, MeResponse, Relay, WsEnvelope } from "../types";

export type RealtimeState = "idle" | "loading" | "connecting" | "live" | "reconnecting" | "offline" | "expired" | "resyncing";
export type ReconnectIntent = "initial" | "resume" | "resync";

// `afterCursor` must always be a cursor the server actually issued. Sending a
// placeholder like "0" reads as "replay from the beginning", so the server
// pushes its entire ring buffer (up to 10k events) instead of just the gap
// between the snapshot and the socket opening. A resume that lost its cursor
// therefore has to re-anchor on a fresh snapshot first; `resync` is exempt
// because resyncQueries() refetches the snapshot on its own.
export function requiresSnapshotAnchor(intent: ReconnectIntent, cursor: string | null): boolean {
  if (intent === "resync") return false;
  return intent === "initial" || cursor === null;
}

export const realtimeTopics = ["metrics", "anomaly", "relay", "alert", "event", "session", "diagnosis"] as const;

export type ClientWsMessage =
  | { v: 1; type: "subscribe"; payload: { requestId: string; topics: readonly string[]; afterCursor: string } }
  | { v: 1; type: "resume"; payload: { requestId: string; topics: readonly string[]; afterCursor: string; lastEventId?: string } }
  | { v: 1; type: "ping"; payload: Record<string, never> };

export function buildSubscribeMessage(afterCursor: string, requestId: string): ClientWsMessage {
  return { v: 1, type: "subscribe", payload: { requestId, topics: realtimeTopics, afterCursor } };
}

export function buildResumeMessage(afterCursor: string, lastEventId: string | null, requestId: string): ClientWsMessage {
  return {
    v: 1,
    type: "resume",
    payload: { requestId, topics: realtimeTopics, afterCursor, ...(lastEventId ? { lastEventId } : {}) },
  };
}

export function buildPingMessage(): ClientWsMessage {
  return { v: 1, type: "ping", payload: {} };
}

export function sequenceIsNew(next: string | undefined, previous: string | null): boolean {
  if (!next || previous === null) return true;
  try { return BigInt(next) > BigInt(previous); } catch { return next !== previous; }
}

export function applyDiagnosisEvent(current: Diagnosis | null | undefined, type: string, payload: unknown): Diagnosis | null | undefined {
  if (type === "diagnosis.done") return payload as Diagnosis;
  if (type === "diagnosis.progress") return current ? { ...current, ...(payload as Partial<Diagnosis>), status: "RUNNING" } : current;
  if (type === "diagnosis.aborted") return current ? { ...current, ...(payload as Partial<Diagnosis>), status: "ABORTED" } : current;
  return current;
}

export function applyDiagnosisRealtimeEvent(queryClient: QueryClient, type: "diagnosis.progress" | "diagnosis.done" | "diagnosis.aborted", payload: Partial<Diagnosis>): void {
  const current = queryClient.getQueryData<Diagnosis | null>(["diagnosis"]);
  const next = applyDiagnosisEvent(current, type, payload);
  queryClient.setQueryData(["diagnosis"], type === "diagnosis.progress" ? next : null);
  void queryClient.invalidateQueries({ queryKey: ["diagnosis"] });
  if (type !== "diagnosis.progress" && payload.id) announceDiagnosisCompletion(queryClient, payload.id, "websocket");
  if (type !== "diagnosis.progress") void queryClient.invalidateQueries({ queryKey: ["diagnosis-history"] });
}

type AlertListCache = { items: Alert[]; page: { number: number; size: number; total: number; totalPages: number } };
type AlertSummaryCache = { unacknowledgedCount: number; today: { DANGER: number; WARNING: number; NORMAL_OR_CHECK: number } };
type GradeChangedPayload = { from: Grade; to: Grade; score: number; batteryId: string; batteryLabel: string };

function isGrade(value: unknown): value is Grade {
  return value === "NORMAL" || value === "CAUTION" || value === "WARNING" || value === "DANGER";
}

function isAlertPayload(value: unknown): value is Alert {
  const alert = value as Partial<Alert> | null;
  return Boolean(alert && typeof alert.id === "string" && typeof alert.titleCode === "string" && (alert.severity === "DANGER" || alert.severity === "WARNING" || alert.severity === "NORMAL" || alert.severity === "CHECK") && (alert.subjectType === "BATTERY" || alert.subjectType === "DEVICE") && typeof alert.occurredAt === "string" && (alert.acknowledgedAt === null || typeof alert.acknowledgedAt === "string") && Array.isArray(alert.channels));
}

function isEventPayload(value: unknown): value is BatteryEvent {
  const event = value as Partial<BatteryEvent> | null;
  return Boolean(event && typeof event.id === "string" && typeof event.occurredAt === "string" && typeof event.type === "string" && (event.batteryId === null || typeof event.batteryId === "string") && (event.batteryLabel === null || typeof event.batteryLabel === "string") && (event.score === null || typeof event.score === "number") && (event.grade === null || isGrade(event.grade)) && typeof event.severity === "string" && typeof event.source === "string");
}

function isGradeChangedPayload(value: unknown): value is GradeChangedPayload {
  const payload = value as Partial<GradeChangedPayload> | null;
  return Boolean(payload && isGrade(payload.from) && isGrade(payload.to) && typeof payload.score === "number" && Number.isFinite(payload.score) && payload.score >= 0 && payload.score <= 1 && typeof payload.batteryId === "string" && typeof payload.batteryLabel === "string");
}

function isActiveAnomalyGrade(grade: Grade): boolean {
  return grade !== "NORMAL";
}

function alertSummaryDelta(alert: Alert): keyof AlertSummaryCache["today"] {
  return alert.severity === "DANGER" ? "DANGER" : alert.severity === "WARNING" ? "WARNING" : "NORMAL_OR_CHECK";
}

export function applyAlertCreated(queryClient: QueryClient, alert: Alert): void {
  queryClient.setQueriesData<AlertListCache>({ queryKey: ["alerts"] }, (current) => {
    if (!current) return current;
    return { ...current, items: [alert, ...current.items.filter((item) => item.id !== alert.id)].slice(0, current.page.size) };
  });
  void queryClient.invalidateQueries({ queryKey: ["alerts"] });
  const summary = queryClient.getQueryData<AlertSummaryCache>(["alert-summary"]);
  if (summary) {
    const key = alertSummaryDelta(alert);
    queryClient.setQueryData<AlertSummaryCache>(["alert-summary"], { ...summary, unacknowledgedCount: summary.unacknowledgedCount + (alert.acknowledgedAt ? 0 : 1), today: { ...summary.today, [key]: summary.today[key] + 1 } });
  } else void queryClient.invalidateQueries({ queryKey: ["alert-summary"] });
  const me = queryClient.getQueryData<MeResponse>(["me"]);
  if (me) queryClient.setQueryData<MeResponse>(["me"], { ...me, unreadAlertCount: me.unreadAlertCount + (alert.acknowledgedAt ? 0 : 1) });
  else void queryClient.invalidateQueries({ queryKey: ["me"] });
}

export function applyEventCreated(queryClient: QueryClient, _event: BatteryEvent): void {
  void queryClient.invalidateQueries({ queryKey: ["events"] });
  void queryClient.invalidateQueries({ queryKey: ["anomaly-summary"] });
  void queryClient.invalidateQueries({ queryKey: ["evidence"] });
  void queryClient.invalidateQueries({ queryKey: ["me"] });
}

export function applyAnomalyGradeChanged(queryClient: QueryClient, payload: GradeChangedPayload): void {
  queryClient.setQueryData<Dashboard>(["dashboard"], (current) => {
    if (!current || current.battery.id !== payload.batteryId) return current;
    return { ...current, anomaly: { ...current.anomaly, score: payload.score, grade: payload.to } };
  });
  void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  void queryClient.invalidateQueries({ queryKey: ["anomaly-summary"] });
  void queryClient.invalidateQueries({ queryKey: ["evidence"] });
  const me = queryClient.getQueryData<MeResponse>(["me"]);
  if (me) {
    const delta = Number(isActiveAnomalyGrade(payload.to)) - Number(isActiveAnomalyGrade(payload.from));
    queryClient.setQueryData<MeResponse>(["me"], { ...me, activeAnomalyCount: Math.max(0, me.activeAnomalyCount + delta) });
  } else void queryClient.invalidateQueries({ queryKey: ["me"] });
}

function updateDashboardCache(queryClient: QueryClient, update: (current: Dashboard) => Dashboard): void {
  queryClient.setQueryData<Dashboard>(["dashboard"], (current) => current ? update(current) : current);
}

export function socketUrlFor(baseUrl: string, token: string | null, demoEnabled: boolean): string {
  const url = new URL("/ws", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (demoEnabled && token) url.searchParams.set("access_token", token);
  return url.toString();
}

export function socketUrl(): string {
  const token = demoAuthToken();
  return socketUrlFor(apiBaseUrl(), token, token !== null);
}

export function useRealtime({ enabled, sessionKey, onAutoCut, onSessionEnded, onAuthFailure }: { enabled: boolean; sessionKey?: string; onAutoCut: (relay: unknown) => void; onSessionEnded: () => void; onAuthFailure: () => void }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<RealtimeState>(enabled ? "loading" : "idle");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [lastAt, setLastAt] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number | undefined>(undefined);
  const retryDelay = useRef(1000);
  const pingRef = useRef<number | undefined>(undefined);
  const pongDeadlineRef = useRef<number | undefined>(undefined);
  const cursorRef = useRef<string | null>(null);
  const sequenceRef = useRef<string | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const eventIdsRef = useRef(new Set<string>());
  const metricRef = useRef<DashboardMetricParam | undefined>(undefined);
  const callbacks = useRef({ onAutoCut, onSessionEnded, onAuthFailure });
  callbacks.current = { onAutoCut, onSessionEnded, onAuthFailure };

  useEffect(() => {
    if (!enabled) {
      setState("idle");
      setDashboard(null);
      return;
    }

    let disposed = false;
    cursorRef.current = null;
    sequenceRef.current = null;
    lastEventIdRef.current = null;
    eventIdsRef.current.clear();
    setDashboard(null);

    const clearTimers = () => {
      if (retryRef.current) window.clearTimeout(retryRef.current);
      if (pingRef.current) window.clearInterval(pingRef.current);
      if (pongDeadlineRef.current) window.clearTimeout(pongDeadlineRef.current);
    };

    const fetchSnapshot = async () => {
      const raw = await api.get<Record<string, unknown>>("/api/dashboard", metricRef.current ? { metric: metricRef.current } : undefined);
      const snapshot = normalizeDashboard(raw);
      cursorRef.current = snapshot.snapshotCursor;
      setDashboard(snapshot);
      queryClient.setQueryData(["dashboard"], snapshot);
      return snapshot;
    };

    const resyncQueries = async () => {
      const [me, rawDashboard, alertSummary, relay, diagnosis] = await Promise.all([
        api.me(),
        api.get<Record<string, unknown>>("/api/dashboard", metricRef.current ? { metric: metricRef.current } : undefined),
        api.get<Record<string, unknown>>("/api/alerts/summary"),
        api.get<Relay>("/api/relay"),
        api.get<Diagnosis | null>("/api/diagnosis/active"),
      ]);
      const snapshot = normalizeDashboard(rawDashboard);
      cursorRef.current = snapshot.snapshotCursor;
      sequenceRef.current = null;
      lastEventIdRef.current = null;
      eventIdsRef.current.clear();
      setDashboard(snapshot);
      queryClient.setQueryData(["me"], me satisfies MeResponse);
      queryClient.setQueryData(["dashboard"], snapshot);
      queryClient.setQueryData(["alert-summary"], alertSummary);
      queryClient.setQueryData(["relay"], relay);
      queryClient.setQueryData(["diagnosis"], diagnosis);
      return snapshot;
    };

    const send = (message: ClientWsMessage) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(message));
    };

    const connect = async (intent: ReconnectIntent) => {
      if (disposed) return;
      try {
        setState(intent === "initial" ? "loading" : intent === "resync" ? "resyncing" : "reconnecting");
        if (intent === "resync") await resyncQueries();
        else if (requiresSnapshotAnchor(intent, cursorRef.current)) await fetchSnapshot();
        if (disposed) return;
        // normalizeDashboard() throws when the response has no snapshotCursor,
        // so a successful anchor always leaves a real cursor behind.
        const afterCursor = cursorRef.current;
        if (afterCursor === null) throw new Error("MISSING_SNAPSHOT_CURSOR");
        setState("connecting");
        const ws = new WebSocket(socketUrl());
        socketRef.current = ws;
        ws.onopen = () => {
          retryDelay.current = 1000;
          setState("live");
          const requestId = `${intent}-${Date.now()}`;
          send(intent === "resume"
            ? buildResumeMessage(afterCursor, lastEventIdRef.current, requestId)
            : buildSubscribeMessage(afterCursor, requestId));
          pingRef.current = window.setInterval(() => {
            send(buildPingMessage());
            if (pongDeadlineRef.current) window.clearTimeout(pongDeadlineRef.current);
            pongDeadlineRef.current = window.setTimeout(() => ws.close(4408, "heartbeat timeout"), 10_000);
          }, 30_000);
        };
        ws.onmessage = (message) => {
          let envelope: WsEnvelope;
          try { envelope = JSON.parse(String(message.data)) as WsEnvelope; } catch { return; }
          if (envelope.eventId && eventIdsRef.current.has(envelope.eventId)) return;
          if (!sequenceIsNew(envelope.sequence, sequenceRef.current) && envelope.type !== "pong") return;
          if (envelope.eventId) {
            eventIdsRef.current.add(envelope.eventId);
            lastEventIdRef.current = envelope.eventId;
            if (eventIdsRef.current.size > 10_000) {
              const first = eventIdsRef.current.values().next().value;
              if (first) eventIdsRef.current.delete(first);
            }
          }
          if (envelope.sequence) sequenceRef.current = envelope.sequence;
          if (envelope.cursor) cursorRef.current = envelope.cursor;
          if (envelope.at) setLastAt(envelope.at);
          if (envelope.type === "pong") {
            if (pongDeadlineRef.current) window.clearTimeout(pongDeadlineRef.current);
            return;
          }
          if (envelope.type === "metrics.tick") {
            try {
              const metrics = normalizeDashboardMetrics(envelope.payload);
              const applyMetrics = (current: Dashboard): Dashboard => {
                const measurementPhase = measurementPhaseFor(current.session.startedAt, metrics.measuredAt);
                return {
                  ...current,
                  metrics,
                  quickTrend: measurementPhase === "MEASURING"
                    ? appendDashboardTrendPoint(current.quickTrend, metrics, metricRef.current, current.session.startedAt)
                    : current.quickTrend,
                  session: measurementPhase === "MEASURING" ? { ...current.session, measurementPhase } : current.session,
                };
              };
              setDashboard((current) => {
                if (!current) return current;
                return applyMetrics(current);
              });
              updateDashboardCache(queryClient, applyMetrics);
              const dashboard = queryClient.getQueryData<Dashboard>(["dashboard"]);
              if (dashboard && measurementPhaseFor(dashboard.session.startedAt, metrics.measuredAt) === "MEASURING") {
                queryClient.setQueryData<Dashboard>(["dashboard"], { ...dashboard, session: { ...dashboard.session, measurementPhase: "MEASURING" } });
                queryClient.setQueryData<MeResponse>(["me"], (current) => current?.activeSession?.id === dashboard.session.id
                  ? { ...current, activeSession: { ...current.activeSession, measurementPhase: "MEASURING" } }
                  : current);
              }
            } catch {
              // Ignore malformed live frames and retain the last known snapshot.
            }
          }
          else if (envelope.type === "anomaly.score") {
            try {
              const anomaly = normalizeDashboardAnomaly(envelope.payload);
              setDashboard((current) => current ? { ...current, anomaly } : current);
              updateDashboardCache(queryClient, (current) => ({ ...current, anomaly }));
              void queryClient.invalidateQueries({ queryKey: ["anomaly-summary"] });
              void queryClient.invalidateQueries({ queryKey: ["evidence"] });
            } catch {
              // Ignore malformed live frames and retain the last known snapshot.
            }
          }
          else if (envelope.type === "anomaly.gradeChanged" && isGradeChangedPayload(envelope.payload)) {
            const gradeChanged = envelope.payload;
            applyAnomalyGradeChanged(queryClient, gradeChanged);
            setDashboard((current) => current && current.battery.id === gradeChanged.batteryId ? { ...current, anomaly: { ...current.anomaly, score: gradeChanged.score, grade: gradeChanged.to } } : current);
          }
          else if (envelope.type === "relay.changed") {
            const current = queryClient.getQueryData<Dashboard>(["dashboard"]);
            if (current) {
              try {
                const relay = normalizeRelay({ ...current.relay, ...(envelope.payload as Partial<Relay>), batteryId: current.relay.batteryId });
                setDashboard((dashboard) => dashboard ? { ...dashboard, relay } : dashboard);
                updateDashboardCache(queryClient, (dashboard) => ({ ...dashboard, relay }));
                queryClient.setQueryData(["relay"], relay);
                void queryClient.invalidateQueries({ queryKey: ["relay-history"] });
              } catch {
                void queryClient.invalidateQueries({ queryKey: ["relay"] });
              }
            } else void queryClient.invalidateQueries({ queryKey: ["relay"] });
          }
          else if (envelope.type === "relay.autoCut") {
            callbacks.current.onAutoCut(envelope.payload);
            void queryClient.invalidateQueries({ queryKey: ["relay"] });
            void queryClient.invalidateQueries({ queryKey: ["relay-history"] });
          }
          else if (envelope.type === "alert.created" && isAlertPayload(envelope.payload)) applyAlertCreated(queryClient, envelope.payload);
          else if (envelope.type === "event.created" && isEventPayload(envelope.payload)) applyEventCreated(queryClient, envelope.payload);
          else if (envelope.type === "session.ended") {
            queryClient.setQueryData(["session-ended"], envelope.payload);
            void queryClient.invalidateQueries({ queryKey: ["me"] });
            void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
            callbacks.current.onSessionEnded();
          }
          else if (envelope.type === "device.status") {
            queryClient.setQueryData(["device-status"], envelope.payload);
            void queryClient.invalidateQueries({ queryKey: ["me"] });
          }
          else if (envelope.type === "diagnosis.progress" || envelope.type === "diagnosis.done" || envelope.type === "diagnosis.aborted") {
            const payload = envelope.payload as Partial<Diagnosis>;
            applyDiagnosisRealtimeEvent(queryClient, envelope.type, payload);
          }
          else if (envelope.type === "resync.required") {
            setState("resyncing");
            void resyncQueries().then(() => {
              const resyncCursor = cursorRef.current;
              if (!disposed && resyncCursor !== null) {
                setState("live");
                send(buildSubscribeMessage(resyncCursor, `resync-${Date.now()}`));
              }
            }).catch((error) => {
              if (!disposed) {
                setState("offline");
                if ((error as { code?: string }).code === "UNAUTHENTICATED") callbacks.current.onAuthFailure();
              }
            });
          }
        };
        ws.onclose = (event) => {
          if (pingRef.current) window.clearInterval(pingRef.current);
          if (pongDeadlineRef.current) window.clearTimeout(pongDeadlineRef.current);
          if (disposed) return;
          if (event.code === 4401 || event.code === 4403) { setState("expired"); callbacks.current.onAuthFailure(); return; }
          if (event.code === 4410) { void connect("resync"); return; }
          setState("reconnecting");
          const delay = retryDelay.current;
          retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
          retryRef.current = window.setTimeout(() => { void connect("resume"); }, delay);
        };
        ws.onerror = () => setState("offline");
      } catch (error) {
        if (disposed) return;
        if ((error as { code?: string }).code === "UNAUTHENTICATED") { setState("expired"); callbacks.current.onAuthFailure(); return; }
        setState("offline");
        const delay = retryDelay.current;
        retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
        retryRef.current = window.setTimeout(() => { void connect(intent === "resume" ? "resume" : intent); }, delay);
      }
    };

    void connect("initial");
    return () => { disposed = true; clearTimers(); socketRef.current?.close(); socketRef.current = null; };
  }, [enabled, queryClient, sessionKey]);

  const refetchMetric = useCallback(async (metric: DashboardMetricParam) => {
    metricRef.current = metric;
    if (!enabled) return;
    try {
      const raw = await api.get<Record<string, unknown>>("/api/dashboard", { metric });
      const snapshot = normalizeDashboard(raw);
      setDashboard((current) => current ? { ...current, quickTrend: snapshot.quickTrend } : snapshot);
      queryClient.setQueryData<Dashboard>(["dashboard"], (current) => current ? { ...current, quickTrend: snapshot.quickTrend } : snapshot);
    } catch {
      // Keep the last known quick trend; a failed metric switch is not user-blocking.
    }
  }, [enabled, queryClient]);

  return { state, dashboard, lastAt, refetchMetric };
}
