import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { CellGuardStore } from "./contract.js";
import { createMemoryStore } from "./memory.js";
import { createPostgresStore } from "./postgres.js";
import { measurementPhaseFor } from "../measurementState.js";

// 저장소 구현체가 지켜야 하는 도메인 계약. 인메모리와 PostgreSQL이 같은
// 스위트를 통과해야 한다. B1 2단계 담당자는 아래 한 줄을 추가하면 된다:
//   runStoreContractTests("postgres", async () => createPostgresStore(pool));
export function runStoreContractTests(name: string, makeStore: () => Promise<CellGuardStore>): void {
  describe(`CellGuardStore 계약 — ${name}`, () => {
    let store: CellGuardStore;
    beforeEach(async () => { store = await makeStore(); });

    it("소유자 스코프: batteries(ownerId)는 그 사용자 것만 준다", async () => {
      const all = await store.batteries();
      const mine = await store.batteries("hong");
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((battery) => battery.ownerId === "hong")).toBe(true);
      expect(all.length).toBeGreaterThanOrEqual(mine.length);
    });

    it("BLOCKED 배터리는 세션을 시작할 수 없다", async () => {
      const blocked = (await store.batteries()).find((battery) => battery.opsStatus === "BLOCKED");
      expect(blocked).toBeDefined();
      await expect(store.startSession("hong", blocked!.id)).rejects.toThrow("BATTERY_BLOCKED");
    });

    it("없는 배터리로 세션을 시작하면 NOT_FOUND", async () => {
      await expect(store.startSession("hong", "no-such-battery")).rejects.toThrow("NOT_FOUND");
    });

    it("다른 소유자의 배터리로 세션을 시작하면 NOT_FOUND", async () => {
      const otherOwnerBattery = (await store.batteries()).find((battery) => battery.ownerId !== "hong" && battery.opsStatus !== "BLOCKED");
      expect(otherOwnerBattery).toBeDefined();
      await expect(store.startSession("hong", otherOwnerBattery!.id)).rejects.toThrow("NOT_FOUND");
    });

    it("새 배터리는 센서 프레임 전까지 측정값 없이 대기한다", async () => {
      const battery = await store.createBattery("hong", { label: "신규 측정 대기", targetMode: 1, chemistry: "LI_ION", seriesCount: 3 });
      expect(battery.latest).toEqual({
        voltageV: null,
        currentA: null,
        powerW: null,
        tempContact: null,
        tempIrSurface: null,
        socPct: null,
        score: null,
        measuredAt: null,
      });
      expect((await store.csvForBattery(battery.id, null)).trim().split("\n")).toHaveLength(1);
      const session = await store.startSession("hong", battery.id);
      expect(measurementPhaseFor(session.startedAt, battery.latest.measuredAt)).toBe("WAITING_FOR_MEASUREMENT");
    });

    it("설비 전체에 활성 세션은 하나뿐이고 이전 것은 SUPERSEDED로 끝난다", async () => {
      const usable = (await store.batteries()).filter((battery) => battery.opsStatus !== "BLOCKED");
      const first = await store.startSession(usable[0].ownerId, usable[0].id);
      await store.startSession(usable[0].ownerId, usable[0].id);
      const ended = await store.sessionById(first.id);
      expect(ended?.status).toBe("ENDED");
      expect(ended?.endReason).toBe("SUPERSEDED");
      const active = await store.activeSession();
      expect(active?.id).not.toBe(first.id);
    });

    it("version이 어긋나면 VERSION_CONFLICT", async () => {
      const battery = (await store.batteries())[0];
      await expect(
        store.changeOpsStatus("leelab", battery.id, "WATCH", "정상 사유입니다", battery.version + 5)
      ).rejects.toThrow("VERSION_CONFLICT");
    });

    it("같은 상태로 바꾸면 NO_STATUS_CHANGE", async () => {
      const battery = (await store.batteries()).find((item) => item.opsStatus === "NORMAL")!;
      await expect(store.changeOpsStatus("leelab", battery.id, "NORMAL", "정상 사유입니다")).rejects.toThrow("NO_STATUS_CHANGE");
    });

    it("상태를 바꾸면 version이 오르고 감사 로그가 남는다 — 원자성", async () => {
      const battery = (await store.batteries()).find((item) => item.opsStatus === "NORMAL")!;
      const before = (await store.audits()).length;
      const after = await store.changeOpsStatus("leelab", battery.id, "WATCH", "감사 로그 확인용 사유");
      expect(after.version).toBe(battery.version + 1);
      expect((await store.audits()).length).toBe(before + 1);
    });

    it("BLOCKED로 바꾸면 그 배터리의 활성 세션이 끊긴다", async () => {
      const usable = (await store.batteries()).find((battery) => battery.opsStatus === "NORMAL")!;
      const session = await store.startSession(usable.ownerId, usable.id);
      await store.changeOpsStatus("leelab", usable.id, "BLOCKED", "차단 사유입니다");
      const ended = await store.sessionById(session.id);
      expect(ended?.status).toBe("ENDED");
      expect(ended?.endReason).toBe("BLOCKED");
    });

    it("릴레이 차단은 상태와 감사 로그를 함께 남긴다 — 원자성", async () => {
      const battery = (await store.batteries())[0];
      const before = (await store.audits()).length;
      const relay = await store.changeRelay("hong", battery.id, "cut", "차단 사유입니다");
      expect(relay.state).toBe("OPEN");
      expect((await store.audits()).length).toBe(before + 1);
    });

    it("다른 소유자는 릴레이를 조작할 수 없다", async () => {
      const otherOwnerBattery = (await store.batteries()).find((battery) => battery.ownerId !== "hong");
      expect(otherOwnerBattery).toBeDefined();
      await expect(store.changeRelay("hong", otherOwnerBattery!.id, "cut", "소유권 확인")).rejects.toThrow("NOT_FOUND");
    });

    it("인터락이 걸려 있으면 복구할 수 없다", async () => {
      const blocked = (await store.batteries()).find((battery) => battery.opsStatus === "BLOCKED")!;
      const relay = await store.relayByBattery(blocked.id);
      expect(relay.interlockEngaged).toBe(true);
      await expect(store.changeRelay("hong", blocked.id, "restore", "복구 사유입니다")).rejects.toThrow("INTERLOCK_LOCKED");
    });

    it("없는 배터리의 릴레이를 조회하면 NOT_FOUND", async () => {
      await expect(store.relayByBattery("no-such-battery")).rejects.toThrow("NOT_FOUND");
    });

    it("engageFailsafe는 인터락을 걸고 릴레이를 연다", async () => {
      const battery = (await store.batteries()).find((item) => item.opsStatus === "NORMAL")!;
      const before = (await store.audits()).length;
      const relay = await store.engageFailsafe(battery.id, "FAILSAFE_TEMP_IR_OVER_CAP", "TEMP_OVER_CAP");
      expect(relay.state).toBe("OPEN");
      expect(relay.interlockEngaged).toBe(true);
      expect(relay.reasonCode).toBe("FAILSAFE_TEMP_IR_OVER_CAP");
      expect(relay.changedBy).toBe("SYSTEM");
      expect((await store.audits()).length).toBe(before + 1);
      expect((await store.audits())[0].action).toBe("RELAY_AUTO_CUT");
    });

    it("Fail-Safe로 걸린 인터락은 사용자가 복구할 수 없다", async () => {
      const battery = (await store.batteries()).find((item) => item.opsStatus === "NORMAL")!;
      await store.engageFailsafe(battery.id, "FAILSAFE_TEMP_IR_OVER_CAP", "TEMP_OVER_CAP");
      await expect(store.changeRelay(battery.ownerId, battery.id, "restore", "복구 사유입니다")).rejects.toThrow("INTERLOCK_LOCKED");
    });

    it("사유가 비면 REASON_REQUIRED", async () => {
      const battery = (await store.batteries()).find((item) => item.opsStatus === "NORMAL")!;
      await expect(store.changeOpsStatus("leelab", battery.id, "WATCH", "   ")).rejects.toThrow("REASON_REQUIRED");
      await expect(store.changeRelay(battery.ownerId, battery.id, "cut", "")).rejects.toThrow("REASON_REQUIRED");
    });

    it("자기 자신을 정지시킬 수 없다", async () => {
      await expect(store.changeUserStatus("leelab", "leelab", "SUSPENDED", "정지 사유입니다")).rejects.toThrow("SELF_SUSPEND_FORBIDDEN");
    });

    it("모드 2 배터리는 용량 없이 만들 수 없다", async () => {
      await expect(
        store.createBattery("hong", { label: "보조배터리", targetMode: 2, chemistry: "LI_ION" })
      ).rejects.toThrow("CAPACITY_REQUIRED");
    });

    it("이름이 비면 BATTERY_NAME_REQUIRED", async () => {
      await expect(
        store.createBattery("hong", { label: "   ", targetMode: 1, chemistry: "LI_ION" })
      ).rejects.toThrow("BATTERY_NAME_REQUIRED");
    });

    it("같은 키·같은 본문은 replay, 다른 본문은 conflict", async () => {
      const body = { batteryId: "X" };
      expect((await store.idempotent("hong", "k1", body)).kind).toBe("new");
      await store.rememberIdempotency("hong", "k1", body, 202, { id: "job-1" });
      const replay = await store.idempotent("hong", "k1", body);
      expect(replay.kind).toBe("replay");
      expect(replay.status).toBe(202);
      expect(replay.body).toEqual({ id: "job-1" });
      expect((await store.idempotent("hong", "k1", { batteryId: "Y" })).kind).toBe("conflict");
    });

    it("멱등성 키는 사용자별로 분리된다", async () => {
      const body = { batteryId: "X" };
      await store.rememberIdempotency("hong", "shared", body, 202, { id: "hong-job" });
      expect((await store.idempotent("kimeng", "shared", body)).kind).toBe("new");
    });

    it("반환값을 고쳐도 저장소가 오염되지 않는다", async () => {
      const battery = (await store.batteries())[0];
      battery.label = "손으로 바꾼 이름";
      const again = await store.batteryById(battery.id);
      expect(again?.label).not.toBe("손으로 바꾼 이름");
    });

    it("batteryById/userById 반환값을 고쳐도 저장소가 오염되지 않는다", async () => {
      const battery = await store.batteryById((await store.batteries())[0].id);
      battery!.label = "손으로 바꾼 이름";
      const againBattery = await store.batteryById(battery!.id);
      expect(againBattery?.label).not.toBe("손으로 바꾼 이름");

      const user = await store.userById((await store.users())[0].id);
      user!.name = "손으로 바꾼 이름";
      const againUser = await store.userById(user!.id);
      expect(againUser?.name).not.toBe("손으로 바꾼 이름");
    });
  });
}

