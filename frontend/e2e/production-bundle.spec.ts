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
    env: { ...process.env, NODE_ENV: "development", VITE_USE_MOCKS: "true" },
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
