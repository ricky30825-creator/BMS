import { defineConfig, devices } from "@playwright/test";

const e2ePort = Number(process.env.CELLGUARD_E2E_PORT ?? 41_789);
if (!Number.isInteger(e2ePort) || e2ePort < 1_024 || e2ePort > 65_535) {
  throw new Error("CELLGUARD_E2E_PORT must be an integer between 1024 and 65535");
}
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: e2eBaseUrl, trace: "on-first-retry" },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${e2ePort} --strictPort`,
    url: e2eBaseUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "production-bundle.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "production-bundle",
      testMatch: "production-bundle.spec.ts",
      dependencies: ["chromium"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
