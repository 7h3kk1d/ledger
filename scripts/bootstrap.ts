// Create the root doc and a first ledger doc on a sync server, and print the
// root url for config.json. Seeds habits from src/seed.local.ts if it exists.
//
//   pnpm bootstrap <ws url> [--write]
//
//   pnpm bootstrap ws://localhost:3030 --write          dev: also writes public/config.json
//   pnpm bootstrap wss://ledger.home.abanduk.com/sync   cluster
import { existsSync, writeFileSync } from "node:fs";
import { Repo } from "@automerge/automerge-repo";
import { WebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
import type { LedgerDoc, RootDoc } from "../src/model/types";
import { createLedger, createRoot } from "../src/store/root";

const [url, ...flags] = process.argv.slice(2);
if (!url?.match(/^wss?:\/\//)) {
  console.error("usage: pnpm bootstrap <ws url> [--write]");
  process.exit(1);
}

const seedFile = new URL("../src/seed.local.ts", import.meta.url);
const seed: string[] = existsSync(seedFile) ? (await import(seedFile.href)).SEED_HABITS : [];

const connect = async () => {
  const network = new WebSocketClientAdapter(url);
  const repo = new Repo({ network: [network] });
  await network.whenReady();
  return repo;
};

const repo = await connect();
const ledger = createLedger(repo, seed.map((name) => ({ name })));
const root = createRoot(repo, ledger);
console.log(`Created the ledger doc with ${seed.length} seed habits, and the root doc.`);

// Check the server really has both: fetch them through a second, empty repo.
const check = await connect();
const signal = AbortSignal.timeout(30_000);
const r = (await check.find<RootDoc>(root.url, { signal })).doc() as RootDoc;
const l = (await check.find<LedgerDoc>(r.current as typeof ledger.url, { signal })).doc() as LedgerDoc;
if (Object.keys(l.habits).length !== seed.length) throw new Error("the server's copy is incomplete");
console.log("The sync server has both docs.\n");

console.log(`rootUrl: ${root.url}`);
if (flags.includes("--write")) {
  writeFileSync(new URL("../public/config.json", import.meta.url), JSON.stringify({ rootUrl: root.url }, null, 2) + "\n");
  console.log("Wrote public/config.json.");
}
process.exit(0);
