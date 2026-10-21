export type Occurred =
  | { kind: "instant"; at: string } // exact ISO timestamp
  | { kind: "day"; date: string }; // YYYY-MM-DD, local whole day

export type Attrs = Record<string, string | number | boolean>;

export interface Event {
  id: string;
  typeId: string;
  author: string;
  loggedAt: string; // exact ISO timestamp of when this entry was written
  occurred: Occurred;
  attrs: Attrs;
  /** Id of the event this one replaces (edit). */
  amends?: string;
  /** Tombstone: this entry retracts the event named by `amends`. */
  deleted?: true;
}

export interface EventType {
  id: string;
  name: string;
}

export interface Habit {
  id: string;
  name: string;
  eventTypeIds: string[];
  expectation: { kind: "daily" };
  /** Hidden from the tracker; history is kept. */
  archived?: true;
  /** Display position; lower first. */
  order?: number;
  /** Accent colour hue (0-360); derived from the id when unset. */
  hue?: number;
}

export interface LedgerDoc {
  eventTypes: Record<string, EventType>;
  habits: Record<string, Habit>;
  events: Record<string, Event>;
}

export const LOCAL_AUTHOR = "local";

/**
 * Bump on a breaking schema change. Clients that find an older epoch in the
 * root doc start a fresh ledger doc (habit names carried over) instead of
 * migrating; the old doc is kept in the root's history.
 */
export const DATA_EPOCH = 1;

/** Why the root moved to another ledger doc. */
export type RootReason = "reset" | "epoch" | "import" | "switch";

export interface RootEntry {
  url: string;
  epoch: number;
  /** ISO timestamp of when this doc stopped being current. */
  at: string;
  reason: RootReason;
}

/** Points every device at the ledger doc in use. */
export interface RootDoc {
  current: string; // automerge url of the live LedgerDoc
  epoch: number;
  /** Docs that used to be current, oldest first. Never deleted. */
  history: RootEntry[];
}
