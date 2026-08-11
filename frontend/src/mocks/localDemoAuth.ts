export const localDemoCredentials = {
  user: { email: "hong@cellguard.io", password: "demo-password" },
  admin: { email: "lee@lab.io", password: "demo-password" },
} as const;

export function demoRoleForEmail(email: string): "ADMIN" | "USER" {
  return email.trim().toLowerCase() === localDemoCredentials.admin.email ? "ADMIN" : "USER";
}
