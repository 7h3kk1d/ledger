// In the iOS app Ledger's docs are stored as files by the app (ios/App/FileStore.swift), through
// its LedgerFiles plugin, not in WebKit's IndexedDB, which iOS keeps only on a best-effort basis
// there. The web app keeps using IndexedDB. Ledger takes no dependency on Capacitor: the plugin is
// found on the global the app's native bridge puts there.
import type { Chunk, StorageAdapterInterface, StorageKey } from "@automerge/automerge-repo";

/** The LedgerFiles plugin as JS sees it; data is base64. */
export interface FilesPlugin {
  load(o: { key: string[] }): Promise<{ data?: string }>;
  save(o: { key: string[]; data: string }): Promise<void>;
  remove(o: { key: string[] }): Promise<void>;
  loadRange(o: { prefix: string[] }): Promise<{ chunks: { key: string[]; data: string }[] }>;
  removeRange(o: { prefix: string[] }): Promise<void>;
}

/** The plugin when running inside the iOS app; undefined in a browser. */
export function nativeFiles(): FilesPlugin | undefined {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } }).Capacitor;
  return cap?.isNativePlatform?.() ? (cap.Plugins?.LedgerFiles as FilesPlugin | undefined) : undefined;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export class FileStorageAdapter implements StorageAdapterInterface {
  constructor(private readonly files: FilesPlugin) {}

  async load(key: StorageKey): Promise<Uint8Array | undefined> {
    const { data } = await this.files.load({ key });
    return data === undefined ? undefined : fromBase64(data);
  }

  save(key: StorageKey, data: Uint8Array): Promise<void> {
    return this.files.save({ key, data: toBase64(data) });
  }

  remove(key: StorageKey): Promise<void> {
    return this.files.remove({ key });
  }

  async loadRange(prefix: StorageKey): Promise<Chunk[]> {
    const { chunks } = await this.files.loadRange({ prefix });
    return chunks.map((c) => ({ key: c.key, data: fromBase64(c.data) }));
  }

  removeRange(prefix: StorageKey): Promise<void> {
    return this.files.removeRange({ prefix });
  }
}

/** Written into the file storage once everything from IndexedDB is in it. */
export const MIGRATED_KEY = ["ledger-migrated-from-indexeddb"];

/**
 * File storage that first copies over whatever an earlier build of the app kept in IndexedDB,
 * once. The marker lives in the files themselves, not localStorage, which iOS can clear as
 * easily as IndexedDB. Every call waits for the copy, so the repo never reads half of it.
 */
export class MigratingAdapter implements StorageAdapterInterface {
  private readonly ready: Promise<void>;

  constructor(
    private readonly to: StorageAdapterInterface,
    from: () => StorageAdapterInterface,
  ) {
    this.ready = (async () => {
      if (await to.load(MIGRATED_KEY)) return;
      for (const { key, data } of await from().loadRange([])) {
        if (data && !(await to.load(key))) await to.save(key, data);
      }
      await to.save(MIGRATED_KEY, new Uint8Array([1]));
    })();
  }

  async load(key: StorageKey) {
    await this.ready;
    return this.to.load(key);
  }
  async save(key: StorageKey, data: Uint8Array) {
    await this.ready;
    return this.to.save(key, data);
  }
  async remove(key: StorageKey) {
    await this.ready;
    return this.to.remove(key);
  }
  async loadRange(prefix: StorageKey) {
    await this.ready;
    // the marker isn't automerge-repo's
    return (await this.to.loadRange(prefix)).filter((c) => c.key.join("\0") !== MIGRATED_KEY.join("\0"));
  }
  async removeRange(prefix: StorageKey) {
    await this.ready;
    return this.to.removeRange(prefix);
  }
}
