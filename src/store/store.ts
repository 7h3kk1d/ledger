import { decodeHeads, Repo, type AutomergeUrl, type DocHandle, type UrlHeads } from "@automerge/automerge-repo";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import { WebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
import { DATA_EPOCH, type LedgerDoc, type RootDoc } from "../model/types";
import { createNewLedger, habitSeed, rollover, switchTo } from "./root";
import { dateHabits, ensureTags, healTags } from "./mutations";
import { unsynced } from "./sync";
import { loadConfig, rememberLedger, resolveSyncUrl, setLocalSetting, type AppConfig } from "./config";
import { FileStorageAdapter, MigratingAdapter, nativeFiles } from "./fileStorage";

export * from "./mutations";

/** In the iOS app: files the app keeps (moved there from IndexedDB once). In a browser: IndexedDB. */
const files = nativeFiles();
export const storedInFiles = files !== undefined;

/** Docs live on this device; a sync server is added once the config names one (connect). */
export const repo = new Repo({
  storage: files
    ? new MigratingAdapter(new FileStorageAdapter(files), () => new IndexedDBStorageAdapter("ledger"))
    : new IndexedDBStorageAdapter("ledger"),
});

/** Undefined while no sync server is set: the ledger is on this device only. */
let network: WebSocketClientAdapter | undefined;

/** The config openLedger read: settings on this device over /config.json. */
let config: AppConfig = {};
export const currentConfig = (): AppConfig => config;

function connect(syncUrl: string | undefined) {
  if (!syncUrl || network) return;
  network = new WebSocketClientAdapter(resolveSyncUrl(syncUrl));
  repo.networkSubsystem.addNetworkAdapter(network);
}

/** Shown instead of the app when it can't open the ledger. */
export class LoadError extends Error {
  constructor(
    readonly kind: "no-ledger" | "unreachable" | "outdated",
    message: string,
  ) {
    super(message);
  }
}

/** The signals service's url (openLedger reads the config first). */
export function configuredSignalsUrl(): string | undefined {
  return config.signalsUrl?.replace(/\/$/, "") || undefined;
}

/**
 * Docs this device hasn't stored yet have to come from the server. The sync server is added after
 * the repo is made (it comes from the config), so a doc that isn't here is asked for again once
 * the connection is up; asked before, the repo answers "unavailable" straight away.
 */
async function find<T>(url: AutomergeUrl): Promise<DocHandle<T>> {
  const signal = AbortSignal.timeout(15_000);
  const net = network;
  return repo.find<T>(url, { signal }).catch(async (first) => {
    if (!net || signal.aborted) throw first;
    await Promise.race([net.whenReady(), new Promise((r) => setTimeout(r, 10_000))]);
    return repo.find<T>(url, { signal });
  }).catch((e) => {
    throw new LoadError(
      "unreachable",
      `Couldn’t get ${url} from this device or the sync server (${e?.message ?? e}).`,
    );
  });
}

export interface Ledger {
  root: DocHandle<RootDoc>;
  handle: DocHandle<LedgerDoc>;
}

/**
 * Open the root doc and the ledger doc it points at, rolling over on an epoch bump. Without a
 * root (a new device with nothing served) it throws "no-ledger": the app offers to start one or
 * join one.
 */
export async function openLedger(): Promise<Ledger> {
  config = await loadConfig();
  connect(config.syncUrl);
  const rootUrl = config.rootUrl as AutomergeUrl | undefined;
  if (!rootUrl) throw new LoadError("no-ledger", "This device hasn’t opened a ledger yet.");
  const root = await find<RootDoc>(rootUrl);
  rememberLedger(root.url, (root.doc() as RootDoc).name);
  const r = root.doc() as RootDoc;
  if (r.epoch > DATA_EPOCH) throw outdated();
  if (r.epoch < DATA_EPOCH) {
    // breaking schema change: start over with the habit names, keep the old doc
    const old = await find<LedgerDoc>(r.current as AutomergeUrl).catch(() => undefined);
    const seed = old ? habitSeed(old.doc() as LedgerDoc, true) : [];
    return { root, handle: rollover(repo, root, seed, "epoch") };
  }
  return { root, handle: await openCurrent(root) };
}

export const outdated = () =>
  new LoadError("outdated", "The data was upgraded by a newer version of Ledger.");

/** The ledger doc the root currently points at. */
export const openCurrent = async (root: DocHandle<RootDoc>) => {
  const h = await find<LedgerDoc>((root.doc() as RootDoc).current as AutomergeUrl);
  ensureTags(h);
  healTags(h);
  dateHabits(h);
  // maps made elsewhere can meet ours in any later sync
  if (!healing.has(h)) {
    healing.add(h);
    h.on("change", () => healTags(h));
  }
  return h;
};
const healing = new WeakSet<DocHandle<LedgerDoc>>();

/** New empty ledger doc (optionally with the same habits) for every device; the old one is kept. */
export function resetData(root: DocHandle<RootDoc>, current: DocHandle<LedgerDoc>, keepHabits: boolean) {
  rollover(repo, root, keepHabits ? habitSeed(current.doc() as LedgerDoc) : [], "reset");
}

export const switchToDoc = (root: DocHandle<RootDoc>, url: string) =>
  switchTo(root, url as AutomergeUrl, "switch");

/**
 * Start a separate ledger on this device and open it (a reload). With a sync server it is
 * stored there too, so other devices can join it by its id.
 */
export async function startNewLedger(name?: string): Promise<void> {
  const root = createNewLedger(repo, name);
  rememberLedger(root.url, name?.trim() || undefined);
  setLocalSetting("rootUrl", root.url);
  await repo.flush();
  location.reload();
}

/** Connected to the sync server or not; calls back now and on every change. */
export interface SyncStatus {
  /** False when no sync server is set: the ledger is on this device only. */
  configured: boolean;
  online: boolean;
  /** Changes on this device the server doesn't have; undefined if unknown. */
  unsynced?: number;
  /** When the server last had everything on this device (ms). */
  syncedAt?: number;
}

/**
 * Whether the server is connected, and whether it has every change made here.
 * The server's last known heads are kept per doc in localStorage, so a device
 * that opens offline can still say what's waiting.
 */
export function watchSync(handle: DocHandle<LedgerDoc>, cb: (s: SyncStatus) => void): () => void {
  const key = `ledger.synced.${handle.documentId}`;
  type Known = { heads: UrlHeads; at: number };
  let known: Known | undefined;
  try {
    known = JSON.parse(localStorage.getItem(key) ?? "null") ?? undefined;
  } catch {
    known = undefined;
  }
  const save = (k: Known) => {
    known = k;
    try {
      localStorage.setItem(key, JSON.stringify(k));
    } catch {
      // storage blocked: the status lasts until reload
    }
  };
  const net = network;
  if (!net) {
    cb({ configured: false, online: false });
    return () => {};
  }
  let online = net.isReady() && net.remotePeerId !== undefined;
  const count = () => {
    const doc = handle.doc();
    return known && doc ? unsynced(doc, decodeHeads(known.heads)) : undefined;
  };
  const emit = () => cb({ configured: true, online, unsynced: count(), syncedAt: known?.at });

  // already synced before we started watching (the doc was open first)
  const peer = net.remotePeerId;
  const storageId = peer && repo.peerMetadataByPeerId[peer]?.storageId;
  const info = storageId ? handle.getSyncInfo(storageId) : undefined;
  if (info) save({ heads: info.lastHeads, at: info.lastSyncTimestamp });

  const onRemote = ({ heads, timestamp }: { heads: UrlHeads; timestamp: number }) => {
    save({ heads, at: timestamp });
    emit();
  };
  const up = () => {
    online = true;
    emit();
  };
  const down = () => {
    online = false;
    // the last moment the server had everything: now, if nothing was waiting
    if (known && count() === 0) save({ ...known, at: Date.now() });
    emit();
  };
  handle.on("remote-heads", onRemote);
  handle.on("change", emit);
  net.on("peer-candidate", up);
  net.on("peer-disconnected", down);
  emit();
  return () => {
    handle.off("remote-heads", onRemote);
    handle.off("change", emit);
    net.off("peer-candidate", up);
    net.off("peer-disconnected", down);
  };
}

/**
 * Ask the browser not to evict our storage. Safari otherwise clears site data
 * after 7 days without a visit unless the app is installed to the home screen.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (storedInFiles) return true; // the app's own files, not the browser's storage
  if (!navigator.storage?.persist) return false;
  return (await navigator.storage.persisted()) || navigator.storage.persist();
}

/** Whole-doc binary backup (Automerge save format). */
export async function exportBackup(h: DocHandle<LedgerDoc>): Promise<Uint8Array> {
  const bytes = await repo.export(h.documentId);
  if (!bytes) throw new Error("nothing to export");
  return bytes;
}

/** Import a backup as a new doc and make it current everywhere. */
export function importBackup(root: DocHandle<RootDoc>, bytes: Uint8Array): void {
  const h = repo.import<LedgerDoc>(bytes);
  switchTo(root, h.url, "import");
}
