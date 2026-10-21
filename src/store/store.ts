import { Repo, type DocHandle, type AutomergeUrl } from "@automerge/automerge-repo";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import {
  LOCAL_AUTHOR,
  type Attrs,
  type Event,
  type Habit,
  type LedgerDoc,
  type Occurred,
} from "../model/types";

import { habitEventsOn, localDate } from "../model/reduce";
// Optional, gitignored (src/seed.local.ts exports SEED_HABITS: string[]).
const localSeed = import.meta.glob<{ SEED_HABITS: string[] }>("../seed.local.ts", { eager: true });
const SEED_HABITS = Object.values(localSeed)[0]?.SEED_HABITS ?? [];

const URL_KEY ="ledger:docUrl";

const emptyDoc = (): LedgerDoc => ({ eventTypes: {}, habits: {}, events: {} });

export const newId = () => crypto.randomUUID();

export const repo = new Repo({ storage: new IndexedDBStorageAdapter("ledger") });

export async function openHandle(): Promise<DocHandle<LedgerDoc>> {
  const known = localStorage.getItem(URL_KEY) as AutomergeUrl | null;
  if (known) return repo.find<LedgerDoc>(known);
  return newSeededDoc();
}

/** Create a fresh doc with the seed habits and make it the active one. */
function newSeededDoc(): DocHandle<LedgerDoc> {
  const handle = repo.create<LedgerDoc>(emptyDoc());
  for (const name of SEED_HABITS) createDailyHabit(handle, name);
  localStorage.setItem(URL_KEY, handle.url);
  return handle;
}

/** Abandon the current doc (left in IndexedDB) and start over from the seed. */
export function resetToSeed(): void {
  newSeededDoc();
}

export interface NewEvent {
  typeId: string;
  occurred: Occurred;
  attrs?: Attrs;
}

/** Append a new event; returns its id. */
export function logEvent(h: DocHandle<LedgerDoc>, e: NewEvent): string {
  const id = newId();
  const event: Event = {
    id,
    typeId: e.typeId,
    author: LOCAL_AUTHOR,
    loggedAt: new Date().toISOString(),
    occurred: e.occurred,
    attrs: e.attrs ?? {},
  };
  h.change((d) => {
    d.events[id] = event;
  });
  return id;
}

/** Edit = append a replacement that amends the original. */
export function amendEvent(
  h: DocHandle<LedgerDoc>,
  targetId: string,
  e: NewEvent,
): string {
  const id = newId();
  const event: Event = {
    id,
    typeId: e.typeId,
    author: LOCAL_AUTHOR,
    loggedAt: new Date().toISOString(),
    occurred: e.occurred,
    attrs: e.attrs ?? {},
    amends: targetId,
  };
  h.change((d) => {
    d.events[id] = event;
  });
  return id;
}

/** Delete = append a tombstone retracting the target. */
export function tombstoneEvent(
  h: DocHandle<LedgerDoc>,
  target: Event,
): string {
  const id = newId();
  const event: Event = {
    id,
    typeId: target.typeId,
    author: LOCAL_AUTHOR,
    loggedAt: new Date().toISOString(),
    // copy: Automerge can't reference an object that already lives in the doc
    occurred: { ...target.occurred },
    attrs: {},
    amends: target.id,
    deleted: true,
  };
  h.change((d) => {
    d.events[id] = event;
  });
  return id;
}

/**
 * Check or uncheck a habit for a local date. Unchecking tombstones that day's
 * events; checking logs one (exact time for today, whole-day when backfilling).
 */
export function toggleHabit(
  h: DocHandle<LedgerDoc>,
  doc: LedgerDoc,
  habit: Habit,
  date: string,
): void {
  const existing = habitEventsOn(doc, habit, date);
  if (existing.length) {
    for (const e of existing) tombstoneEvent(h, e);
    return;
  }
  logEvent(h, {
    typeId: habit.eventTypeIds[0]!,
    occurred:
      date === localDate(new Date())
        ? { kind: "instant", at: new Date().toISOString() }
        : { kind: "day", date },
  });
}

export function createEventType(h: DocHandle<LedgerDoc>, name: string): string {
  const id = newId();
  h.change((d) => {
    d.eventTypes[id] = { id, name };
  });
  return id;
}

/** Daily habits pair 1:1 with an event type of the same name. */
export function createDailyHabit(h: DocHandle<LedgerDoc>, name: string): string {
  const typeId = createEventType(h, name);
  const id = newId();
  const habit: Habit = {
    id,
    name,
    eventTypeIds: [typeId],
    expectation: { kind: "daily" },
  };
  h.change((d) => {
    d.habits[id] = habit;
  });
  return id;
}

/** Whole-doc binary backup (Automerge save format). */
export async function exportBackup(h: DocHandle<LedgerDoc>): Promise<Uint8Array> {
  const bytes = await repo.export(h.documentId);
  if (!bytes) throw new Error("nothing to export");
  return bytes;
}

/** Import a backup as a new doc and switch to it (reload to pick up). */
export function importBackup(bytes: Uint8Array): void {
  const h = repo.import<LedgerDoc>(bytes);
  localStorage.setItem(URL_KEY, h.url);
}

/** Rename a habit and its paired event types so the Events views stay consistent. */
export function renameHabit(h: DocHandle<LedgerDoc>, habitId: string, name: string): void {
  h.change((d) => {
    const habit = d.habits[habitId];
    if (!habit) return;
    habit.name = name;
    for (const typeId of habit.eventTypeIds) {
      const t = d.eventTypes[typeId];
      if (t) t.name = name;
    }
  });
}

/** Archive hides a habit but keeps its events; restore brings it back. */
export function setHabitArchived(h: DocHandle<LedgerDoc>, habitId: string, archived: boolean): void {
  h.change((d) => {
    const habit = d.habits[habitId];
    if (!habit) return;
    if (archived) habit.archived = true;
    else delete habit.archived;
  });
}
