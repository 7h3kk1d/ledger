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

const URL_KEY = "ledger:docUrl";

const emptyDoc = (): LedgerDoc => ({ eventTypes: {}, habits: {}, events: {} });

export const newId = () => crypto.randomUUID();

export const repo = new Repo({ storage: new IndexedDBStorageAdapter("ledger") });

export async function openHandle(): Promise<DocHandle<LedgerDoc>> {
  const known = localStorage.getItem(URL_KEY) as AutomergeUrl | null;
  if (known) return repo.find<LedgerDoc>(known);
  const handle = repo.create<LedgerDoc>(emptyDoc());
  localStorage.setItem(URL_KEY, handle.url);
  return handle;
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
    occurred: target.occurred,
    attrs: {},
    amends: target.id,
    deleted: true,
  };
  h.change((d) => {
    d.events[id] = event;
  });
  return id;
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
