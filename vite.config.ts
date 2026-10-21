import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: [
      // The default browser entry needs wasm ESM integration; the base64
      // build registers the wasm API without any extra bundler plugins.
      {
        find: /^@automerge\/automerge$/,
        replacement: fileURLToPath(
          import.meta.resolve("@automerge/automerge/automerge.wasm.base64"),
        ).replace(
          /wasm_bindgen_output\/web\/automerge_wasm_bg_base64\.js$/,
          "entrypoints/fullfat_base64.js",
        ),
      },
    ],
  },
  // automerge ships wasm; keep it out of dep pre-bundling
  optimizeDeps: { exclude: ["@automerge/automerge"] },
  // the app reaches the sync server at /sync on its own host, as behind the
  // cluster's ingress (pnpm dev:sync runs it locally)
  server: {
    proxy: { "/sync": { target: process.env.SYNC_TARGET ?? "ws://localhost:3030", ws: true } },
  },
  build: { target: "es2022" },
  test: { environment: "node" },
});
