// Where Ledger's data lives: the sync server, the root doc, the signals service and (iOS) the
// HealthKit receiver. Each comes from this device's settings first, then the served config: the
// app host's /config.json, and over it the config of the device's Ledger server, if it has one
// (the iOS app, whose pages are bundled; the owner's builds have theirs built in). Both are cached
// for offline starts. One address sets everything up; any key can still be overridden here.
// None is required: without a sync server the ledger is on this device only.
// Same semantics as climblog's src/kit/config.ts, for when the two share a kit.

export interface AppConfig {
  /**
   * The Ledger server whose /config.json supplies the rest (an https:// origin). In a host's own
   * config.json it's the default; "" in settings turns it off.
   */
  server?: string;
  /** A ws(s):// url or a path on the app's host ("/sync"). */
  syncUrl?: string;
  /** The root doc of the ledger to open. */
  rootUrl?: string;
  /** The signals service (an http(s) url or "/signals"); without it, habits use check-ins only. */
  signalsUrl?: string;
  /** Where the iOS app sends HealthKit batches (an https:// url); each device keeps its own token. */
  healthUrl?: string;
}

export type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const SETTINGS = "ledger:settings";
const SERVED = "ledger:config";
/** The Ledger server's config as last read: { server, config }. */
const SERVER_COPY = "ledger:server-config";
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
  served && "rootUrl" in served && !("syncUrl" in served) ? { ...served, syncUrl: "/sync" } : (served ?? {});

/**
 * The served config: the host's /config.json, with the Ledger server's over it (its paths made
 * full urls on that server). Undefined if nothing is served.
 *
 * `offlineCopy`: whether a host that can't be reached may be standing in for one that serves a
 * config. Not in the iOS app, whose own config (if any) is part of the app: there a failed fetch
 * means there is none. A Ledger server that can't be reached always stands in with its last copy.
 */
export async function servedConfig(
  store = defaultStore(),
  get: typeof fetch = (u, o) => fetch(u, o),
  offlineCopy = true,
): Promise<AppConfig | undefined> {
  const host = await hostConfig(store, get, offlineCopy);
  const local = localSettings(store).server;
  const server = local === "" ? undefined : (local ?? host?.server);
  const remote = server ? await serverConfig(server, store, get) : undefined;
  if (!host && !remote) return undefined;
  // `server` stays the host's: what a setting of the device's own overrides
  return { ...host, ...remote, server: host?.server };
}

/** A Ledger server's config, its paths resolved on it; the last copy while it can't be reached. */
async function serverConfig(server: string, store: Store, get: typeof fetch): Promise<AppConfig | undefined> {
  const base = server.trim().replace(/\/+$/, "");
  try {
    const res = await get(`${base}/config.json`, { cache: "no-store" });
    if (res.ok && res.headers.get("content-type")?.includes("json")) {
      const config = resolveOn(base, withLegacySync((await res.json()) as AppConfig));
      write(store, SERVER_COPY, { server: base, config });
      return config;
    }
    store.removeItem(SERVER_COPY);
    return undefined;
  } catch {
    const copy = read<{ server?: string; config?: AppConfig } | null>(store, SERVER_COPY, null);
    return copy?.server === base ? copy.config : undefined;
  }
}

/** A server's config as full urls: its paths ("/sync", "/signals") are on that server. */
export function resolveOn(server: string, c: AppConfig): AppConfig {
  const at = (path: string, ws = false) => {
    const u = new URL(path, `${server}/`);
    if (ws) u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return u.toString();
  };
  const out: AppConfig = { ...c };
  delete out.server; // a server's config doesn't send the device on to another
  if (c.syncUrl?.startsWith("/")) out.syncUrl = at(c.syncUrl, true);
  if (c.signalsUrl?.startsWith("/")) out.signalsUrl = at(c.signalsUrl);
  if (c.healthUrl?.startsWith("/")) out.healthUrl = at(c.healthUrl);
  return out;
}

/** The app host's /config.json, or the copy from the last time it could be read. */
async function hostConfig(store: Store, get: typeof fetch, offlineCopy: boolean): Promise<AppConfig | undefined> {
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
    server: merged.server || undefined,
    syncUrl: merged.syncUrl || undefined,
    rootUrl: merged.rootUrl || undefined,
    signalsUrl: merged.signalsUrl || undefined,
    healthUrl: merged.healthUrl || undefined,
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

/**
 * Why `url` can't be used as `key`, or undefined if it can. "" is fine (turns it off). Catches
 * what a phone's autocorrect does to "wss://" ("was://") before it becomes a path on the app's host.
 */
export function checkUrl(key: "server" | "syncUrl" | "signalsUrl", url: string): string | undefined {
  const u = url.trim();
  if (key === "server")
    return !u || /^https?:\/\/[^\s/]+\/?$/.test(u) ? undefined : "Use the server’s address, like https://ledger.example.";
  if (!u || /^\/[^\s]*$/.test(u)) return undefined;
  if (key === "syncUrl")
    return /^wss?:\/\/[^\s/]+/.test(u) ? undefined : "Use wss://host/path (ws:// for a local server), or a path on this app’s host like /sync.";
  return /^https?:\/\/[^\s/]+/.test(u) ? undefined : "Use https://host/path, or a path on this app’s host like /signals.";
}
