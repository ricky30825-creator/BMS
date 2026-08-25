import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function expectBuildExcludesMocks(mode: "production" | "development") {
  execFileSync(process.execPath, [join(process.cwd(), "node_modules", "vite", "bin", "vite.js"), "build", "--mode", mode], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "development", VITE_USE_MOCKS: "true", VITE_DEMO_MODE: "false" },
    stdio: "pipe",
  });

  const distDirectory = join(process.cwd(), "dist");
  const buildFiles = listFiles(distDirectory);
  const buildContents = buildFiles
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  expect(buildFiles.some((path) => /mockServiceWorker|(?:^|[/\\])(?:mock|browser)[^/\\]*\.js$/i.test(path))).toBe(false);
  expect(buildContents).not.toContain("b_pack_004");
  expect(buildContents).not.toContain("Validated Mode 2");
  expect(buildContents).not.toContain("Mock Service Worker");
  expect(buildContents).not.toContain("setupWorker");
  expect(buildContents).not.toContain("lee@lab.io");
  expect(buildContents).not.toContain("hong@cellguard.io");
  expect(buildContents).not.toContain("demo-password");
  expect(buildContents).not.toContain("관리자 로그인");
  expect(buildFiles.some((path) => /(?:^|[/\\])AdminPages-[^/\\]+\.js$/.test(path))).toBe(true);
  expect(buildFiles.some((path) => /(?:^|[/\\])UserPages-[^/\\]+\.js$/.test(path))).toBe(true);
  expect(buildFiles.some((path) => /(?:^|[/\\])PublicPages-[^/\\]+\.js$/.test(path))).toBe(true);
}

test("development mocks reject unhandled API requests", async ({ page }) => {
  await page.goto("/?mock=1");

  const result = await page.evaluate(async () => {
    try {
      const response = await fetch("/api/__unhandled_contract_request__");
      return { rejected: false, status: response.status };
    } catch {
      return { rejected: true, status: null };
    }
  });

  expect(result).toEqual({ rejected: false, status: 500 });
});

for (const mode of ["production", "development"] as const) {
  test(`Vite ${mode}-mode build excludes the MSW worker chunk and fixtures`, () => {
    expectBuildExcludesMocks(mode);
  });
}

test("a production build with VITE_DEMO_MODE=true still bundles the demo-login transport (docs/local_run.md single-origin path)", () => {
  execFileSync(process.execPath, [join(process.cwd(), "node_modules", "vite", "bin", "vite.js"), "build", "--mode", "production"], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "production", VITE_USE_MOCKS: "false", VITE_DEMO_MODE: "true", VITE_API_BASE: "" },
    stdio: "pipe",
  });

  const distDirectory = join(process.cwd(), "dist");
  const buildContents = listFiles(distDirectory)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  // demoTransportEnabled() must not be gated behind the Vite dev-server flag
  // — a `vite build` with VITE_DEMO_MODE=true (frontend/.env.production) is
  // exactly this case, and login has no other transport available yet
  // (AUTH_MODE=betterauth / C2b is not implemented).
  expect(buildContents).toContain("hong@cellguard.io");
  expect(buildContents).toContain("demo-password");
});
