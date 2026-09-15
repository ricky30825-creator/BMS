export type ShutdownStep = {
  name: string;
  run: () => void | Promise<void>;
};

export type ShutdownFailure = {
  step: string;
  error: unknown;
};

export type ShutdownResult = {
  signal: string;
  failures: ShutdownFailure[];
};

export type ShutdownController = {
  readonly isShuttingDown: boolean;
  shutdown(signal: string): Promise<ShutdownResult>;
};

export class StartupCancelledError extends Error {
  constructor() {
    super("startup cancelled by shutdown");
    this.name = "StartupCancelledError";
  }
}

export function isStartupCancelled(error: unknown): error is StartupCancelledError {
  return error instanceof StartupCancelledError;
}

export type StartupStep = {
  name: string;
  start: () => void | Promise<void>;
  stop: () => void | Promise<void>;
};

export type StartupController = ShutdownController & {
  start(): Promise<void>;
  assertActive(): void;
};

/**
 * Run each shutdown step once, even when shutdown is requested concurrently.
 * A failed step is recorded and does not prevent later resources from closing.
 */
export function createShutdownController(steps: readonly ShutdownStep[]): ShutdownController {
  let shutdownPromise: Promise<ShutdownResult> | null = null;
  let isShuttingDown = false;

  return {
    get isShuttingDown(): boolean {
      return isShuttingDown;
    },

    shutdown(signal: string): Promise<ShutdownResult> {
      if (shutdownPromise) return shutdownPromise;
      isShuttingDown = true;
      shutdownPromise = (async () => {
        const failures: ShutdownFailure[] = [];
        for (const step of steps) {
          try {
            await step.run();
          } catch (error) {
            failures.push({ step: step.name, error });
          }
        }
        return { signal, failures };
      })();
      return shutdownPromise;
    },
  };
}

/**
 * Run startup phases in order while making shutdown wait for an in-flight
 * phase before closing its resource.  A phase is marked started before the
 * cancellation check after it resolves, so a resource acquired during a
 * signal race is still closed exactly once by the shutdown controller.
 */
export function createStartupController(
  steps: readonly StartupStep[],
  startupOrder: readonly string[] = steps.map((step) => step.name),
): StartupController {
  const indexes = new Map<string, number>();
  steps.forEach((step, index) => {
    if (indexes.has(step.name)) throw new Error(`duplicate startup step: ${step.name}`);
    indexes.set(step.name, index);
  });
  if (startupOrder.length !== steps.length || new Set(startupOrder).size !== steps.length) {
    throw new Error("startup order must include every step exactly once");
  }
  const orderedIndexes = startupOrder.map((name) => {
    const index = indexes.get(name);
    if (index === undefined) throw new Error(`unknown startup step: ${name}`);
    return index;
  });

  type StepState = "idle" | "starting" | "started" | "failed";
  const states = steps.map(() => ({
    state: "idle" as StepState,
    startPromise: null as Promise<void> | null,
    stopPromise: null as Promise<void> | null,
  }));
  let cancelled = false;
  let startupPromise: Promise<void> | null = null;

  const stopStep = (index: number): Promise<void> => {
    const entry = states[index]!;
    if (entry.stopPromise) return entry.stopPromise;
    entry.stopPromise = (async () => {
      if (entry.startPromise) {
        await entry.startPromise.catch(() => undefined);
      }
      // Cleanup steps are intentionally run even when startup failed or did
      // not reach this phase.  The server's close functions are idempotent,
      // and this preserves startup-failure cleanup for the store pool.
      await steps[index]!.stop();
    })();
    return entry.stopPromise;
  };

  const shutdownController = createShutdownController(
    steps.map((step, index) => ({ name: step.name, run: () => stopStep(index) })),
  );

  const controller: StartupController = {
    get isShuttingDown(): boolean {
      return cancelled;
    },

    assertActive(): void {
      if (cancelled) throw new StartupCancelledError();
    },

    start(): Promise<void> {
      if (startupPromise) return startupPromise;
      startupPromise = (async () => {
        for (const index of orderedIndexes) {
          controller.assertActive();
          const entry = states[index]!;
          if (entry.state !== "idle") throw new Error(`startup step is not idle: ${steps[index]!.name}`);
          entry.state = "starting";
          const phase = Promise.resolve().then(() => {
            controller.assertActive();
            return steps[index]!.start();
          });
          // Set the state in a reaction registered before either startup or
          // cleanup can await it.  This removes the final microtask race where
          // cleanup could observe "starting" after a fulfilled start.
          entry.startPromise = phase.then(
            () => { entry.state = "started"; },
            (error) => {
              entry.state = "failed";
              throw error;
            },
          );
          await entry.startPromise;
          controller.assertActive();
        }
      })();
      return startupPromise;
    },

    shutdown(signal: string): Promise<ShutdownResult> {
      cancelled = true;
      return shutdownController.shutdown(signal);
    },
  };

  return controller;
}
