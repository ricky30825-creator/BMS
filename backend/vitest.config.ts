import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    env: {
      DATABASE_URL: "postgres://test:test@127.0.0.1:5432/test",
      BETTER_AUTH_URL: "http://localhost:3005",
      BETTER_AUTH_SECRET: "x".repeat(32)
    }
  }
});
