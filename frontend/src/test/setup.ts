import "@testing-library/jest-dom";

// jsdom has no ResizeObserver; recharts' ResponsiveContainer requires one.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
