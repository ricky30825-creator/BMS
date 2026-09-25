import { createHash, randomUUID } from "node:crypto";

import type { CellGuardStore, CreateBatteryInput, CreateNoticeInput, IdempotencyResult, NoticeListQuery, UpdateBatteryInput, UpdateNoticeInput } from "./contract.js";
import { CSV_HEADER, INPUT_LIMITS, TREND_METRICS, csvRow } from "./types.js";
import type {
  AdminEventTrend,
  AdminNotice,
  AnomalyScoreRecord,
  DemoAudit,
  DemoBattery,
  DemoDiagnosis,
  DemoRelay,
  DemoSession,
  DemoStatus,
  DemoUser,
  DiagnosisProgress,
  DomainEvent,
  DomainEventQuery,
  EventTrendPeriod,
  FailsafeEngagementResult,
  TrendMetric,
  TrendResponse,
  NoticeCategory,
  NoticeDeliveryChannel,
  NoticeDeliveryIntent,
  NoticeDetail,
  NoticeStatus,
  OpsStatus,
  RecordDomainEventInput,
} from "./types.js";
import { quickPhases, totalDurationMs } from "../diagnosis/phases.js";
import { emptyTrendResponse, PHYSICAL_TREND_METRICS } from "../trendAggregate.js";

