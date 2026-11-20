// Writes ios/WidgetTests/fixture.json: a ledger (root + ledger doc, habits Stretch and Read, Read
// ticked on 2026-11-19) as automerge-repo stores it, every storage entry with its
// key, so the widget's Swift tests run against real repo output.
//   nix develop -c pnpm tsx scripts/widget-fixture.ts
import { writeFileSync } from "node:fs";
import { Repo, type Chunk, type StorageAdapterInterface, type StorageKey } from "@automerge/automerge-repo";
import { createLedger, createRoot } from "../src/store/root";
import { toggleHabit } from "../src/store/mutations";
import { activeHabits } from "../src/model/reduce";
import type { LedgerDoc } from "../src/model/types";

class Memory implements StorageAdapterInterface {
  entries = new Map<string, { key: StorageKey; data: Uint8Array }>();
  async load(key: StorageKey) { return this.entries.get(JSON.stringify(key))?.data; }
  async save(key: StorageKey, data: Uint8Array) { this.entries.set(JSON.stringify(key), { key, data }); }
  async remove(key: StorageKey) { this.entries.delete(JSON.stringify(key)); }
  async loadRange(prefix: StorageKey): Promise<Chunk[]> {
    return [...this.entries.values()].filter((e) => prefix.every((p, i) => e.key[i] === p));
  }
  async removeRange(prefix: StorageKey) { for (const c of await this.loadRange(prefix)) await this.remove(c.key); }
}

const storage = new Memory();
const repo = new Repo({ storage });
const ledger = createLedger(repo, [{ name: "Stretch" }, { name: "Read" }]);
const root = createRoot(repo, ledger);
const [stretch, read] = activeHabits(ledger.doc() as LedgerDoc);
toggleHabit(ledger, read!, "2026-11-19");
await repo.flush();

writeFileSync(
  new URL("../ios/WidgetTests/fixture.json", import.meta.url),
  JSON.stringify(
    {
      rootUrl: root.url,
      ledgerUrl: ledger.url,
      habits: { Stretch: stretch!.id, Read: read!.id },
      entries: [...storage.entries.values()].map((e) => ({ key: e.key, data: Buffer.from(e.data).toString("base64") })),
    },
    null,
    1,
  ) + "\n",
);
console.log(`wrote ${storage.entries.size} entries`);
process.exit(0);
