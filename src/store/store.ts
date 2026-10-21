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

import { activeHabits, habitEventsOn, habitHue, HUES, localDate } from "../model/reduce";
// Optional, gitignored (src/seed.local.ts exports SEED_HABITS: string[]).
const localSeed = import.meta.glob<{ SEED_HABITS: string[] }>("../seed.local.ts", { eager: true });
const SEED_HABITS = Object.values(localSeed)[0]?.SEED_HABITS ?? [];

const URL_KEY ="ledger:docUrl";

const emptyDoc = (): LedgerDoc => ({ eventTypes: {}, habits: {}, events: {} });

export const newId = () => crypto.randomUUID();

export const repo = new Repo({ storage: new IndexedDBStorageAdapter("ledger") });

/** Open the active doc. Rejects if the stored doc can't be loaded. */
export async function openHandle(): Promise<DocHandle<LedgerDoc>> {
  const known = localStorage.getItem(URL_KEY) as AutomergeUrl | null;
  if (known) return repo.find<LedgerDoc>(known, { signal: AbortSignal.timeout(10_000) });
  return newSeededDoc();
}

/** Forget the active doc so the next load starts from the seed (old data stays in IndexedDB). */
export function forgetActiveDoc(): void {
  localStorage.removeItem(URL_KEY);
}

/** Create a fresh doc with the seed habits and make it the active one. */
function newSeededDoc(): DocHandle<LedgerDoc> {
  const handle = repo.create<LedgerDoc>(emptyDoc());
  for (const name of SEED_HABITS) createDailyHabit(handle, name);
  localStorage.setItem(URL_KEY, handle.url);
  return handle;
}

/** Delete the current doc and start over from the seed. */
export async function resetToSeed(current: DocHandle<LedgerDoc>): Promise<void> {
  const next = newSeededDoc();
  // must reach IndexedDB before the caller reloads the page
  await repo.flush([next.documentId]);
  repo.delete(current.documentId);
  await repo.flush();
}

/**
 * Ask the browser not to evict our storage. Safari otherwise clears site data
 * after 7 days without a visit unless the app is installed to the home screen.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return (await navigator.storage.persisted()) || navigator.storage.persist();
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
  habit: Habit,
  date: string,
): void {
  // read the live doc, not a render snapshot, so quick repeat taps stay correct
  const existing = habitEventsOn(h.doc() as LedgerDoc, habit, date);
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
    const existing = Object.values(d.habits);
    const orders = existing.map((x) => x.order ?? 0);
    // least-used palette colour, so habits stay distinguishable
    const used = existing.filter((x) => !x.archived).map(habitHue);
    const hue = [...HUES].sort((a, b) => used.filter((u) => u === a).length - used.filter((u) => u === b).length)[0]!;
    d.habits[id] = { ...habit, order: Math.max(0, ...orders) + 1, hue };
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
export async function importBackup(bytes: Uint8Array): Promise<void> {
  const h = repo.import<LedgerDoc>(bytes);
  // must reach IndexedDB before the caller reloads the page
  await repo.flush([h.documentId]);
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

export function setHabitHue(h: DocHandle<LedgerDoc>, habitId: string, hue: number): void {
  h.change((d) => {
    const habit = d.habits[habitId];
    if (habit) habit.hue = hue;
  });
}

/** Swap a habit with its neighbour in display order (dir -1 = up, 1 = down). */
export function moveHabit(h: DocHandle<LedgerDoc>, habitId: string, dir: -1 | 1): void {
  h.change((d) => {
    const list = activeHabits(d);
    const i = list.findIndex((x) => x.id === habitId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    // renumber so habits without an order get one; pin colours first, since
    // an unset hue is derived from the order
    list.forEach((x, k) => {
      const habit = d.habits[x.id]!;
      if (habit.hue === undefined) habit.hue = habitHue(x);
      habit.order = k + 1;
    });
    d.habits[list[i]!.id]!.order = j + 1;
    d.habits[list[j]!.id]!.order = i + 1;
  });
}
