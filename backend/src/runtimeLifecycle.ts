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
