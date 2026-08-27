import { describe, expect, it } from "vitest";
import { resolveDemoUser } from "./demoLogin.js";
import type { DemoUser } from "./store.js";

const users: DemoUser[] = [
  { id: "hong", email: "hong@cellguard.io", name: "홍길동", role: "USER", status: "ACTIVE", phone: "010-1234-5678", joinedAt: "2025-03-12T00:00:00.000Z" },
  { id: "leelab", email: "lee@lab.io", name: "이연구", role: "ADMIN", status: "ACTIVE", phone: "010-3456-7890", joinedAt: "2024-08-19T00:00:00.000Z" },
  { id: "parktest", email: "park@test.io", name: "박테스트", role: "USER", status: "SUSPENDED", phone: "010-4567-8901", joinedAt: "2025-06-10T00:00:00.000Z" },
];

describe("resolveDemoUser", () => {
  it("등록된 데모 이메일이면 그 사용자를 고른다", () => {
    expect(resolveDemoUser("lee@lab.io", users)?.id).toBe("leelab");
  });

  it("대소문자와 공백을 무시한다", () => {
    expect(resolveDemoUser("  LEE@Lab.io  ", users)?.id).toBe("leelab");
  });

  it("모르는 이메일이면 첫 번째 일반 사용자로 붙인다", () => {
    expect(resolveDemoUser("whatever@example.com", users)?.id).toBe("hong");
  });

  it("빈 이메일이어도 첫 번째 일반 사용자로 붙인다", () => {
    expect(resolveDemoUser("", users)?.id).toBe("hong");
  });

  it("정지된 계정은 이메일이 정확히 맞으면 그대로 고른다 — 정지 판정은 호출부가 한다", () => {
    expect(resolveDemoUser("park@test.io", users)?.id).toBe("parktest");
  });

  it("고를 사용자가 없으면 null", () => {
    expect(resolveDemoUser("x@y.z", [])).toBeNull();
  });
});