runStoreContractTests("memory", async () => createMemoryStore());

const postgresTestUrl = process.env.TEST_DATABASE_URL?.trim();
const postgresTestPool = postgresTestUrl ? new pg.Pool({ connectionString: postgresTestUrl }) : null;

async function resetPostgresContractDatabase(pool: pg.Pool): Promise<void> {
  await pool.query(`
    truncate table audit_log, idempotency_key, diagnosis, telemetry_metric,
      anomaly_score, battery_health, battery_latest, relay_state, measurement_session,
      battery_asset restart identity cascade
  `);
  await pool.query(`
    insert into "user" (id, name, email, "createdAt", "updatedAt") values
      ('hong', '홍길동', 'hong@cellguard.io', timestamptz '2025-03-12 00:00:00+00', now()),
      ('kimeng', '김엔지', 'kim@lab.io', timestamptz '2024-11-02 00:00:00+00', now()),
      ('leelab', '이연구', 'lee@lab.io', timestamptz '2024-08-19 00:00:00+00', now())
    on conflict (id) do nothing
  `);
  await pool.query(`
    insert into app_user_profile (user_id, role, status, phone)
    values
      ('hong', 'USER', 'ACTIVE', '010-1234-5678'),
      ('kimeng', 'USER', 'ACTIVE', '010-2345-6789'),
      ('leelab', 'ADMIN', 'ACTIVE', '010-3456-7890')
    on conflict (user_id) do update set role = excluded.role, status = excluded.status, phone = excluded.phone
  `);
  await pool.query(`
    insert into device (id, owner_user_id, label, hardware_profile, status)
    values ('demo-device-01', 'hong', '진단기 A', 'MODE1_EXTERNAL_CELL_V1', 'ONLINE')
    on conflict (id) do update set owner_user_id = excluded.owner_user_id, status = excluded.status
  `);
  await pool.query(`
    insert into battery_asset
      (id, owner_user_id, label, chemistry, target_mode, series_count, maker, model,
       capacity_wh, rated_output_current_a, ops_status, memo, admin_memo, version)
    values
      ('pg-blocked', 'hong', 'PG blocked', 'LI_ION', 1, 3, 'CellGuard', 'External', null, null, 'BLOCKED', '', '', 0),
      ('pg-mode2', 'hong', 'PG mode 2', 'LI_PO', 2, null, 'CellGuard', 'Powerbank', 37, 2, 'NORMAL', '', '', 0),
      ('pg-mode1', 'hong', 'PG mode 1', 'LI_ION', 1, 3, 'CellGuard', 'External', null, null, 'NORMAL', '', '', 0),
      ('pg-kim', 'kimeng', 'PG Kim battery', 'LI_ION', 1, 3, 'CellGuard', 'External', null, null, 'NORMAL', '', '', 0)
  `);
  await pool.query(`
    insert into battery_latest
      (battery_id, measured_at, voltage_v, current_a, power_w, temp_contact,
       temp_ir_surface, soc_pct, soc_basis, score, evaluated_at)
    values
      ('pg-blocked', timestamptz '2026-08-06 01:32:10+00', 11.9, -2.4, -28.56, 58, 56.4, 78, 'ABSOLUTE_GAUGE', .82, timestamptz '2026-08-06 01:32:10+00'),
      ('pg-mode2', timestamptz '2026-08-06 01:29:00+00', 5.1, -1.2, -6.12, null, 34, 64, 'RELATIVE_SESSION_START', .33, timestamptz '2026-08-06 01:29:00+00'),
      ('pg-mode1', timestamptz '2026-08-06 01:30:00+00', 11.4, -1.6, -18.24, 29, 30.2, 91, 'ABSOLUTE_GAUGE', .18, timestamptz '2026-08-06 01:30:00+00')
  `);
  await pool.query(`
    insert into battery_health
      (battery_id, design_capacity_mah, full_charge_capacity_mah, cycle_count, rul_cycles, internal_resistance_mohm, calculated_at)
    values ('pg-blocked', 3000, 2760, 312, 480, 18.4, timestamptz '2026-08-06 00:00:00+00'),
           ('pg-mode1', 3000, 2820, 88, 560, 16.2, timestamptz '2026-08-06 00:00:00+00')
  `);
  await pool.query(`
    insert into relay_state
      (battery_id, state, interlock_engaged, interlock_condition, reason_code, changed_at, changed_by)
    values
      ('pg-blocked', 'OPEN', true, 'TEMP_OVER_CAP', 'FAILSAFE_TEMP_IR_OVER_CAP', timestamptz '2026-08-06 01:32:10+00', 'SYSTEM'),
      ('pg-mode2', 'CLOSED', false, null, null, timestamptz '2026-08-06 01:29:00+00', 'SYSTEM'),
      ('pg-mode1', 'CLOSED', false, null, null, timestamptz '2026-08-06 01:30:00+00', 'SYSTEM')
  `);
}

