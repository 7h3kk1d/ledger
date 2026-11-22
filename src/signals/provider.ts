// Where signal data comes from: providers. The remote one is the signals
// service (client.ts); a device one answers from data the device holds itself
// (the iOS app's HealthKit, by a habit's recipe), offline and at once. Both give
// the same observation ids for the same records (collectors spec/signals.md,
// Device recipes), so the hub merges them: the service's copy wins, and what
// only the device has is shown as provisional until the service has it too.
import type { Observation, SignalData } from "../model/signals";
import type { DeviceRecipe } from "../model/types";
import type { SignalsState } from "./client";

/** A signal to answer, with the habit's recipe for it when it has one. */
export interface WantedSignal {
  id: string;
  recipe?: DeviceRecipe;
}

export interface SignalProvider {
  readonly snapshot: SignalsState;
  subscribe(cb: (s: SignalsState) => void): () => void;
  want(links: readonly WantedSignal[]): void;
  refresh(): Promise<void>;
}

const DAY_MS = 86_400_000;

/** When an observation was over (ms); a whole day ends at the end of that day. */
function endsAt(o: Observation): number {
  switch (o.occurred.kind) {
    case "instant":
      return Date.parse(o.occurred.at);
    case "interval":
      return Date.parse(o.occurred.end);
    case "day":
      return Date.parse(`${o.occurred.date}T00:00:00Z`) + DAY_MS;
  }
}

const later = (a?: string, b?: string) => (a && b ? (a > b ? a : b) : (a ?? b));
const earlier = (a?: string, b?: string) => (a && b ? (a < b ? a : b) : (a ?? b));

/**
 * One signal from both: every remote observation, and the device's that the
 * remote doesn't have, marked provisional. Once the remote is fresh more than
 * a day past one of those and still hasn't got it, the service is the
 * authority (the record was deleted, or doesn't count there) and it's dropped.
 */
export function mergeSignal(remote: SignalData | undefined, device: SignalData | undefined): SignalData | undefined {
  if (!device) return remote;
  const have = new Set(remote?.observations.map((o) => o.id));
  const fresh = remote?.freshAt ? Date.parse(remote.freshAt) : undefined;
  const mine = device.observations
    .filter((o) => !have.has(o.id))
    .filter((o) => fresh === undefined || fresh <= endsAt(o) + DAY_MS)
    .map((o): Observation => ({ ...o, provisional: true }));
  if (!remote) return { ...device, observations: mine };
  return {
    observations: [...remote.observations, ...mine],
    current: { ...device.current, ...remote.current },
    freshAt: later(remote.freshAt, device.freshAt),
    coveredFrom: earlier(remote.coveredFrom, device.coveredFrom),
  };
}

/** The remote state with the device's answers folded in. */
export function mergeStates(remote: SignalsState, device: SignalsState | undefined): SignalsState {
  if (!device || device.data.size === 0) return remote;
  const data = new Map(remote.data);
  for (const [id, d] of device.data) {
    const merged = mergeSignal(remote.data.get(id), d);
    if (merged) data.set(id, merged);
  }
  const known = new Set(remote.catalog.map((s) => s.id));
  return {
    ...remote,
    enabled: remote.enabled || device.enabled,
    catalog: [...remote.catalog, ...device.catalog.filter((s) => !known.has(s.id))],
    data,
  };
}

/** The remote provider and, on a device that has one, a device provider, seen as one. */
export class SignalHub implements SignalProvider {
  private state: SignalsState;
  private listeners = new Set<(s: SignalsState) => void>();

  constructor(
    private readonly remote: SignalProvider,
    private readonly device?: SignalProvider,
  ) {
    this.state = mergeStates(remote.snapshot, device?.snapshot);
    remote.subscribe(() => this.update());
    device?.subscribe(() => this.update());
  }

  private update() {
    this.state = mergeStates(this.remote.snapshot, this.device?.snapshot);
    for (const cb of this.listeners) cb(this.state);
  }

  get snapshot(): SignalsState {
    return this.state;
  }

  subscribe(cb: (s: SignalsState) => void): () => void {
    this.listeners.add(cb);
    cb(this.state);
    return () => void this.listeners.delete(cb);
  }

  want(links: readonly WantedSignal[]): void {
    this.remote.want(links);
    this.device?.want(links);
  }

  async refresh(): Promise<void> {
    await Promise.all([this.remote.refresh(), this.device?.refresh()]);
  }
}
