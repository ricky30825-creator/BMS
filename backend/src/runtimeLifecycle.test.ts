import { afterEach, describe, expect, it, vi } from "vitest";

import { createShutdownController, createStartupController, isStartupCancelled } from "./runtimeLifecycle.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((fulfill) => { resolve = fulfill; });
  return { promise, resolve };
}

describe("runtime shutdown lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops the ticker and closes every resource once for concurrent requests", async () => {
    vi.useFakeTimers();
    const ticker = setInterval(() => undefined, 60_000);
    const stopTicker = vi.fn(() => clearInterval(ticker));
    const stopWorker = vi.fn(async () => undefined);
    const stopConsumers = vi.fn(async () => undefined);
    const closeHttp = vi.fn(async () => undefined);
    const closeStore = vi.fn(async () => undefined);
    const controller = createShutdownController([
      { name: "runtime ticker", run: stopTicker },
      { name: "outbox worker", run: stopWorker },
      { name: "telemetry consumers", run: stopConsumers },
      { name: "HTTP server", run: closeHttp },
      { name: "store", run: closeStore },
    ]);

    const first = controller.shutdown("SIGTERM");
    const second = controller.shutdown("SIGINT");
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(controller.isShuttingDown).toBe(true);
    expect(firstResult).toBe(secondResult);
    expect(firstResult.signal).toBe("SIGTERM");
    expect(firstResult.failures).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(stopTicker).toHaveBeenCalledTimes(1);
    expect(stopWorker).toHaveBeenCalledTimes(1);
    expect(stopConsumers).toHaveBeenCalledTimes(1);
    expect(closeHttp).toHaveBeenCalledTimes(1);
    expect(closeStore).toHaveBeenCalledTimes(1);

    await controller.shutdown("SIGTERM");
    expect(stopTicker).toHaveBeenCalledTimes(1);
    expect(closeStore).toHaveBeenCalledTimes(1);
  });

  it("records a cleanup error while still closing later resources", async () => {
    const closeHttp = vi.fn(async () => undefined);
    const closeStore = vi.fn(async () => undefined);
    const controller = createShutdownController([
      { name: "consumer", run: async () => { throw new Error("disconnect failed"); } },
      { name: "HTTP server", run: closeHttp },
      { name: "store", run: closeStore },
    ]);

    const result = await controller.shutdown("SIGINT");

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.step).toBe("consumer");
    expect(result.failures[0]?.error).toEqual(new Error("disconnect failed"));
    expect(closeHttp).toHaveBeenCalledTimes(1);
    expect(closeStore).toHaveBeenCalledTimes(1);
  });

  it.each(["store", "worker", "telemetry", "listen"] as const)(
    "cancels boot during awaited %s startup before later phases and closes acquired resources once",
    async (blockedStep) => {
      const names = ["store", "worker", "telemetry", "listen"] as const;
      const blockers = new Map(names.map((name) => [name, deferred()]));
      const startedSignals = new Map(names.map((name) => [name, deferred()]));
      const started: string[] = [];
      const stopped: string[] = [];
      const controller = createStartupController(names.map((name) => ({
        name,
        start: async () => {
          started.push(name);
          startedSignals.get(name)!.resolve();
          if (name === blockedStep) await blockers.get(name)!.promise;
        },
        stop: async () => {
          stopped.push(name);
        },
      })));

      const boot = controller.start();
      await startedSignals.get(blockedStep)!.promise;
      const cleanup = controller.shutdown("SIGTERM");
      blockers.get(blockedStep)!.resolve();

      const [bootResult, cleanupResult] = await Promise.all([
        boot.then(() => ({ status: "fulfilled" as const }), (error) => ({ status: "rejected" as const, error })),
        cleanup,
      ]);

      expect(bootResult.status).toBe("rejected");
      if (bootResult.status === "rejected") expect(isStartupCancelled(bootResult.error)).toBe(true);
      expect(cleanupResult.failures).toEqual([]);
      expect(started).toEqual(names.slice(0, names.indexOf(blockedStep) + 1));
      for (const name of names) {
        expect(stopped.filter((step) => step === name)).toHaveLength(1);
      }
    },
  );
});