if (postgresTestPool) {
  runStoreContractTests("postgres", async () => {
    await resetPostgresContractDatabase(postgresTestPool);
    return createPostgresStore(postgresTestPool);
  });

  describe("PostgreSQL 저장소 경쟁 조건", () => {
    afterAll(async () => { await postgresTestPool.end(); });

    it("전역 active session 유니크 제약을 도메인 에러로 변환한다", async () => {
      await resetPostgresContractDatabase(postgresTestPool);
      const stores = [createPostgresStore(postgresTestPool), createPostgresStore(postgresTestPool)];
      const outcomes = await Promise.allSettled(stores.map((store) => store.startSession("hong", "pg-mode2")));
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      const rejected = outcomes.find((outcome) => outcome.status === "rejected");
      expect(rejected?.reason).toEqual(expect.objectContaining({ message: "NO_ACTIVE_SESSION" }));
      expect((await stores[0].activeSession())?.status).toBe("ACTIVE");
      expect((await stores[0].sessionsForBattery("pg-mode2")).filter((session) => session.status === "ACTIVE")).toHaveLength(1);
    });
  });
} else {
  console.info("[postgres contract] skipped: TEST_DATABASE_URL is not set; no PostgreSQL connection was attempted.");
  describe.skip("PostgreSQL 저장소 계약 (skipped)", () => {
    it("requires TEST_DATABASE_URL for the real database contract suite", () => undefined);
  });
}

