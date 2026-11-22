// The iOS app's own signal provider: wanted signals whose habit has a HealthKit
// recipe are answered from HealthKit on this phone (LedgerHealth.recent), with
// no network. Re-read when the wanted set changes, when the app comes back, and
// after each HealthKit sync (startHealth). Elsewhere it isn't made at all.
import type { SignalData } from "../../model/signals";
import type { SignalsState } from "../client";
import type { SignalProvider, WantedSignal } from "../provider";
import { deriveSignal, type HealthRecords } from "./healthkit";

export interface RecentPlugin {
  recent(o: { days: number }): Promise<HealthRecords>;
}

const DAYS = 14;
const EMPTY: SignalsState = { enabled: true, catalog: [], data: new Map(), loading: false };

export class DeviceHealth implements SignalProvider {
  private state = EMPTY;
  private wanted: WantedSignal[] = [];
  private listeners = new Set<(s: SignalsState) => void>();
  private inflight?: Promise<void>;
  private again = false;

  constructor(private readonly plugin: RecentPlugin) {}

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

  want(links: readonly WantedSignal[]): void {
    const mine = links.filter((l) => l.recipe?.kind.startsWith("healthkit."));
    if (JSON.stringify(mine) === JSON.stringify(this.wanted)) return;
    this.wanted = mine;
    void this.refresh();
  }

  /** One read at a time; a request during one runs once more after it. */
  refresh(): Promise<void> {
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

  private async run(): Promise<void> {
    const wanted = this.wanted;
    if (wanted.length === 0) {
      if (this.state.data.size) this.set({ data: new Map() });
      return;
    }
    try {
      const records = await this.plugin.recent({ days: DAYS });
      const data = new Map<string, SignalData>();
      for (const w of wanted) {
        const d = w.recipe && deriveSignal(w.recipe, records);
        if (d) data.set(w.id, d);
      }
      this.set({ data, error: undefined, lastOk: Date.now() });
    } catch (e) {
      // HealthKit not connected, or the read failed: the service's answer stands alone
      this.set({ error: e instanceof Error ? e.message : String(e) });
    }
  }
}
