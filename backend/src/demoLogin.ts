import type { DemoUser } from "./store.js";

// 데모 로그인은 비밀번호를 검증하지 않는다(2026-08-27 결정). 이메일만 보고
// 사용자를 고르되, 등록된 데모 이메일이면 그 사람으로 붙여 관리자 시연
// (lee@lab.io)이 그대로 되게 한다. 모르는 이메일은 첫 일반 사용자로 보낸다.
export function resolveDemoUser(email: string, users: DemoUser[]): DemoUser | null {
  const normalized = email.trim().toLowerCase();
  const exact = users.find((user) => user.email === normalized);
  if (exact) return exact;
  return users.find((user) => user.role === "USER") ?? users[0] ?? null;
}
