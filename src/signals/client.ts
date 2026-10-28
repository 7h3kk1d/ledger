// Talks to the signals service (collectors spec/signals.md) at `signalsUrl`
// from /config.json. What it fetched is kept in IndexedDB (never the Automerge
// doc), so habits keep their service data offline and on the next start.
//
// Refreshes: on start, when the set of linked signals changes, when the app
// comes back to the foreground, and every few minutes while it's visible. The
// service answers "done today?" from a live fetch for sources that have one.
import { mergeAnswer, type SignalAnswer, type SignalData, type SignalInfo } from "../model/signals";

const REFRESH_MS = 5 * 60_000;
const TIMEOUT_MS = 30_000;

export interface SignalsState {
  /** Configured at all (a `signalsUrl` in /config.json). */
  enabled: boolean;
  catalog: SignalInfo[];
  data: ReadonlyMap<string, SignalData>;
  /** When the service last answered (ms), from this device. */
  lastOk?: number;
  /** The last refresh failed: showing what was kept. */
  error?: string;
  loading: boolean;
}

interface Cached {
  catalog: SignalInfo[];
  data: [string, SignalData][];
  cursor?: string;
  /** The ids the cursor was given for. */
  ids: string[];
  lastOk?: number;
}

export class SignalsClient {
  private state: SignalsState;
  private cursor?: string;
  private cursorIds: string[] = [];
  private wanted: string[] = [];
  private listeners = new Set<(s: SignalsState) => void>();
  private inflight?: Promise<void>;
  private again = false;
  private timer?: ReturnType<typeof setInterval>;
  private started = false;

  constructor(
    private readonly base: string | undefined,
    private readonly cache: CacheStore = idbCache(),
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {
    this.state = { enabled: !!base, catalog: [], data: new Map(), loading: !!base };
  }

  get snapshot(): SignalsState {
    return this.state;
  }

  subscribe(cb: (s: SignalsState) => void): () => void {
    this.listeners.add(cb);
    cb(this.state);
    return () => void this.listeners.delete(cb);
  }

  private set(patch: Partial<SignalsState>) {
    this.state = { ...this.state, ...patch };
    for (const cb of this.listeners) cb(this.state);
  }

  /** Load the kept copy, fetch, and keep refreshing while visible. */
  async start(): Promise<void> {
    if (!this.base) return;
    const kept = await this.cache.get().catch(() => undefined);
    if (kept) {
      this.cursor = kept.cursor;
      this.cursorIds = kept.ids;
      this.set({ catalog: kept.catalog, data: new Map(kept.data), lastOk: kept.lastOk });
    }
    this.started = true;
    const onVisible = () => {
      if (document.visibilityState === "visible") void this.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    this.timer = setInterval(() => {
      if (document.visibilityState === "visible") void this.refresh();
    }, REFRESH_MS);
    await this.refresh();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** The signals habits link to; fetches when a new one appears. */
  want(ids: string[]): void {
    const next = [...new Set(ids)].sort();
    if (next.join("\n") === this.wanted.join("\n")) return;
    const added = next.some((id) => !this.wanted.includes(id));
    this.wanted = next;
    if (added && this.started) void this.refresh();
  }

  /** One refresh at a time; a request during one runs once more after it. */
  refresh(): Promise<void> {
    if (!this.base) return Promise.resolve();
    if (this.inflight) {
      this.again = true;
      return this.inflight;
    }
    this.inflight = this.run().finally(() => {
      this.inflight = undefined;
      if (this.again) {
        this.again = false;
        void this.refresh();
      }
    });
    return this.inflight;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchFn(`${this.base}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${path.split("?")[0]}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  private async run(): Promise<void> {
    this.set({ loading: true });
    try {
      const ids = this.wanted;
      const catalog = this.get<{ signals: SignalInfo[] }>("");
      catalog.catch(() => undefined); // awaited below; don't leave it unhandled if observations fail first
      let data = new Map(this.state.data);
      let cursor = this.cursor;
      if (ids.length) {
        // The cursor only says what the device has for the ids it was given for.
        const sameIds = ids.every((id) => this.cursorIds.includes(id));
        const q = new URLSearchParams(ids.map((id) => ["id", id]));
        if (cursor && sameIds) q.set("cursor", cursor);
        const answer = await this.get<{ cursor: string; signals: Record<string, SignalAnswer> }>(
          `/observations?${q}`,
        );
        data = new Map([...data].filter(([id]) => ids.includes(id)));
        for (const [id, a] of Object.entries(answer.signals)) data.set(id, mergeAnswer(data.get(id), a));
        cursor = answer.cursor;
        this.cursorIds = ids;
      }
      this.cursor = cursor;
      const lastOk = Date.now();
      this.set({ catalog: (await catalog).signals, data, lastOk, error: undefined, loading: false });
      await this.cache
        .put({ catalog: this.state.catalog, data: [...data], cursor, ids: this.cursorIds, lastOk })
        .catch(() => undefined);
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  }
}

export interface CacheStore {
  get(): Promise<Cached | undefined>;
  put(c: Cached): Promise<void>;
}

/** One record in its own IndexedDB database (Automerge's lives in "ledger"). */
function idbCache(): CacheStore {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("ledger-signals", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const tx = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const req = f(db.transaction("kv", mode).objectStore("kv"));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  };
  return {
    get: () => tx("readonly", (s) => s.get("state") as IDBRequest<Cached | undefined>),
    put: async (c) => void (await tx("readwrite", (s) => s.put(c, "state"))),
  };
}
