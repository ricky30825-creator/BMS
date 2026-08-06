import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, apiBaseUrl } from "../api/client";
import { normalizeDashboard } from "../api/normalize";
import type { Dashboard, Relay, WsEnvelope } from "../types";

export type RealtimeState = "idle" | "loading" | "connecting" | "live" | "reconnecting" | "offline" | "expired" | "resyncing";

function socketUrl(): string {
  const url = new URL("/ws", apiBaseUrl());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function sequenceIsNew(next: string | undefined, previous: string | null): boolean {
  if (!next || previous === null) return true;
  try { return BigInt(next) > BigInt(previous); } catch { return next !== previous; }
}

export function useRealtime({ enabled, onAutoCut, onSessionEnded, onAuthFailure }: { enabled: boolean; onAutoCut: (relay: unknown) => void; onSessionEnded: () => void; onAuthFailure: () => void }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<RealtimeState>(enabled ? "loading" : "idle");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [lastAt, setLastAt] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number | undefined>(undefined);
  const retryDelay = useRef(1000);
  const pingRef = useRef<number | undefined>(undefined);
  const pongDeadlineRef = useRef<number | undefined>(undefined);
  const cursorRef = useRef("0");
  const sequenceRef = useRef<string | null>(null);
  const eventIdsRef = useRef(new Set<string>());
  const callbacks = useRef({ onAutoCut, onSessionEnded, onAuthFailure });
  callbacks.current = { onAutoCut, onSessionEnded, onAuthFailure };

  useEffect(() => {
    if (!enabled) { setState("idle"); return; }
    let disposed = false;
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
      return snapshot;
    };
    const send = (message: object) => { if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(message)); };
    const connect = async (resume: boolean) => {
      if (disposed) return;
      try {
        setState(resume ? "reconnecting" : "loading");
        const snapshot = await fetchSnapshot();
        if (disposed) return;
        setState("connecting");
        const ws = new WebSocket(socketUrl());
        socketRef.current = ws;
        ws.onopen = () => {
          retryDelay.current = 1000;
          setState("live");
          send({ type: resume ? "resume" : "subscribe", requestId: `sub-${Date.now()}`, topics: ["metrics", "anomaly", "relay", "alert", "event", "session"], afterCursor: cursorRef.current, ...(resume && sequenceRef.current ? { lastEventId: [...eventIdsRef.current].at(-1) } : {}) });
          pingRef.current = window.setInterval(() => {
            const requestId = `ping-${Date.now()}`;
            send({ type: "ping", requestId });
            if (pongDeadlineRef.current) window.clearTimeout(pongDeadlineRef.current);
            pongDeadlineRef.current = window.setTimeout(() => ws.close(4408, "heartbeat timeout"), 10_000);
          }, 30_000);
        };
        ws.onmessage = (message) => {
          let envelope: WsEnvelope;
          try { envelope = JSON.parse(String(message.data)) as WsEnvelope; } catch { return; }
          if (envelope.eventId && eventIdsRef.current.has(envelope.eventId)) return;
          if (envelope.eventId) { eventIdsRef.current.add(envelope.eventId); if (eventIdsRef.current.size > 10_000) eventIdsRef.current.delete(eventIdsRef.current.values().next().value as string); }
          if (!sequenceIsNew(envelope.sequence, sequenceRef.current) && envelope.type !== "pong") return;
          if (envelope.sequence) sequenceRef.current = envelope.sequence;
          if (envelope.cursor) cursorRef.current = envelope.cursor;
          if (envelope.at) setLastAt(envelope.at);
          if (envelope.type === "pong") { if (pongDeadlineRef.current) window.clearTimeout(pongDeadlineRef.current); return; }
          if (envelope.type === "metrics.tick") setDashboard((current) => current ? { ...current, metrics: envelope.payload as Dashboard["metrics"] } : current);
          else if (envelope.type === "anomaly.score") setDashboard((current) => current ? { ...current, anomaly: envelope.payload as Dashboard["anomaly"] } : current);
          else if (envelope.type === "relay.changed") setDashboard((current) => current ? { ...current, relay: envelope.payload as Relay } : current);
          else if (envelope.type === "relay.autoCut") callbacks.current.onAutoCut(envelope.payload);
          else if (envelope.type === "session.ended") callbacks.current.onSessionEnded();
          else if (envelope.type === "resync.required") {
            setState("resyncing");
            void Promise.all([
              fetchSnapshot(),
              queryClient.refetchQueries({ queryKey: ["me"] }),
              queryClient.refetchQueries({ queryKey: ["alert-summary"] }),
              queryClient.refetchQueries({ queryKey: ["relay"] }),
              queryClient.refetchQueries({ queryKey: ["diagnosis"] }),
            ]).then(() => { if (!disposed) { setState("live"); send({ type: "subscribe", requestId: `resync-${Date.now()}`, topics: ["metrics", "anomaly", "relay", "alert", "event", "session"], afterCursor: cursorRef.current }); } }).catch(() => setState("offline"));
          }
        };
        ws.onclose = (event) => {
          if (pingRef.current) window.clearInterval(pingRef.current);
          if (pongDeadlineRef.current) window.clearTimeout(pongDeadlineRef.current);
          if (disposed) return;
          if (event.code === 4401 || event.code === 4403) { setState("expired"); callbacks.current.onAuthFailure(); return; }
          if (event.code === 4410) { setState("resyncing"); void connect(true); return; }
          setState("reconnecting");
          const delay = retryDelay.current;
          retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
          retryRef.current = window.setTimeout(() => { void connect(true); }, delay);
        };
        ws.onerror = () => setState("offline");
      } catch (error) {
        if (disposed) return;
        if ((error as { code?: string }).code === "UNAUTHENTICATED") { setState("expired"); callbacks.current.onAuthFailure(); return; }
        setState("offline");
        const delay = retryDelay.current;
        retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
        retryRef.current = window.setTimeout(() => { void connect(true); }, delay);
      }
    };
    void connect(false);
    return () => { disposed = true; clearTimers(); socketRef.current?.close(); socketRef.current = null; };
  }, [enabled]);

  return { state, dashboard, lastAt };
}
