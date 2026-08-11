import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";
import "./styles-v3.css";

async function start() {
  const mockParam = new URLSearchParams(window.location.search).get("mock");
  const mockRequested = mockParam === "1"
    || (__CELLGUARD_DEV_SERVER__ && import.meta.env.VITE_USE_MOCKS !== "false" && mockParam !== "0");

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