describe("진단 진행 상태", () => {
  it("hong이 모드 2 자산을 갖고 있다 — 기본 데모 계정에서 F21 화면이 잠기면 안 된다", async () => {
    const store = createMemoryStore();
    const owned = await store.batteries("hong");
    expect(owned.some((battery) => battery.targetMode === 2)).toBe(true);
  });

  it("advanceDiagnosis가 단계와 진행 상태를 갱신한다", async () => {
    const store = createMemoryStore();
    const battery = (await store.batteries("hong")).find((b) => b.targetMode === 2 && b.opsStatus !== "BLOCKED")!;
    await store.startSession("hong", battery.id);
    const started = await store.startDiagnosis("hong", "QUICK", battery.id, { acknowledged: true });

    const advanced = await store.advanceDiagnosis(started.id, "P3", {
      loadTargetA: 1.5, loadActualA: 1.47, partialMetrics: { vLightLoadV: 5.02 },
      windows: [], deliveredWh: 0, vLightLoadV: 5.02, lastElapsedMs: null, tempTrail: [],
    });

    expect(advanced.phase).toBe("P3");
    expect(advanced.progress?.loadTargetA).toBe(1.5);
  });

  it("completeDiagnosis가 COMPLETED로 닫고 결과를 남긴다", async () => {
    const store = createMemoryStore();
    const battery = (await store.batteries("hong")).find((b) => b.targetMode === 2 && b.opsStatus !== "BLOCKED")!;
    await store.startSession("hong", battery.id);
    const started = await store.startDiagnosis("hong", "QUICK", battery.id, { acknowledged: true });

    const done = await store.completeDiagnosis(started.id, { quick: { grade: "HEALTHY" } });

    expect(done.status).toBe("COMPLETED");
    expect(done.progress).toBeNull();
    expect(await store.activeDiagnosis(battery.id)).toBeNull();
  });

  it("abortDiagnosisBySystem은 활성 세션 없이도 진단을 닫는다 — 세션 종료 시 필요하다", async () => {
    const store = createMemoryStore();
    const battery = (await store.batteries("hong")).find((b) => b.targetMode === 2 && b.opsStatus !== "BLOCKED")!;
    await store.startSession("hong", battery.id);
    const started = await store.startDiagnosis("hong", "QUICK", battery.id, { acknowledged: true });

    const aborted = await store.abortDiagnosisBySystem(battery.id, "SESSION_ENDED");

    expect(aborted?.id).toBe(started.id);
    expect(aborted?.status).toBe("ABORTED");
    expect(aborted?.result?.abortReason).toBe("SESSION_ENDED");
  });

  it("진행 중 진단이 없으면 abortDiagnosisBySystem은 null을 낸다 — 던지지 않는다", async () => {
    const store = createMemoryStore();
    const battery = (await store.batteries("hong")).find((b) => b.targetMode === 2 && b.opsStatus !== "BLOCKED")!;
    expect(await store.abortDiagnosisBySystem(battery.id, "SESSION_ENDED")).toBeNull();
  });

  it("모드 2면 안전 프로필과 무관하게 진단을 시작할 수 있다 (2026-09-01 결정)", async () => {
    const store = createMemoryStore();
    const battery = (await store.batteries("hong")).find((b) => b.targetMode === 2 && b.opsStatus !== "BLOCKED")!;
    await store.startSession("hong", battery.id);
    await expect(store.startDiagnosis("hong", "QUICK", battery.id, { acknowledged: true })).resolves.toBeDefined();
  });

  it("모드 1 자산은 여전히 MODE_NOT_SUPPORTED다", async () => {
    const store = createMemoryStore();
    const battery = (await store.batteries("hong")).find((b) => b.targetMode === 1 && b.opsStatus !== "BLOCKED")!;
    await store.startSession("hong", battery.id);
    await expect(store.startDiagnosis("hong", "QUICK", battery.id, { acknowledged: true })).rejects.toThrow("MODE_NOT_SUPPORTED");
  });

  it("빠른 진단의 예상 종료는 시작 + 180초다", async () => {
    const store = createMemoryStore();
    const battery = (await store.batteries("hong")).find((b) => b.targetMode === 2 && b.opsStatus !== "BLOCKED")!;
    await store.startSession("hong", battery.id);
    const started = await store.startDiagnosis("hong", "QUICK", battery.id, { acknowledged: true });
    const span = new Date(started.estimatedEndAt!).getTime() - new Date(started.startedAt).getTime();
    expect(span).toBe(180_000);
  });

  it("정밀 용량의 예상 종료는 ratedWh / (5V × 방전전류) 시간이다", async () => {
    const store = createMemoryStore();
    const battery = (await store.batteries("hong")).find((b) => b.targetMode === 2 && b.capacityWh === 37)!;
    await store.startSession("hong", battery.id);
    const started = await store.startDiagnosis("hong", "CAPACITY", battery.id, { dischargeCurrentA: 1, acknowledged: true });
    const hours = (new Date(started.estimatedEndAt!).getTime() - new Date(started.startedAt).getTime()) / 3_600_000;
    expect(hours).toBeCloseTo(37 / 5, 1);
  });

  it("완료 시각은 예상 시각이 아니라 실제 완료 시각이다", async () => {
    const store = createMemoryStore();
    const battery = (await store.batteries("hong")).find((b) => b.targetMode === 2 && b.opsStatus !== "BLOCKED")!;
    await store.startSession("hong", battery.id);
    const started = await store.startDiagnosis("hong", "QUICK", battery.id, { acknowledged: true });
    const done = await store.completeDiagnosis(started.id, {});
    expect(done.completedAt).not.toBeNull();
    expect(done.completedAt).not.toBe(done.estimatedEndAt);
  });
});
