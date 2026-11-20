import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { Repo, type DocHandle } from "@automerge/automerge-repo";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import { FileStorageAdapter, fromBase64, MIGRATED_KEY, MigratingAdapter, toBase64, type FilesPlugin } from "./fileStorage";

/** The LedgerFiles plugin's contract, in memory (ios/App/FileStore.swift on the device). */
function memoryPlugin() {
  const files = new Map<string, string>();
  const k = (key: string[]) => JSON.stringify(key);
  const starts = (key: string[], prefix: string[]) => prefix.every((p, i) => key[i] === p);
  const plugin: FilesPlugin = {
    load: async ({ key }) => (files.has(k(key)) ? { data: files.get(k(key))! } : {}),
    save: async ({ key, data }) => void files.set(k(key), data),
    remove: async ({ key }) => void files.delete(k(key)),
    loadRange: async ({ prefix }) => ({
      chunks: [...files].map(([key, data]) => ({ key: JSON.parse(key) as string[], data })).filter((c) => starts(c.key, prefix)),
    }),
    removeRange: async ({ prefix }) => {
      for (const key of [...files.keys()]) if (starts(JSON.parse(key), prefix)) files.delete(key);
    },
  };
  return { plugin, files };
}

type Doc = { n: number };
const value = async (h: DocHandle<Doc>) => (await h.whenReady(), (h.doc() as Doc).n);

describe("file storage", () => {
  it("base64 round-trips bytes, large ones too", () => {
    const big = new Uint8Array(200_000).map((_, i) => (i * 7) % 256);
    expect(fromBase64(toBase64(big))).toEqual(big);
    expect(fromBase64(toBase64(new Uint8Array()))).toEqual(new Uint8Array());
  });

  it("a doc saved by one repo opens in the next", async () => {
    const { plugin } = memoryPlugin();
    const first = new Repo({ storage: new FileStorageAdapter(plugin) });
    const h = first.create<Doc>({ n: 1 });
    h.change((d) => { d.n = 2; });
    await first.flush();

    const second = new Repo({ storage: new FileStorageAdapter(plugin) });
    expect(await value(await second.find<Doc>(h.url))).toBe(2);
  });
});

describe("moving off IndexedDB", () => {
  it("copies what an earlier build kept in IndexedDB, once", async () => {
    const idb = new IndexedDBStorageAdapter("ledger-test-migrate");
    const old = new Repo({ storage: idb });
    const h = old.create<Doc>({ n: 41 });
    await old.flush();

    const { plugin, files } = memoryPlugin();
    const repo = new Repo({ storage: new MigratingAdapter(new FileStorageAdapter(plugin), () => idb) });
    expect(await value(await repo.find<Doc>(h.url))).toBe(41);
    expect(files.has(JSON.stringify(MIGRATED_KEY))).toBe(true);

    // later changes go to the files only; a second start doesn't copy the stale IndexedDB again
    const fh = await repo.find<Doc>(h.url);
    fh.change((d) => { d.n = 42; });
    await repo.flush();
    const again = new Repo({ storage: new MigratingAdapter(new FileStorageAdapter(plugin), () => idb) });
    expect(await value(await again.find<Doc>(h.url))).toBe(42);
  });

  it("starts empty when there was nothing to move", async () => {
    const { plugin } = memoryPlugin();
    const adapter = new MigratingAdapter(new FileStorageAdapter(plugin), () => new IndexedDBStorageAdapter("ledger-test-empty"));
    expect(await adapter.loadRange([])).toEqual([]); // the marker isn't listed
    expect(await adapter.load(MIGRATED_KEY)).toEqual(new Uint8Array([1]));
  });
});
