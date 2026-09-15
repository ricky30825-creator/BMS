import { describe, expect, it } from "vitest";

import { parseNoticeMutationBody } from "./noticePayload.js";

describe("공지 관리자 라우트 payload 계약", () => {
  it("POST는 ARCHIVED 상태를 허용하지 않는다", () => {
    expect(parseNoticeMutationBody({
      category: "INFO",
      audience: "ALL",
      title: "보관 상태로 생성",
      body: "게시 전에 보관할 수 없다",
      status: "ARCHIVED",
    }, false)).toEqual({ error: "ARCHIVED status is not allowed when creating a notice" });
  });

  it("PATCH 빈 본문은 저장소에 도달하기 전에 거부한다", () => {
    expect(parseNoticeMutationBody({}, true)).toEqual({ error: "at least one notice field is required" });
  });

  it("실제 필드가 있는 PATCH는 정규화 후 저장소 검증으로 넘긴다", () => {
    expect(parseNoticeMutationBody({ title: "수정 제목", notifyOnPublish: false }, true)).toEqual({
      value: { title: "수정 제목", notifyChannels: [] },
    });
  });
});
