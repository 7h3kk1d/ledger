import { Repo, type AutomergeUrl, type DocHandle } from "@automerge/automerge-repo";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import { WebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
import { DATA_EPOCH, type LedgerDoc, type RootDoc } from "../model/types";
import { habitSeed, rollover, switchTo } from "./root";
import { ensureTags, healTags } from "./mutations";

export * from "./mutations";

const CONFIG_KEY = "ledger:config";

/** The sync server sits behind the same host as the app (Vite proxies it in dev). */
const syncUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/sync`;
const network = new WebSocketClientAdapter(syncUrl);

export const repo = new Repo({
  storage: new IndexedDBStorageAdapter("ledger"),
  network: [network],
});

/** Shown instead of the app when it can't open the ledger. */
export class LoadError extends Error {
  constructor(
    readonly kind: "no-config" | "unreachable" | "outdated",
    message: string,
  ) {
    super(message);
  }
}

interface Config {
  rootUrl?: AutomergeUrl;
  /** The signals service (e.g. "/signals"); without it, habits use manual check-ins only. */
  signalsUrl?: string;
}

/** /config.json (served from the cluster's ConfigMap), cached for offline starts. */
async function loadConfig(): Promise<Config> {
  try {
    const res = await fetch("/config.json", { cache: "no-store" });
    if (res.ok) {
      const config = (await res.json()) as Config;
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      return config;
    }
  } catch {
    // offline: fall back to the cached copy
  }
  return JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "{}") as Config;
}

/** The signals service's url from the last /config.json read (openLedger reads it first). */
export function configuredSignalsUrl(): string | undefined {
  try {
    const url = (JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "{}") as Config).signalsUrl;
    return typeof url === "string" && url ? url.replace(/\/$/, "") : undefined;
  } catch {
    return undefined;
  }
}

/** Docs this device hasn't stored yet have to come from the server. */
function find<T>(url: AutomergeUrl): Promise<DocHandle<T>> {
  return repo.find<T>(url, { signal: AbortSignal.timeout(15_000) }).catch((e) => {
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

/** Open the root doc and the ledger doc it points at, rolling over on an epoch bump. */
export async function openLedger(): Promise<Ledger> {
  const { rootUrl } = await loadConfig();
  if (!rootUrl) throw new LoadError("no-config", "No rootUrl in /config.json.");
  const root = await find<RootDoc>(rootUrl);
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

/** Connected to the sync server or not; calls back now and on every change. */
export function onSyncStatus(cb: (connected: boolean) => void): () => void {
  const up = () => cb(true);
  const down = () => cb(false);
  network.on("peer-candidate", up);
  network.on("peer-disconnected", down);
  cb(network.isReady() && network.remotePeerId !== undefined);
  return () => {
    network.off("peer-candidate", up);
    network.off("peer-disconnected", down);
  };
}

/**
 * Ask the browser not to evict our storage. Safari otherwise clears site data
 * after 7 days without a visit unless the app is installed to the home screen.
 */
export async function requestPersistentStorage(): Promise<boolean> {
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
