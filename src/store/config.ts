// Where Ledger's data lives: the sync server, the root doc and the signals service. Each comes
// from this device's settings first, then /config.json (served by whoever hosts the app, cached
// for offline starts). None is required: without a sync server the ledger is on this device only.
// Same semantics as climblog's src/kit/config.ts, for when the two share a kit.

export interface AppConfig {
  /** A ws(s):// url or a path on the app's host ("/sync"). */
  syncUrl?: string;
  /** The root doc of the ledger to open. */
  rootUrl?: string;
  /** The signals service (an http(s) url or "/signals"); without it, habits use check-ins only. */
  signalsUrl?: string;
}

export type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const SETTINGS = "ledger:settings";
const SERVED = "ledger:config";
/** Ledgers this device has opened (KnownLedger[]), newest first. */
const KNOWN = "ledger:ledgers";

const read = <T,>(store: Store, key: string, fallback: T): T => {
  try {
    const v: unknown = JSON.parse(store.getItem(key) ?? "null");
    return v === null || typeof v !== "object" ? fallback : (v as T);
  } catch {
    return fallback;
  }
};

const write = (store: Store, key: string, v: unknown) => {
  try {
    store.setItem(key, JSON.stringify(v));
  } catch {
    // storage blocked: lasts until reload
  }
};

const defaultStore = (): Store => globalThis.localStorage;

/**
 * Settings on this device. A key set to "" overrides the served config with nothing (sync turned
 * off here); a missing key defers to it.
 */
export const localSettings = (store = defaultStore()): AppConfig => read<AppConfig>(store, SETTINGS, {});

export function setLocalSetting(key: keyof AppConfig, value: string | undefined, store = defaultStore()): void {
  const s = localSettings(store);
  if (value === undefined) delete s[key];
  else s[key] = value;
  write(store, SETTINGS, s);
}

/**
 * The served config as it applies: before the sync server was a setting, Ledger always synced at
 * /sync on its own host, so a served config that doesn't mention syncUrl still means that.
 */
export const withLegacySync = (served: AppConfig | undefined): AppConfig =>
  served && !("syncUrl" in served) ? { ...served, syncUrl: "/sync" } : (served ?? {});

/** /config.json, or the copy from the last time it could be read; undefined if never served. */
/**
 * `offlineCopy`: whether a host that can't be reached may be standing in for one that serves a
 * config. Not in the iOS app, whose config (if any) is part of the app: there a failed fetch
 * means there is none.
 */
export async function servedConfig(
  store = defaultStore(),
  get: typeof fetch = (u, o) => fetch(u, o),
  offlineCopy = true,
): Promise<AppConfig | undefined> {
  try {
    const res = await get("/config.json", { cache: "no-store" });
    if (res.ok && res.headers.get("content-type")?.includes("json")) {
      const config = (await res.json()) as AppConfig;
      write(store, SERVED, config);
      return config;
    }
    // the host answered but serves no config (the iOS app, a bare dev server): forget any old copy
    store.removeItem(SERVED);
    return undefined;
  } catch {
    // offline: fall back to the cached copy
    if (!offlineCopy) {
      store.removeItem(SERVED);
      return undefined;
    }
  }
  const cached = read<AppConfig | null>(store, SERVED, null);
  return cached ?? undefined;
}

/** Settings over the served config; "" means unset. */
export function mergeConfig(served: AppConfig | undefined, local: AppConfig): AppConfig {
  const merged = { ...withLegacySync(served), ...local };
  return {
    syncUrl: merged.syncUrl || undefined,
    rootUrl: merged.rootUrl || undefined,
    signalsUrl: merged.signalsUrl || undefined,
  };
}

export async function loadConfig(opts: { offlineCopy?: boolean } = {}, store = defaultStore()): Promise<AppConfig> {
  return mergeConfig(await servedConfig(store, undefined, opts.offlineCopy ?? true), localSettings(store));
}

/**
 * Point this device at `url` for `key`. Setting it back to what the host serves drops the local
 * override, so the device follows the host again.
 */
export function chooseSetting(key: keyof AppConfig, url: string, served: AppConfig | undefined, store = defaultStore()) {
  setLocalSetting(key, url === (withLegacySync(served)[key] ?? "") ? undefined : url, store);
}

/**
 * A sync url as typed in settings or config.json: a full ws(s):// url, or a path ("/sync") on the
 * app's own host, as behind the cluster's ingress.
 */
export function resolveSyncUrl(url: string, loc: Pick<Location, "protocol" | "host"> = location): string {
  if (/^wss?:\/\//.test(url)) return url;
  const scheme = loc.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${loc.host}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** A ledger this device has opened. The name is the root's, as of the last time it was open. */
export interface KnownLedger {
  url: string;
  name?: string;
  openedAt: string;
}

export const knownLedgers = (store = defaultStore()): KnownLedger[] => {
  const v = read<unknown>(store, KNOWN, []);
  return Array.isArray(v) ? (v as KnownLedger[]) : [];
};

/** Record that `url` was opened (now), keeping the list newest first. */
export function rememberLedger(url: string, name: string | undefined, store = defaultStore(), now = new Date()): void {
  const rest = knownLedgers(store).filter((l) => l.url !== url);
  write(store, KNOWN, [{ url, ...(name ? { name } : {}), openedAt: now.toISOString() }, ...rest]);
}

/** Drop `url` from the list; the ledger itself stays on the server and on this device. */
export function forgetLedger(url: string, store = defaultStore()): void {
  write(store, KNOWN, knownLedgers(store).filter((l) => l.url !== url));
}

export const isDocUrl = (s: string) => /^automerge:[1-9A-HJ-NP-Za-km-z]{20,}$/.test(s.trim());
