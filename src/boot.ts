// Entry point. Automerge's wasm (~3.6 MB) is a separate hashed asset, fetched
// and compiled while streaming and cached for good, instead of base64 inside
// the app bundle. It has to be ready before any Automerge call, so the app is
// imported only after it loads.
import { initializeWasm } from "@automerge/automerge/slim";
import wasmUrl from "@automerge/automerge/automerge.wasm?url";

await initializeWasm(wasmUrl);
await import("./main");
