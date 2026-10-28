import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig(({ mode }) => ({
  plugins: [preact()],
  resolve: {
    alias:
      mode === "test"
        ? []
        : [
            // In the app every import of Automerge gets the slim build, which
            // leaves loading the wasm to src/boot.ts. (Tests run under node,
            // whose default entry loads it itself.)
            {
              find: /^@automerge\/automerge$/,
              replacement: fileURLToPath(import.meta.resolve("@automerge/automerge/slim")),
            },
          ],
  },
  // automerge ships wasm; keep it out of dep pre-bundling
  optimizeDeps: { exclude: ["@automerge/automerge"] },
  // the app reaches the sync server at /sync and the signals service at
  // /signals on its own host, as behind the cluster's ingress (pnpm dev:sync
  // runs the sync server locally; SIGNALS_TARGET can point at the cluster's)
  server: {
    proxy: {
      "/sync": { target: process.env.SYNC_TARGET ?? "ws://localhost:3030", ws: true },
      "/signals": { target: process.env.SIGNALS_TARGET ?? "http://localhost:8765", changeOrigin: true },
    },
  },
  build: { target: "es2022" },
  test: { environment: "node" },
}));
