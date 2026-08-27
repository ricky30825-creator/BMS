import { beforeEach, describe, expect, it } from "vitest";
import type { CellGuardStore } from "./contract.js";
import { createMemoryStore } from "./memory.js";

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

    it("설비 전체에 활성 세션은 하나뿐이고 이전 것은 SUPERSEDED로 끝난다", async () => {
      const usable = (await store.batteries()).filter((battery) => battery.opsStatus !== "BLOCKED");
      const first = await store.startSession("hong", usable[0].id);
      await store.startSession("hong", usable[0].id);
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

    it("인터락이 걸려 있으면 복구할 수 없다", async () => {
      const blocked = (await store.batteries()).find((battery) => battery.opsStatus === "BLOCKED")!;
      const relay = await store.relayByBattery(blocked.id);
      expect(relay.interlockEngaged).toBe(true);
      await expect(store.changeRelay("hong", blocked.id, "restore", "복구 사유입니다")).rejects.toThrow("INTERLOCK_LOCKED");
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
      await expect(store.changeRelay("hong", battery.id, "restore", "복구 사유입니다")).rejects.toThrow("INTERLOCK_LOCKED");
    });

    it("사유가 비면 REASON_REQUIRED", async () => {
      const battery = (await store.batteries()).find((item) => item.opsStatus === "NORMAL")!;
      await expect(store.changeOpsStatus("leelab", battery.id, "WATCH", "   ")).rejects.toThrow("REASON_REQUIRED");
      await expect(store.changeRelay("hong", battery.id, "cut", "")).rejects.toThrow("REASON_REQUIRED");
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
  });
}

runStoreContractTests("memory", async () => createMemoryStore());
