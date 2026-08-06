import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => ({
  plugins: [react()],
  define: {
    __CELLGUARD_DEV_SERVER__: JSON.stringify(command === "serve" && mode === "development"),
  },
  // The MSW service worker is a development fixture. Vite serves it during
  // local development but never copies it into any build output.
  publicDir: command === "serve" && mode === "development" ? "public" : false,
  server: { port: 5173, host: "0.0.0.0" },
  preview: { port: 4173, host: "0.0.0.0" },
}));
