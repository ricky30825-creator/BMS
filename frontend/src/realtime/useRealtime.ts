import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, apiBaseUrl } from "../api/client";
import { normalizeDashboard } from "../api/normalize";
import type { Dashboard, Diagnosis, MeResponse, Relay, WsEnvelope } from "../types";

export type RealtimeState = "idle" | "loading" | "connecting" | "live" | "reconnecting" | "offline" | "expired" | "resyncing";
export type ReconnectIntent = "initial" | "resume" | "resync";

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

function socketUrl(): string {
  const url = new URL("/ws", apiBaseUrl());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
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
      const raw = await api.get<Record<string, unknown>>("/api/dashboard");
      const snapshot = normalizeDashboard(raw);
      cursorRef.current = snapshot.snapshotCursor;
      setDashboard(snapshot);
      queryClient.setQueryData(["dashboard"], snapshot);
      return snapshot;
    };

    const resyncQueries = async () => {
      const [me, rawDashboard, alertSummary, relay, diagnosis] = await Promise.all([
        api.me(),
        api.get<Record<string, unknown>>("/api/dashboard"),
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
        if (intent === "initial") await fetchSnapshot();
        if (intent === "resync") await resyncQueries();
        if (disposed) return;
        const afterCursor = cursorRef.current ?? "0";
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
          if (envelope.type === "metrics.tick") setDashboard((current) => current ? { ...current, metrics: envelope.payload as Dashboard["metrics"] } : current);
          else if (envelope.type === "anomaly.score") setDashboard((current) => current ? { ...current, anomaly: envelope.payload as Dashboard["anomaly"] } : current);
          else if (envelope.type === "relay.changed") setDashboard((current) => current ? { ...current, relay: envelope.payload as Relay } : current);
          else if (envelope.type === "relay.autoCut") callbacks.current.onAutoCut(envelope.payload);
          else if (envelope.type === "session.ended") callbacks.current.onSessionEnded();
          else if (envelope.type === "diagnosis.progress" || envelope.type === "diagnosis.done" || envelope.type === "diagnosis.aborted") {
            const payload = envelope.payload as Partial<Diagnosis>;
            const current = queryClient.getQueryData<Diagnosis | null>(["diagnosis"]);
            const next = applyDiagnosisEvent(current, envelope.type, payload);
            queryClient.setQueryData(["diagnosis"], envelope.type === "diagnosis.done" || envelope.type === "diagnosis.aborted" ? null : next);
            void queryClient.invalidateQueries({ queryKey: ["diagnosis"] });
            if (payload.id) {
              if (envelope.type === "diagnosis.done") queryClient.setQueryData(["diagnosis-detail", payload.id], payload as Diagnosis);
              void queryClient.invalidateQueries({ queryKey: ["diagnosis-detail", payload.id] });
            }
            if (envelope.type !== "diagnosis.progress") void queryClient.invalidateQueries({ queryKey: ["diagnosis-history"] });
          }
          else if (envelope.type === "resync.required") {
            setState("resyncing");
            void resyncQueries().then(() => {
              if (!disposed) {
                setState("live");
                send(buildSubscribeMessage(cursorRef.current ?? "0", `resync-${Date.now()}`));
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

  return { state, dashboard, lastAt };
}
