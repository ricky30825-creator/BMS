import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryStore } from "./store/memory.js";
import type { CellGuardStore } from "./store/contract.js";

describe("공지사항 영속 계약", () => {
  let store: CellGuardStore;

  beforeEach(() => {
    store = createMemoryStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function createPublished(input: Partial<Parameters<CellGuardStore["createNotice"]>[1]> = {}) {
    return store.createNotice("leelab", {
      category: "INFO",
      audience: "ALL",
      title: "운영 안내",
      body: "배터리 측정 안내 본문입니다.",
      status: "PUBLISHED",
      ...input,
    });
  }

  it("사용자 목록은 게시된 ALL/USER만 반환하고 summary는 정규화된 120 Unicode 문자다", async () => {
    const body = `${"Ａ".repeat(119)}😀Z`;
    const published = await createPublished({ audience: "USER", title: "  입력 그대로  ", body });
    await createPublished({ audience: "ADMIN", title: "관리자 전용" });
    await store.createNotice("leelab", { category: "INFO", audience: "ALL", title: "임시", body: "draft" });

    const publicItems = await store.publishedNotices();
    expect(publicItems.map((item) => item.id)).toContain(published.id);
    expect(publicItems).toHaveLength(1 + 3); // the three isolated memory fixtures plus this notice
    const item = publicItems.find((candidate) => candidate.id === published.id);
    expect(item?.summary).toBe(`${"A".repeat(119)}😀`);

    const detail = await store.noticeForUser(published.id, "hong");
    expect(detail?.title).toBe("  입력 그대로  ");
    expect(detail?.body).toBe(body);
    expect(detail).not.toHaveProperty("viewCount");
  });

  it("상세 조회수는 인증 사용자 기준 24시간 dedupe이고 목록·관리자 상세는 증가시키지 않는다", async () => {
    const notice = await createPublished();
    expect((await store.adminNoticeById(notice.id))?.viewCount).toBe(0);
    expect((await store.publishedNotices()).find((item) => item.id === notice.id)).toBeDefined();
    expect((await store.adminNoticeById(notice.id))?.viewCount).toBe(0);

    await Promise.all(Array.from({ length: 20 }, () => store.noticeForUser(notice.id, "hong")));
    expect((await store.adminNoticeById(notice.id))?.viewCount).toBe(1);

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 1);
    await store.noticeForUser(notice.id, "hong");
    expect((await store.adminNoticeById(notice.id))?.viewCount).toBe(1);
    await store.noticeForUser(notice.id, "kimeng");
    expect((await store.adminNoticeById(notice.id))?.viewCount).toBe(2);

    vi.advanceTimersByTime(1);
    await store.noticeForUser(notice.id, "hong");
    expect((await store.adminNoticeById(notice.id))?.viewCount).toBe(3);
  });

  it("상태 전이·감사·발송 의도를 함께 보존하고 외부 발송 성공으로 가장하지 않는다", async () => {
    const draft = await store.createNotice("leelab", {
      category: "MAINTENANCE",
      audience: "ALL",
      title: "점검",
      body: "점검 본문",
      notifyChannels: ["WEBPUSH", "KAKAO"],
    });
    expect(draft.status).toBe("DRAFT");
    expect(draft.deliveryIntents).toEqual([]);

    const saved = await store.updateNotice("leelab", draft.id, { body: "수정한 점검 본문", status: "DRAFT" });
    expect(saved.status).toBe("DRAFT");
    expect(saved.deliveryIntents).toEqual([]);

    const published = await store.updateNotice("leelab", draft.id, {
      status: "PUBLISHED",
      notifyChannels: ["WEBPUSH", "KAKAO", "WEBPUSH"],
    });
    expect(published.status).toBe("PUBLISHED");
    expect(published.publishedAt).toBe("2026-09-15T00:00:00.000Z");
    expect(published.deliveryIntents).toHaveLength(2);
    expect(published.deliveryIntents.every((intent) => intent.status === "BLOCKED")).toBe(true);
    expect(published.deliveryIntents.every((intent) => intent.lastError === "PROVIDER_NOT_CONFIGURED")).toBe(true);

    const publishedAt = published.publishedAt;
    const edited = await store.updateNotice("leelab", draft.id, { title: "게시 후 수정", status: "PUBLISHED" });
    expect(edited.publishedAt).toBe(publishedAt);
    const archived = await store.archiveNotice("leelab", draft.id);
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.archivedAt).not.toBeNull();
    await expect(store.updateNotice("leelab", draft.id, { title: "다시 수정" })).rejects.toThrow("VALIDATION_FAILED");
    await expect(store.archiveNotice("leelab", draft.id)).rejects.toThrow("VALIDATION_FAILED");
    await expect(store.deleteNotice("leelab", draft.id)).rejects.toThrow("NOTICE_NOT_DELETABLE");

    const actions = (await store.audits()).filter((audit) => audit.resource === draft.id).map((audit) => audit.action);
    expect(actions).toEqual(["NOTICE_ARCHIVE", "NOTICE_UPDATE", "NOTICE_PUBLISH", "NOTICE_UPDATE", "NOTICE_CREATE"]);
  });

  it("DRAFT만 삭제할 수 있고 ADMIN 대상·보관 공지는 사용자에게 보이지 않는다", async () => {
    const draft = await store.createNotice("leelab", { category: "INFO", audience: "ALL", title: "삭제", body: "임시" });
    await store.deleteNotice("leelab", draft.id);
    expect(await store.adminNoticeById(draft.id)).toBeUndefined();

    const admin = await createPublished({ audience: "ADMIN" });
    expect(await store.noticeForUser(admin.id, "hong")).toBeUndefined();
    const publicNotice = await createPublished();
    await store.archiveNotice("leelab", publicNotice.id);
    expect(await store.noticeForUser(publicNotice.id, "hong")).toBeUndefined();
  });
});
