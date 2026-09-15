import { afterEach, describe, expect, it, vi } from "vitest";

import { createShutdownController } from "./runtimeLifecycle.js";

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
});
