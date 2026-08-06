import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";

async function start() {
  const mockRequested = import.meta.env.VITE_USE_MOCKS === "true"
    || new URLSearchParams(window.location.search).get("mock") === "1";

  // Vite injects this as true only for `serve` in development mode. Every
  // `build` command removes this branch, regardless of mode or NODE_ENV.
  if (__CELLGUARD_DEV_SERVER__ && mockRequested) {
    const { worker } = await import("./mocks/browser");
    await worker.start({
      onUnhandledRequest(request) {
        if (new URL(request.url).pathname.startsWith("/api/")) {
          throw new Error(`Unhandled mock API request: ${request.method} ${request.url}`);
        }
      },
    });
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>);
}

void start();