export function createMemoryStore(): CellGuardStore & { demoUsers: DemoUser[] } {
  function normalizeReason(value: string): string {
    const normalized = value.normalize("NFKC").trim();
    if (!normalized) throw new Error("REASON_REQUIRED");
    if (normalized.length > INPUT_LIMITS.reasonChars) throw new Error("INPUT_TOO_LONG");
    return normalized;
  }

  function normalizeMemo(value: string): string {
    const normalized = value.normalize("NFKC").trim();
    if (normalized.length > INPUT_LIMITS.memoChars) throw new Error("INPUT_TOO_LONG");
    return normalized;
  }

  function isoNow(): string {
    return new Date().toISOString();
  }

  function makeBattery(input: Omit<DemoBattery, "version" | "adminMemo" | "memo"> & { memo?: string }): DemoBattery {
    return { ...input, memo: input.memo ?? "", version: 0, adminMemo: "" };
  }

  const demoUsers: DemoUser[] = [
    { id: "hong", email: "hong@cellguard.io", name: "홍길동", role: "USER", status: "ACTIVE", phone: "010-1234-5678", joinedAt: "2025-03-12T00:00:00.000Z" },
    { id: "kimeng", email: "kim@lab.io", name: "김엔지", role: "USER", status: "ACTIVE", phone: "010-2345-6789", joinedAt: "2024-11-02T00:00:00.000Z" },
    { id: "leelab", email: "lee@lab.io", name: "이연구", role: "ADMIN", status: "ACTIVE", phone: "010-3456-7890", joinedAt: "2024-08-19T00:00:00.000Z" },
    { id: "parktest", email: "park@test.io", name: "박테스트", role: "USER", status: "SUSPENDED", phone: "010-4567-8901", joinedAt: "2025-06-10T00:00:00.000Z" }
  ];

  const demoBatteries: DemoBattery[] = [
    makeBattery({ id: "PACK-001", ownerId: "hong", label: "PACK-001", model: "18650 Li-ion · 3S", maker: "Samsung SDI", chemistry: "LI_ION", targetMode: 1, seriesCount: 3, capacityWh: null, ratedOutputCurrentA: null, opsStatus: "BLOCKED", latest: { voltageV: 11.9, currentA: -2.4, powerW: -28.56, tempContact: 58, tempIrSurface: 56.4, tempAmbient: 24.5, socPct: 78, score: 0.82, measuredAt: "2026-08-06T01:32:10.000Z" }, mode1Health: { designCapacityMah: 3000, fullChargeCapacityMah: 2760, cycleCount: 312, rulCycles: 480, internalResistanceMohm: 18.4, calculatedAt: "2026-08-06T00:00:00.000Z" } }),
    makeBattery({ id: "PACK-002", ownerId: "leelab", label: "PACK-002", model: "18650 Li-ion · 3S", maker: "Samsung SDI", chemistry: "LI_ION", targetMode: 1, seriesCount: 3, capacityWh: null, ratedOutputCurrentA: null, opsStatus: "NORMAL", latest: { voltageV: 11.4, currentA: -1.6, powerW: -18.24, tempContact: 29, tempIrSurface: 30.2, tempAmbient: 24.5, socPct: 91, score: 0.18, measuredAt: "2026-08-06T01:30:00.000Z" }, mode1Health: { designCapacityMah: 3000, fullChargeCapacityMah: 2820, cycleCount: 88, rulCycles: 560, internalResistanceMohm: 16.2, calculatedAt: "2026-08-06T00:00:00.000Z" } }),
    makeBattery({ id: "PACK-003", ownerId: "leelab", label: "PACK-003", model: "USB 보조배터리 · 37Wh", maker: null, chemistry: "LI_PO", targetMode: 2, seriesCount: null, capacityWh: 37, ratedOutputCurrentA: 2, opsStatus: "WATCH", latest: { voltageV: 5.1, currentA: -1.2, powerW: -6.12, tempContact: null, tempIrSurface: 34, tempAmbient: 24.5, socPct: 64, score: 0.33, measuredAt: "2026-08-06T01:29:00.000Z" } }),
    makeBattery({ id: "PACK-004", ownerId: "kimeng", label: "PACK-004", model: "USB 보조배터리 · 37Wh", maker: null, chemistry: "LI_PO", targetMode: 2, seriesCount: null, capacityWh: 37, ratedOutputCurrentA: 2, opsStatus: "WATCH", latest: { voltageV: 5, currentA: -1.9, powerW: -9.5, tempContact: null, tempIrSurface: 47, tempAmbient: 24.5, socPct: 47, score: 0.58, measuredAt: "2026-08-06T01:28:00.000Z" } }),
    makeBattery({ id: "PACK-005", ownerId: "parktest", label: "PACK-005", model: "USB 보조배터리 · 10Wh", maker: null, chemistry: "LI_PO", targetMode: 2, seriesCount: null, capacityWh: 10, ratedOutputCurrentA: 1, opsStatus: "NORMAL", latest: { voltageV: 5.1, currentA: 0.8, powerW: 4.08, tempContact: null, tempIrSurface: 31, tempAmbient: 24.5, socPct: 82, score: 0.24, measuredAt: "2026-08-06T01:27:00.000Z" } }),
    makeBattery({ id: "DEMO-PACK-001", ownerId: "hong", label: "DEMO-PACK-001", model: "Demo bench pack · safe fixture", maker: "CellGuard Lab", chemistry: "LI_ION", targetMode: 1, seriesCount: 3, capacityWh: null, ratedOutputCurrentA: null, opsStatus: "NORMAL", latest: { voltageV: 11.9, currentA: -2.4, powerW: -28.56, tempContact: 31.2, tempIrSurface: 30.4, tempAmbient: 24.5, socPct: 78, score: 0.18, measuredAt: "2026-08-06T01:31:00.000Z" }, mode1Health: { designCapacityMah: 3000, fullChargeCapacityMah: 2760, cycleCount: 12, rulCycles: 900, internalResistanceMohm: 18.4, calculatedAt: "2026-08-06T01:30:00.000Z" } }),
    makeBattery({ id: "PB-HONG-001", ownerId: "hong", label: "PB-HONG-001", model: "USB 보조배터리 · 37Wh", maker: "CellGuard Lab", chemistry: "LI_PO", targetMode: 2, seriesCount: null, capacityWh: 37, ratedOutputCurrentA: 2, opsStatus: "NORMAL", latest: { voltageV: 5.05, currentA: -1, powerW: -5.05, tempContact: null, tempIrSurface: 32.4, tempAmbient: 24.5, socPct: 88, score: 0.16, measuredAt: "2026-08-06T01:26:00.000Z" } }),
    makeBattery({ id: "PB-HONG-002", ownerId: "hong", label: "PB-HONG-002", model: "USB 보조배터리 · 37Wh · 기준선 보유", maker: "CellGuard Lab", chemistry: "LI_PO", targetMode: 2, seriesCount: null, capacityWh: 37, ratedOutputCurrentA: 2, opsStatus: "NORMAL", latest: { voltageV: 5.02, currentA: -1.4, powerW: -7.03, tempContact: null, tempIrSurface: 36.1, tempAmbient: 24.5, socPct: 71, score: 0.22, measuredAt: "2026-08-06T01:25:00.000Z" } }),
    // 시뮬레이터 해시상 collapseCurrentA≈1.94A라 빠른 진단 사다리(0.1~2.0A)를
    // 끝까지 버틴다 — hong 계정의 두 기존 픽스처(PB-HONG-001·002)는 각각
    // CAUTION·SUSPECT_DEGRADED로만 나와 이 기능을 시연할 때 정상 판정이
    // 한 번도 안 보였다(2026-09-01). 정본 데모 계정이 HEALTHY도 보여주게 한다.
    makeBattery({ id: "PB-HONG-OK", ownerId: "hong", label: "PB-HONG-OK", model: "USB 보조배터리 · 37Wh", maker: "CellGuard Lab", chemistry: "LI_PO", targetMode: 2, seriesCount: null, capacityWh: 37, ratedOutputCurrentA: 2, opsStatus: "NORMAL", latest: { voltageV: 5.08, currentA: -1, powerW: -5.08, tempContact: null, tempIrSurface: 32.1, tempAmbient: 24.5, socPct: 90, score: 0.12, measuredAt: "2026-08-06T01:24:00.000Z" } })
  ];

  type MemoryNotice = AdminNotice;

  // Memory mode is an explicitly isolated fixture provider. Production mode
  // never reads this array; it reads notice rows through store/postgres.ts.
  // Keeping the seed here, rather than in server.ts, exercises the same API
  // and filtering rules without pretending that a demo process has durable DB
  // state.
  const demoNoticeFixtures: MemoryNotice[] = [
    {
      id: "notice-maintenance",
      category: "MAINTENANCE",
      audience: "ALL",
      status: "PUBLISHED",
      title: "7월 정기 서버 점검 (무중단)",
      body: "7/7 00:00~04:00 인프라 점검이 진행됩니다. WebSocket 순단이 발생할 수 있으나 자동 재연결되며, 측정 데이터는 버퍼링 후 복원됩니다.",
      summary: "WebSocket 순단이 발생할 수 있으나 자동 재연결됩니다.",
      viewCount: 892,
      publishedAt: "2026-07-01T00:00:00.000Z",
      archivedAt: null,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      createdBy: "leelab",
      updatedBy: "leelab",
      deliveryIntents: [],
    },
    {
      id: "notice-feature",
      category: "FEATURE",
      audience: "ALL",
      status: "PUBLISHED",
      title: "이상 근거(XAI) 패널 정식 오픈",
      body: "이상 탐지 화면에서 서버가 제공하는 기여 요인을 확인할 수 있습니다.",
      summary: "이상점수 상승에 기여한 특징을 확인할 수 있습니다.",
      viewCount: 614,
      publishedAt: "2026-06-28T00:00:00.000Z",
      archivedAt: null,
      createdAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
      createdBy: "leelab",
      updatedBy: "leelab",
      deliveryIntents: [],
    },
    {
      id: "notice-info",
      category: "INFO",
      audience: "ALL",
      status: "PUBLISHED",
      title: "모드 2 진단 안전 프로필 안내",
      body: "현재 연결 부품 프로필은 안전 문턱과 연속 감시가 준비되지 않아 F21 진단을 실행할 수 없습니다.",
      summary: "실측 전까지 보조배터리 진단은 실행 잠금 상태입니다.",
      viewCount: 431,
      publishedAt: "2026-06-20T00:00:00.000Z",
      archivedAt: null,
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
      createdBy: "leelab",
      updatedBy: "leelab",
      deliveryIntents: [],
    },
  ];
  // Keep fixture rows under the same projection invariant as rows created by
  // the store. This still remains memory-only demo data; production never
  // loads it.
  for (const notice of demoNoticeFixtures) notice.summary = noticeSummary(notice.body);

  const demoSessions = new Map<string, DemoSession>();
  const demoRelays = new Map<string, DemoRelay>();
  const demoDiagnoses = new Map<string, DemoDiagnosis>();
  const domainEventsByDedupe = new Map<string, DomainEvent>();
  const noticesById = new Map<string, MemoryNotice>(demoNoticeFixtures.map((notice) => [notice.id, notice]));
  const noticeViews = new Map<string, string>();
  const noticeDeliveryIntentsById = new Map<string, NoticeDeliveryIntent[]>();

  // PB-HONG-002의 기준선 이력. 이게 없으면 정밀 용량 테스트가 항상
  // isBaseline: true라 sohRelPct가 나오는 화면을 볼 수 없다.
  demoDiagnoses.set("dg_seed_baseline", {
    id: "dg_seed_baseline",
    batteryId: "PB-HONG-002",
    sessionId: "ses_seed",
    kind: "CAPACITY",
    status: "COMPLETED",
    phase: "CAPACITY",
    input: { dischargeCurrentA: 1, fullyChargedConfirmed: true, acknowledged: true },
    result: {
      dataSource: "SIMULATED",
      capacity: {
        deliveredWh: 32.4, ratedWh: 37, baselineWh: null,
        sohRelPct: null, sohAbsPct: 99.5, assumedEfficiency: 0.88,
        dischargeCurrentA: 1, isBaseline: true, partial: false,
      },
    },
    startedAt: "2026-08-01T02:00:00.000Z",
    estimatedEndAt: "2026-08-01T09:20:00.000Z",
    completedAt: "2026-08-01T09:14:00.000Z",
    progress: null,
  });

  const demoAudits: DemoAudit[] = [];
  const idempotency = new Map<string, { hash: string; status: number; body: unknown }>();

  for (const battery of demoBatteries) {
    demoRelays.set(battery.id, {
      batteryId: battery.id,
      state: battery.opsStatus === "BLOCKED" ? "OPEN" : "CLOSED",
      interlockEngaged: battery.opsStatus === "BLOCKED",
      interlockCondition: battery.opsStatus === "BLOCKED" ? "TEMP_OVER_CAP" : null,
      reasonCode: battery.opsStatus === "BLOCKED" ? "FAILSAFE_TEMP_IR_OVER_CAP" : null,
      reason: null,
      changedAt: battery.latest.measuredAt ?? isoNow(),
      changedBy: "SYSTEM"
    });
  }

  // Internal logic stays synchronous so functions can call each other directly
  // without `await`/`this`. The returned object's methods are thin `async`
  // wrappers around these.
  const findUser = (id: string): DemoUser | undefined => { const user = demoUsers.find((item) => item.id === id); return user ? { ...user } : undefined; };
  const findBattery = (id: string): DemoBattery | undefined => { const battery = demoBatteries.find((item) => item.id === id); return battery ? { ...battery } : undefined; };
  const listUsers = (): DemoUser[] => demoUsers.map((user) => ({ ...user }));
  const listBatteries = (ownerId?: string): DemoBattery[] => demoBatteries.filter((battery) => !ownerId || battery.ownerId === ownerId).map((battery) => ({ ...battery }));
  const findActiveSession = (ownerId?: string): DemoSession | null => [...demoSessions.values()].find((session) => session.status === "ACTIVE" && (!ownerId || session.ownerId === ownerId)) ?? null;
  const listSessionsForBattery = (batteryId: string): DemoSession[] => [...demoSessions.values()].filter((session) => session.batteryId === batteryId).map((session) => ({ ...session }));
  const findSessionById = (id: string): DemoSession | undefined => { const session = demoSessions.get(id); return session ? { ...session } : undefined; };
  const findActiveDiagnosis = (batteryId?: string): DemoDiagnosis | null => [...demoDiagnoses.values()].find((diagnosis) => diagnosis.status === "RUNNING" && (!batteryId || diagnosis.batteryId === batteryId)) ?? null;
  const listDiagnosesForBattery = (batteryId: string): DemoDiagnosis[] => [...demoDiagnoses.values()].filter((diagnosis) => diagnosis.batteryId === batteryId).map((diagnosis) => ({ ...diagnosis }));
  const findDiagnosisById = (id: string): DemoDiagnosis | undefined => { const diagnosis = demoDiagnoses.get(id); return diagnosis ? { ...diagnosis } : undefined; };
  const readRelay = (id: string): DemoRelay => {
    if (!demoBatteries.some((battery) => battery.id === id)) throw new Error("NOT_FOUND");
    return { ...(demoRelays.get(id) ?? { batteryId: id, state: "CLOSED", interlockEngaged: false, interlockCondition: null, reasonCode: null, reason: null, changedAt: isoNow(), changedBy: "SYSTEM" }) };
  };
  const listAudits = (): DemoAudit[] => demoAudits.map((audit) => ({ ...audit }));

  const NOTICE_CATEGORIES = new Set<NoticeCategory>(["IMPORTANT", "MAINTENANCE", "FEATURE", "INFO"]);
  const NOTICE_STATUSES = new Set<NoticeStatus>(["DRAFT", "PUBLISHED", "ARCHIVED"]);
  const NOTICE_AUDIENCES = new Set<string>(["ALL", "USER", "ADMIN"]);
  const NOTICE_CHANNELS = new Set<NoticeDeliveryChannel>(["KAKAO", "EMAIL", "SMS", "WEBPUSH", "INAPP"]);
  const NOTICE_WINDOW_MS = 24 * 60 * 60 * 1000;

  function noticeText(value: unknown): string {
    if (typeof value !== "string") throw new Error("VALIDATION_FAILED");
    // Titles and bodies are user-authored free text and must round-trip as
    // entered. Unicode normalization is applied only to the derived summary.
    return value;
  }

  function noticeSummary(body: string): string {
    // Summary is a display-only projection: normalize Unicode and count code
    // points rather than UTF-16 code units. The body itself remains untouched.
    return Array.from(body.normalize("NFKC")).slice(0, 120).join("");
  }

  function assertNoticeInput(category: unknown, audience: unknown, status: unknown): asserts category is NoticeCategory {
    if (!NOTICE_CATEGORIES.has(category as NoticeCategory) || typeof audience !== "string" || !NOTICE_AUDIENCES.has(audience) || !NOTICE_STATUSES.has(status as NoticeStatus)) {
      throw new Error("VALIDATION_FAILED");
    }
  }

  function normalizeNoticeChannels(value: NoticeDeliveryChannel[] | undefined): NoticeDeliveryChannel[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((channel) => !NOTICE_CHANNELS.has(channel))) throw new Error("VALIDATION_FAILED");
    return [...new Set(value)];
  }

  function assertPublishable(title: string, body: string, status: NoticeStatus): void {
    if (status === "ARCHIVED" || (status === "PUBLISHED" && (!title.trim() || !body.trim()))) throw new Error("VALIDATION_FAILED");
  }

  function publicNotice(notice: MemoryNotice): NoticeDetail {
    if (notice.status !== "PUBLISHED" || (notice.audience !== "ALL" && notice.audience !== "USER")) throw new Error("NOT_FOUND");
    if (!notice.publishedAt) throw new Error("NOT_FOUND");
    return {
      id: notice.id,
      category: notice.category,
      title: notice.title,
      summary: notice.summary,
      body: notice.body,
      publishedAt: notice.publishedAt,
    };
  }

  function noticeSortKey(notice: MemoryNotice): number {
    return Date.parse(notice.publishedAt ?? notice.createdAt) || 0;
  }

  function validateNoticeQuery(query: NoticeListQuery = {}): void {
    if (query.category !== undefined && !NOTICE_CATEGORIES.has(query.category)) throw new Error("VALIDATION_FAILED");
    if (query.status !== undefined && !NOTICE_STATUSES.has(query.status)) throw new Error("VALIDATION_FAILED");
    if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 0)) throw new Error("VALIDATION_FAILED");
    if (query.offset !== undefined && (!Number.isInteger(query.offset) || query.offset < 0)) throw new Error("VALIDATION_FAILED");
  }

  function applyNoticePage<T>(items: T[], query: NoticeListQuery): T[] {
    const offset = query.offset ?? 0;
    const limit = query.limit ?? items.length;
    return items.slice(offset, offset + limit);
  }

  function addDeliveryIntents(noticeId: string, channels: NoticeDeliveryChannel[]): void {
    if (!channels.length) return;
    // There is intentionally no provider in this repository. A durable intent
    // is recorded as BLOCKED, never as SENT, until a configured provider worker
    // can actually deliver it.
    const intents = noticeDeliveryIntentsById.get(noticeId) ?? [];
    for (const channel of channels) {
      if (intents.some((intent) => intent.channel === channel)) continue;
      const requestedAt = isoNow();
      intents.push({
        id: `delivery_${randomUUID()}`,
        noticeId,
        channel,
        status: "BLOCKED",
        requestedAt,
        sentAt: null,
        providerMessageId: null,
        lastError: "PROVIDER_NOT_CONFIGURED",
      });
    }
    noticeDeliveryIntentsById.set(noticeId, intents);
  }

  function createNoticeInMemory(actorId: string, input: CreateNoticeInput): MemoryNotice {
    const status = input.status ?? "DRAFT";
    assertNoticeInput(input.category, input.audience, status);
    if (status === "ARCHIVED") throw new Error("VALIDATION_FAILED");
    const title = noticeText(input.title);
    const body = noticeText(input.body);
    assertPublishable(title, body, status);
    const now = isoNow();
    const notice: MemoryNotice = {
      id: `notice_${randomUUID()}`,
      category: input.category,
      audience: input.audience,
      status,
      title,
      body,
      summary: noticeSummary(body),
      viewCount: 0,
      publishedAt: status === "PUBLISHED" ? now : null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actorId,
      updatedBy: actorId,
      deliveryIntents: [],
    };
    noticesById.set(notice.id, notice);
    const channels = normalizeNoticeChannels(input.notifyChannels);
    if (status === "PUBLISHED") addDeliveryIntents(notice.id, channels);
    notice.deliveryIntents = noticeDeliveryIntentsById.get(notice.id) ?? [];
    audit({ actorId, action: status === "PUBLISHED" ? "NOTICE_PUBLISH" : "NOTICE_CREATE", resource: notice.id, result: "SUCCESS", reason: null });
    return structuredClone(notice);
  }

  function updateNoticeInMemory(actorId: string, noticeId: string, input: UpdateNoticeInput): MemoryNotice {
    const notice = noticesById.get(noticeId);
    if (!notice) throw new Error("NOT_FOUND");
    if (notice.status === "ARCHIVED") throw new Error("VALIDATION_FAILED");
    const nextStatus = input.status ?? notice.status;
    const category = input.category ?? notice.category;
    const audience = input.audience ?? notice.audience;
    const title = input.title === undefined ? notice.title : noticeText(input.title);
    const body = input.body === undefined ? notice.body : noticeText(input.body);
    assertNoticeInput(category, audience, nextStatus);
    if (notice.status === "PUBLISHED" && nextStatus !== "PUBLISHED") throw new Error("VALIDATION_FAILED");
    if (notice.status === "DRAFT" && nextStatus === "ARCHIVED") throw new Error("VALIDATION_FAILED");
    assertPublishable(title, body, nextStatus);
    const channels = normalizeNoticeChannels(input.notifyChannels);
    if (notice.status === "PUBLISHED" && channels.length) throw new Error("VALIDATION_FAILED");
    if (
      category === notice.category
      && audience === notice.audience
      && title === notice.title
      && body === notice.body
      && nextStatus === notice.status
    ) throw new Error("VALIDATION_FAILED");
    const wasDraft = notice.status === "DRAFT";
    notice.category = category;
    notice.audience = audience;
    notice.title = title;
    notice.body = body;
    notice.summary = noticeSummary(body);
    notice.status = nextStatus;
    notice.updatedAt = isoNow();
    notice.updatedBy = actorId;
    if (wasDraft && nextStatus === "PUBLISHED") {
      notice.publishedAt = notice.publishedAt ?? notice.updatedAt;
      addDeliveryIntents(notice.id, channels);
    }
    notice.deliveryIntents = noticeDeliveryIntentsById.get(notice.id) ?? [];
    audit({ actorId, action: wasDraft && nextStatus === "PUBLISHED" ? "NOTICE_PUBLISH" : "NOTICE_UPDATE", resource: notice.id, result: "SUCCESS", reason: null });
    return structuredClone(notice);
  }

  function archiveNoticeInMemory(actorId: string, noticeId: string): MemoryNotice {
    const notice = noticesById.get(noticeId);
    if (!notice) throw new Error("NOT_FOUND");
    if (notice.status !== "PUBLISHED") throw new Error("VALIDATION_FAILED");
    notice.status = "ARCHIVED";
    notice.archivedAt = isoNow();
    notice.updatedAt = notice.archivedAt;
    notice.updatedBy = actorId;
    audit({ actorId, action: "NOTICE_ARCHIVE", resource: notice.id, result: "SUCCESS", reason: null });
    return structuredClone(notice);
  }

  function deleteNoticeInMemory(actorId: string, noticeId: string): void {
    const notice = noticesById.get(noticeId);
    if (!notice) throw new Error("NOT_FOUND");
    if (notice.status !== "DRAFT") throw new Error("NOTICE_NOT_DELETABLE");
    noticesById.delete(noticeId);
    noticeDeliveryIntentsById.delete(noticeId);
    for (const key of [...noticeViews.keys()]) if (key.startsWith(`${noticeId}:`)) noticeViews.delete(key);
    audit({ actorId, action: "NOTICE_DELETE", resource: noticeId, result: "SUCCESS", reason: null });
  }

  const listPublicNotices = (query: NoticeListQuery = {}): import("./types.js").NoticeSummary[] => {
    validateNoticeQuery(query);
    const items = [...noticesById.values()]
      .filter((notice) => notice.status === "PUBLISHED" && (notice.audience === "ALL" || notice.audience === "USER"))
      .filter((notice) => !query.category || notice.category === query.category)
      .sort((left, right) => noticeSortKey(right) - noticeSortKey(left) || right.id.localeCompare(left.id))
      .map((notice) => {
        if (!notice.publishedAt) throw new Error("INTERNAL_ERROR");
        return { id: notice.id, category: notice.category, title: notice.title, summary: notice.summary, publishedAt: notice.publishedAt };
      });
    return applyNoticePage(items, query).map((item) => structuredClone(item));
  };

  const listAdminNotices = (query: NoticeListQuery = {}): MemoryNotice[] => {
    validateNoticeQuery(query);
    const items = [...noticesById.values()]
      .filter((notice) => !query.category || notice.category === query.category)
      .filter((notice) => !query.status || notice.status === query.status)
      .sort((left, right) => noticeSortKey(right) - noticeSortKey(left) || right.id.localeCompare(left.id));
    return applyNoticePage(items, query).map((notice) => structuredClone(notice));
  };

  const publicNoticeForUser = (noticeId: string, viewerId: string): NoticeDetail | undefined => {
    const notice = noticesById.get(noticeId);
    if (!notice || notice.status !== "PUBLISHED" || (notice.audience !== "ALL" && notice.audience !== "USER")) return undefined;
    const key = `${noticeId}:${viewerId}`;
    const previous = noticeViews.get(key);
    const previousMs = previous ? Date.parse(previous) : Number.NaN;
    const nowMs = Date.now();
    if (!Number.isFinite(previousMs) || nowMs - previousMs >= NOTICE_WINDOW_MS) {
      notice.viewCount += 1;
      noticeViews.set(key, new Date(nowMs).toISOString());
    }
    return publicNotice(notice);
  };

  const DOMAIN_EVENT_SEVERITIES = new Set(["NORMAL", "CAUTION", "WARNING", "DANGER", "CUT"]);
  const DOMAIN_EVENT_SOURCES = new Set(["SYSTEM", "AI", "INGEST", "USER"]);

  const recordDomainEvent = (input: RecordDomainEventInput): DomainEvent => {
    const dedupeKey = input.dedupeKey.normalize("NFKC").trim();
    if (!dedupeKey) throw new Error("VALIDATION_FAILED");
    const existing = domainEventsByDedupe.get(dedupeKey);
    if (existing) return structuredClone(existing);
    if (!DOMAIN_EVENT_SEVERITIES.has(input.severity) || !DOMAIN_EVENT_SOURCES.has(input.source) || !input.eventType.trim()) {
      throw new Error("VALIDATION_FAILED");
    }
    const occurredMs = Date.parse(input.occurredAt);
    if (!Number.isFinite(occurredMs)) throw new Error("VALIDATION_FAILED");
    const score = input.score ?? null;
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > 1)) throw new Error("VALIDATION_FAILED");
    const event: DomainEvent = {
      id: input.id?.normalize("NFKC").trim() || `evt_${randomUUID()}`,
      eventType: input.eventType,
      severity: input.severity,
      source: input.source,
      deviceId: input.deviceId ?? null,
      batteryId: input.batteryId ?? null,
      sessionId: input.sessionId ?? null,
      occurredAt: new Date(occurredMs).toISOString(),
      score,
      params: structuredClone(input.params ?? {}),
      acknowledgedAt: null,
      acknowledgedBy: null,
      dedupeKey,
      createdAt: isoNow(),
    };
    domainEventsByDedupe.set(dedupeKey, event);
    return structuredClone(event);
  };

  const eventById = (id: string): DomainEvent | undefined => {
    for (const event of domainEventsByDedupe.values()) {
      if (event.id === id) return structuredClone(event);
    }
    return undefined;
  };

  const listDomainEvents = (query: DomainEventQuery = {}): DomainEvent[] => {
    const eventTypes = query.eventType === undefined ? null : new Set(Array.isArray(query.eventType) ? query.eventType : [query.eventType]);
    const severities = query.severity === undefined ? null : new Set(Array.isArray(query.severity) ? query.severity : [query.severity]);
    const fromMs = query.from === undefined ? null : Date.parse(query.from);
    const toMs = query.to === undefined ? null : Date.parse(query.to);
    if ((fromMs !== null && !Number.isFinite(fromMs)) || (toMs !== null && !Number.isFinite(toMs))) throw new Error("VALIDATION_FAILED");
    if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 0)) throw new Error("VALIDATION_FAILED");
    if (query.offset !== undefined && (!Number.isInteger(query.offset) || query.offset < 0)) throw new Error("VALIDATION_FAILED");
    const filtered = [...domainEventsByDedupe.values()]
      .filter((event) => {
        const occurredMs = Date.parse(event.occurredAt);
        const battery = event.batteryId ? demoBatteries.find((item) => item.id === event.batteryId) : undefined;
        return (!query.ownerId || battery?.ownerId === query.ownerId)
          && (!query.batteryId || event.batteryId === query.batteryId)
          && (!query.deviceId || event.deviceId === query.deviceId)
          && (!eventTypes || eventTypes.has(event.eventType))
          && (!severities || severities.has(event.severity))
          && (fromMs === null || occurredMs >= fromMs)
          && (toMs === null || occurredMs < toMs)
          && (query.acknowledged === undefined || (event.acknowledgedAt !== null) === query.acknowledged);
      })
      .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt) || right.id.localeCompare(left.id));
    const offset = query.offset ?? 0;
    const limit = query.limit === undefined ? filtered.length : query.limit;
    return filtered.slice(offset, offset + limit).map((event) => structuredClone(event));
  };

  const eventTrend = (period: EventTrendPeriod): AdminEventTrend => {
    if (period !== "24h" && period !== "7d" && period !== "30d") throw new Error("VALIDATION_FAILED");
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const hourMs = 60 * 60 * 1000;
    const count = period === "24h" ? 25 : period === "7d" ? 7 : 30;
    const stepMs = period === "24h" ? hourMs : dayMs;
    const endMs = period === "24h"
      ? Math.floor(now / hourMs) * hourMs
      : Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
    const startMs = endMs - (count - 1) * stepMs;
    const buckets = Array.from({ length: count }, (_, index) => ({
      at: new Date(startMs + index * stepMs).toISOString(),
      caution: 0,
      warning: 0,
      danger: 0,
    }));
    for (const event of domainEventsByDedupe.values()) {
      if (event.eventType !== "ANOMALY_GRADE_CHANGED") continue;
      const at = Date.parse(event.occurredAt);
      const index = Math.floor((at - startMs) / stepMs);
      if (index < 0 || index >= count) continue;
      const bucket = buckets[index];
      if (event.severity === "CAUTION") bucket.caution += 1;
      else if (event.severity === "WARNING") bucket.warning += 1;
      else if (event.severity === "DANGER") bucket.danger += 1;
    }
    const total = buckets.reduce((sum, bucket) => sum + bucket.caution + bucket.warning + bucket.danger, 0);
    const dangerTotal = buckets.reduce((sum, bucket) => sum + bucket.danger, 0);
    // Scan from oldest to newest and update only on a strictly larger total;
    // this makes an equal peak retain the earliest bucket by contract.
    let peakTotal = 0;
    let peakIndex = -1;
    buckets.forEach((bucket, index) => {
      const bucketTotal = bucket.caution + bucket.warning + bucket.danger;
      if (bucketTotal > peakTotal) {
        peakTotal = bucketTotal;
        peakIndex = index;
      }
    });
    return {
      period,
      buckets,
      summary: { total, dangerTotal, peakAt: peakIndex < 0 ? null : buckets[peakIndex].at, peakTotal },
    };
  };

  const trendForBatteries = (batteryIds: readonly string[], period: EventTrendPeriod, metrics: readonly TrendMetric[] = PHYSICAL_TREND_METRICS): TrendResponse => {
    const uniqueIds = new Set(batteryIds);
    if (uniqueIds.size !== batteryIds.length || new Set(metrics).size !== metrics.length || metrics.length === 0 || metrics.some((metric) => !TREND_METRICS.includes(metric))) {
      throw new Error("VALIDATION_FAILED");
    }
    const labels = new Map<string, string>();
    for (const batteryId of batteryIds) {
      const battery = findBattery(batteryId);
      if (!battery) throw new Error("NOT_FOUND");
      labels.set(battery.id, battery.label);
    }
    // Memory is an explicitly isolated fixture provider. It has no persisted
    // telemetry history, so it returns a correctly shaped all-null series
    // rather than turning the latest fixture reading into a fake trend.
    return emptyTrendResponse(batteryIds, labels, period, metrics);
  };

  const audit = (input: Omit<DemoAudit, "id" | "at">): DemoAudit => {
    const entry = { ...input, id: `audit_${randomUUID()}`, at: isoNow() };
    demoAudits.unshift(entry);
    return entry;
  };

  const addBattery = (ownerId: string, input: CreateBatteryInput): DemoBattery => {
    const label = input.label.normalize("NFKC").trim();
    if (!label) throw new Error("BATTERY_NAME_REQUIRED");
    if (label.length > 120) throw new Error("INPUT_TOO_LONG");
    if (input.targetMode === 2 && !(Number(input.capacityWh) > 0)) throw new Error("CAPACITY_REQUIRED");
    if (input.targetMode === 2 && !(Number(input.ratedOutputCurrentA) > 0)) throw new Error("RATED_CURRENT_REQUIRED");
    const battery = makeBattery({
      id: `bat_${randomUUID()}`,
      ownerId,
      label,
      model: input.model?.normalize("NFKC").trim() || "",
      maker: input.maker?.normalize("NFKC").trim() || null,
      chemistry: input.chemistry,
      targetMode: input.targetMode,
      seriesCount: input.targetMode === 1 ? input.seriesCount ?? null : null,
      capacityWh: input.capacityWh ?? null,
      ratedOutputCurrentA: input.ratedOutputCurrentA ?? null,
      opsStatus: "NORMAL",
      memo: "",
      latest: { voltageV: null, currentA: null, powerW: null, tempContact: null, tempIrSurface: null, tempAmbient: null, socPct: null, score: null, measuredAt: null }
    });
    demoBatteries.push(battery);
    demoRelays.set(battery.id, { batteryId: battery.id, state: "CLOSED", interlockEngaged: false, interlockCondition: null, reasonCode: null, reason: null, changedAt: isoNow(), changedBy: "SYSTEM" });
    return { ...battery };
  };

  const editBattery = (ownerId: string, batteryId: string, input: UpdateBatteryInput): DemoBattery => {
    const battery = demoBatteries.find((item) => item.id === batteryId && item.ownerId === ownerId);
    if (!battery) throw new Error("NOT_FOUND");
    if (input.label !== undefined) {
      const label = input.label.normalize("NFKC").trim();
      if (!label) throw new Error("BATTERY_NAME_REQUIRED");
      if (label.length > 120) throw new Error("INPUT_TOO_LONG");
      battery.label = label;
    }
    if (input.maker !== undefined) battery.maker = input.maker?.normalize("NFKC").trim() || null;
    if (input.model !== undefined) battery.model = input.model?.normalize("NFKC").trim() || "";
    if (input.seriesCount !== undefined) battery.seriesCount = input.seriesCount;
    if (input.memo !== undefined) battery.memo = normalizeMemo(input.memo);
    return { ...battery };
  };

  const checkIdempotent = (actorId: string, key: string, body: unknown): IdempotencyResult => {
    const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const mapKey = `${actorId}:${key}`;
    const previous = idempotency.get(mapKey);
    if (!previous) return { kind: "new" };
    if (previous.hash !== hash) return { kind: "conflict" };
    return { kind: "replay", status: previous.status, body: previous.body };
  };

  const storeIdempotency = (actorId: string, key: string, body: unknown, status: number, response: unknown): void => {
    idempotency.set(`${actorId}:${key}`, { hash: createHash("sha256").update(JSON.stringify(body)).digest("hex"), status, body: response });
  };

  const beginSession = (ownerId: string, batteryId: string): DemoSession => {
    const battery = findBattery(batteryId);
    if (!battery) throw new Error("NOT_FOUND");
    if (battery.ownerId !== ownerId) throw new Error("NOT_FOUND");
    if (battery.opsStatus === "BLOCKED") throw new Error("BATTERY_BLOCKED");
    // The physical interlock permits one active battery and one active session
    // for the whole installation, not one session per user.
    const current = findActiveSession();
    if (current) {
      current.status = "ENDED";
      current.endReason = "SUPERSEDED";
      current.endedAt = isoNow();
      audit({ actorId: ownerId, action: "SESSION_AUTO_END", resource: current.id, result: "SUCCESS", reason: "SUPERSEDED" });
    }
    const session: DemoSession = { id: `ses_${randomUUID()}`, batteryId, ownerId, deviceId: "demo-device-01", targetMode: battery.targetMode, status: "ACTIVE", endReason: null, startedAt: isoNow(), endedAt: null };
    demoSessions.set(session.id, session);
    audit({ actorId: ownerId, action: "SESSION_START", resource: session.id, result: "SUCCESS", reason: null });
    return { ...session };
  };

  const setOpsStatus = (actorId: string, batteryId: string, next: OpsStatus, reason: string, expectedVersion?: number): DemoBattery => {
    const battery = demoBatteries.find((item) => item.id === batteryId);
    if (!battery) throw new Error("NOT_FOUND");
    if (battery.opsStatus === next) throw new Error("NO_STATUS_CHANGE");
    const normalizedReason = normalizeReason(reason);
    if (expectedVersion !== undefined && expectedVersion !== battery.version) throw new Error("VERSION_CONFLICT");
    battery.opsStatus = next;
    battery.version += 1;
    audit({ actorId, action: "BATTERY_OPS_STATUS_CHANGE", resource: batteryId, result: "SUCCESS", reason: normalizedReason });
    if (next === "BLOCKED") {
      const session = findActiveSession(battery.ownerId);
      if (session && session.batteryId === batteryId) {
        session.status = "ENDED";
        session.endReason = "BLOCKED";
        session.endedAt = isoNow();
        audit({ actorId: "SYSTEM", action: "SESSION_AUTO_END", resource: session.id, result: "SUCCESS", reason: "BLOCKED" });
      }
    }
    return { ...battery };
  };

  const setMemo = (actorId: string, batteryId: string, memo: string, expectedVersion?: number): DemoBattery => {
    const battery = demoBatteries.find((item) => item.id === batteryId);
    if (!battery) throw new Error("NOT_FOUND");
    if (expectedVersion !== undefined && expectedVersion !== battery.version) throw new Error("VERSION_CONFLICT");
    battery.adminMemo = normalizeMemo(memo);
    battery.version += 1;
    audit({ actorId, action: "BATTERY_MEMO_UPDATE", resource: batteryId, result: "SUCCESS", reason: null });
    return { ...battery };
  };

  const setUserStatus = (actorId: string, userId: string, status: DemoStatus, reason: string): DemoUser => {
    const user = demoUsers.find((item) => item.id === userId);
    if (!user) throw new Error("NOT_FOUND");
    const normalizedReason = normalizeReason(reason);
    if (actorId === userId && status === "SUSPENDED") throw new Error("SELF_SUSPEND_FORBIDDEN");
    if (user.status === status) throw new Error("NO_STATUS_CHANGE");
    user.status = status;
    audit({ actorId, action: status === "SUSPENDED" ? "USER_SUSPEND" : "USER_RESTORE", resource: userId, result: "SUCCESS", reason: normalizedReason });
    return { ...user };
  };

  const setRelay = (actorId: string, batteryId: string, action: "cut" | "restore", reason: string): DemoRelay => {
    const battery = findBattery(batteryId);
    if (!battery) throw new Error("NOT_FOUND");
    if (battery.ownerId !== actorId) throw new Error("NOT_FOUND");
    const normalizedReason = normalizeReason(reason);
    const current = readRelay(batteryId);
    if (action === "restore" && current.interlockEngaged) throw new Error("INTERLOCK_LOCKED");
    const next: DemoRelay = {
      ...current,
      state: action === "cut" ? "OPEN" : "CLOSED",
      changedAt: isoNow(),
      changedBy: actorId,
      reason: normalizedReason,
      interlockEngaged: action === "cut" ? current.interlockEngaged : false,
      interlockCondition: action === "cut" ? current.interlockCondition : null,
      reasonCode: action === "cut" ? current.reasonCode : null
    };
    demoRelays.set(batteryId, next);
    audit({ actorId, action: action === "cut" ? "RELAY_CUT" : "RELAY_RESTORE", resource: batteryId, result: "SUCCESS", reason: normalizedReason });
    return { ...next };
  };

  // Server Fail-Safe only. Unlike setRelay (user action), this ENGAGES the
  // interlock. It is the only path that sets interlockEngaged at runtime.
  // The relay transition, audit, and domain event are one in-memory unit.
  // An already-engaged interlock is an idempotent no-op.
  const engage = (batteryId: string, triggerCode: string, condition: string): FailsafeEngagementResult => {
    const battery = findBattery(batteryId);
    if (!battery) throw new Error("NOT_FOUND");
    const current = readRelay(batteryId);
    if (current.interlockEngaged) return { relay: { ...current }, newlyEngaged: false };
    const next: DemoRelay = {
      ...current,
      state: "OPEN",
      interlockEngaged: true,
      interlockCondition: condition,
      reasonCode: triggerCode,
      reason: null,
      changedAt: isoNow(),
      changedBy: "SYSTEM"
    };
    demoRelays.set(batteryId, next);
    audit({ actorId: "SYSTEM", action: "RELAY_AUTO_CUT", resource: batteryId, result: "SUCCESS", reason: triggerCode });
    recordDomainEvent({
      eventType: "RELAY_AUTO_CUT",
      severity: "CUT",
      source: "SYSTEM",
      batteryId,
      occurredAt: next.changedAt,
      params: { triggerCode, condition },
      dedupeKey: `failsafe:${batteryId}:${triggerCode}:${condition}`,
    });
    return { relay: { ...next }, newlyEngaged: true };
  };

  // 빠른 진단은 단계 합계(120초), 정밀 용량은 스펙 §4-1 ②의
  // `ratedWh / (V_light × 방전전류)`다. 시작 시점에는 V_light를 아직 모르므로
  // 공칭 5.0V로 추정한다 — P0 집계가 끝나면 러너가 더 정확한 값을 갖지만,
  // 예상 시각은 안내용이라 다시 계산하지 않는다.
  const NOMINAL_OUTPUT_V = 5.0;

  const estimatedEnd = (kind: "QUICK" | "CAPACITY", battery: DemoBattery, input: Record<string, unknown>): string => {
    const start = Date.now();
    if (kind === "QUICK") {
      return new Date(start + totalDurationMs(quickPhases(battery.ratedOutputCurrentA))).toISOString();
    }
    const currentA = typeof input.dischargeCurrentA === "number" && input.dischargeCurrentA > 0 ? input.dischargeCurrentA : 1.0;
    const hours = (battery.capacityWh ?? 0) / (NOMINAL_OUTPUT_V * currentA);
    return new Date(start + hours * 3_600_000).toISOString();
  };

  const beginDiagnosis = (ownerId: string, kind: "QUICK" | "CAPACITY", batteryId: string, input: Record<string, unknown>): DemoDiagnosis => {
    const battery = findBattery(batteryId);
    const session = findActiveSession(ownerId);
    if (!battery || !session || session.batteryId !== batteryId) throw new Error("NO_ACTIVE_SESSION");
    if (battery.targetMode !== 2) throw new Error("MODE_NOT_SUPPORTED");
    // 안전 프로필 게이트는 2026-09-01에 제거됐다 — 모드 2면 실행을 허용한다.
    // 결과에는 dataSource가 실려 시뮬레이션 시기 데이터를 구분할 수 있다.
    if (kind === "CAPACITY" && battery.capacityWh === null) throw new Error("CAPACITY_NOT_REGISTERED");
    if (findActiveDiagnosis(batteryId)) throw new Error("DIAGNOSIS_IN_PROGRESS");
    const diagnosis: DemoDiagnosis = {
      id: `dg_${randomUUID()}`,
      batteryId,
      sessionId: session.id,
      kind,
      status: "RUNNING",
      phase: kind === "QUICK" ? "P0" : "CAPACITY",
      input,
      result: null,
      startedAt: isoNow(),
      estimatedEndAt: estimatedEnd(kind, battery, input),
      completedAt: null,
      progress: { loadTargetA: null, loadActualA: null, partialMetrics: null, windows: [], deliveredWh: 0, vLightLoadV: null, lastElapsedMs: null, tempTrail: [] },
    };
    demoDiagnoses.set(diagnosis.id, diagnosis);
    return { ...diagnosis };
  };

  const cancelDiagnosis = (ownerId: string, batteryId: string): DemoDiagnosis => {
    const diagnosis = findActiveDiagnosis(batteryId);
    const session = findActiveSession(ownerId);
    if (!diagnosis || !session || session.batteryId !== batteryId) throw new Error("NO_DIAGNOSIS_IN_PROGRESS");
    diagnosis.status = "ABORTED";
    diagnosis.result = { abortReason: "USER", partial: true, deliveredWh: diagnosis.progress?.deliveredWh ?? 0 };
    diagnosis.progress = null;
    return { ...diagnosis };
  };

  const advance = (id: string, phase: string, progress: DiagnosisProgress): DemoDiagnosis => {
    const diagnosis = demoDiagnoses.get(id);
    if (!diagnosis) throw new Error("NOT_FOUND");
    diagnosis.phase = phase;
    diagnosis.progress = progress;
    return { ...diagnosis };
  };

  const complete = (id: string, result: Record<string, unknown>): DemoDiagnosis => {
    const diagnosis = demoDiagnoses.get(id);
    if (!diagnosis) throw new Error("NOT_FOUND");
    diagnosis.status = "COMPLETED";
    diagnosis.result = result;
    diagnosis.completedAt = isoNow();
    diagnosis.progress = null;
    return { ...diagnosis };
  };

  const cancelBySystem = (batteryId: string, reason: string): DemoDiagnosis | null => {
    const diagnosis = findActiveDiagnosis(batteryId);
    if (!diagnosis) return null;
    const stored = demoDiagnoses.get(diagnosis.id)!;
    stored.status = "ABORTED";
    // 부분 결과를 SOH로 쓰지 않으려면 partial 표시가 남아야 한다(스펙 §4-3).
    stored.result = { abortReason: reason, partial: true, deliveredWh: stored.progress?.deliveredWh ?? 0 };
    stored.progress = null;
    return { ...stored };
  };

  const health1 = (battery: DemoBattery): Record<string, unknown> | null => {
    if (battery.targetMode !== 1 || !battery.mode1Health) return null;
    const sample = battery.mode1Health;
    return {
      source: "BACKEND_BQ27441_AGGREGATE",
      sohPct: Number(((sample.fullChargeCapacityMah / sample.designCapacityMah) * 100).toFixed(1)),
      rulCycles: sample.rulCycles,
      cycleCount: sample.cycleCount,
      internalResistanceMohm: sample.internalResistanceMohm,
      calculatedAt: sample.calculatedAt
    };
  };

  const buildCsv = (batteryId: string, sessionId: string | null, from?: string, to?: string): string => {
    const battery = findBattery(batteryId);
    if (!battery) throw new Error("NOT_FOUND");
    if (from && Number.isNaN(Date.parse(from))) throw new Error("VALIDATION_FAILED");
    if (to && Number.isNaN(Date.parse(to))) throw new Error("VALIDATION_FAILED");
    if (!battery.latest.measuredAt) return `${CSV_HEADER}\n`;
    const measuredAt = Date.parse(battery.latest.measuredAt);
    if (Number.isNaN(measuredAt)) return `${CSV_HEADER}\n`;
    if ((from && measuredAt < Date.parse(from)) || (to && measuredAt > Date.parse(to))) return `${CSV_HEADER}\n`;
    return `${CSV_HEADER}\n${csvRow(battery, sessionId)}\n`;
  };

  return {
    demoUsers,

    async userById(id) { return findUser(id); },
    async users() { return listUsers(); },
    async batteryById(id) { return findBattery(id); },
    async batteries(ownerId) { return listBatteries(ownerId); },
    async activeSession(ownerId) { return findActiveSession(ownerId); },
    async sessionById(id) { return findSessionById(id); },
    async sessionsForBattery(batteryId) { return listSessionsForBattery(batteryId); },
    // The memory provider intentionally has no inferred-result history. Its
    // static battery.latest score remains the existing demo fixture; exposing
    // it as a fabricated anomaly row would blur the demo/production boundary.
    async latestAnomaly(_batteryId): Promise<AnomalyScoreRecord | null> { return null; },
    async anomalyScoresForBattery(_batteryId, _from, _to): Promise<AnomalyScoreRecord[]> { return []; },
    async domainEventById(id) { return eventById(id); },
    async domainEvents(query) { return listDomainEvents(query); },
    async getAdminEventTrend(period) { return eventTrend(period); },
    async trendForBatteries(batteryIds, period, metrics) { return trendForBatteries(batteryIds, period, metrics); },
    async publishedNotices(query) { return listPublicNotices(query); },
    async adminNotices(query) { return listAdminNotices(query); },
    async noticeForUser(id, viewerId) { return publicNoticeForUser(id, viewerId); },
    async adminNoticeById(id) {
      const notice = noticesById.get(id);
      return notice ? structuredClone(notice) : undefined;
    },
    async noticeDeliveryIntents(noticeId) {
      return structuredClone(noticeDeliveryIntentsById.get(noticeId) ?? []);
    },
    async activeDiagnosis(batteryId) { return findActiveDiagnosis(batteryId); },
    async diagnosisById(id) { return findDiagnosisById(id); },
    async diagnosesForBattery(batteryId) { return listDiagnosesForBattery(batteryId); },
    async relayByBattery(id) { return readRelay(id); },
    async audits() { return listAudits(); },

    async createBattery(ownerId, input) { return addBattery(ownerId, input); },
    async updateBattery(ownerId, batteryId, input) { return editBattery(ownerId, batteryId, input); },
    async recordAudit(input) { return audit(input); },
    async startSession(ownerId, batteryId) { return beginSession(ownerId, batteryId); },
    async changeOpsStatus(actorId, batteryId, next, reason, expectedVersion) { return setOpsStatus(actorId, batteryId, next, reason, expectedVersion); },
    async saveMemo(actorId, batteryId, memo, expectedVersion) { return setMemo(actorId, batteryId, memo, expectedVersion); },
    async changeUserStatus(actorId, userId, status, reason) { return setUserStatus(actorId, userId, status, reason); },
    async changeRelay(actorId, batteryId, action, reason) { return setRelay(actorId, batteryId, action, reason); },
    async engageFailsafe(batteryId, triggerCode, condition) { return engage(batteryId, triggerCode, condition); },
    async recordDomainEvent(input) { return recordDomainEvent(input); },
    async acknowledgeDomainEvent(actorId, eventId) {
      const event = [...domainEventsByDedupe.values()].find((item) => item.id === eventId);
      if (!event) throw new Error("NOT_FOUND");
      if (!event.acknowledgedAt) {
        event.acknowledgedAt = isoNow();
        event.acknowledgedBy = actorId;
      }
      return structuredClone(event);
    },
    async createNotice(actorId, input) { return createNoticeInMemory(actorId, input); },
    async updateNotice(actorId, noticeId, input) { return updateNoticeInMemory(actorId, noticeId, input); },
    async archiveNotice(actorId, noticeId) { return archiveNoticeInMemory(actorId, noticeId); },
    async deleteNotice(actorId, noticeId) { deleteNoticeInMemory(actorId, noticeId); },
    async startDiagnosis(ownerId, kind, batteryId, input) { return beginDiagnosis(ownerId, kind, batteryId, input); },
    async abortDiagnosis(ownerId, batteryId) { return cancelDiagnosis(ownerId, batteryId); },
    async advanceDiagnosis(id, phase, progress) { return advance(id, phase, progress); },
    async completeDiagnosis(id, result) { return complete(id, result); },
    async abortDiagnosisBySystem(batteryId, reason) { return cancelBySystem(batteryId, reason); },

    async idempotent(actorId, key, body) { return checkIdempotent(actorId, key, body); },
    async rememberIdempotency(actorId, key, body, status, response) { storeIdempotency(actorId, key, body, status, response); },

    async mode1Health(battery) { return health1(battery); },
    async csvForBattery(batteryId, sessionId, from, to) { return buildCsv(batteryId, sessionId, from, to); }
  };
}
