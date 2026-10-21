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
}

export interface LedgerDoc {
  eventTypes: Record<string, EventType>;
  habits: Record<string, Habit>;
  events: Record<string, Event>;
}

export const LOCAL_AUTHOR = "local";
