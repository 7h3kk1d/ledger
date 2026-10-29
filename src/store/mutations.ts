// Mutations on a ledger doc handle. No browser or Vite dependencies, so the
// bootstrap script can use them too.
import { getConflicts, type DocHandle } from "@automerge/automerge-repo";
import {
  LOCAL_AUTHOR,
  type Attrs,
  type Event,
  type Expectation,
  type Habit,
  type HabitDisplay,
  type LedgerDoc,
  type MetricRef,
  type Occurred,
  type Threshold,
} from "../model/types";
import { activeHabits, allTags, habitEventsOn, habitHue, HUES, localDate, NOTE_TYPE, taggedKey } from "../model/reduce";
import { DAILY } from "../model/schedule";

export const newId = () => crypto.randomUUID();

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
export function createHabit(h: DocHandle<LedgerDoc>, name: string, expectation: Expectation = DAILY): string {
  const typeId = createEventType(h, name);
  const id = newId();
  const habit: Habit = {
    id,
    name,
    eventTypeIds: [typeId],
    expectation: copyExpectation(expectation),
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

/** A plain copy, so a value read from one doc can be written into another. */
const copyExpectation = (e: Expectation): Expectation =>
  e.kind === "weekdays" ? { kind: e.kind, days: [...e.days] } : ({ ...e } as Expectation);

export function setHabitExpectation(h: DocHandle<LedgerDoc>, habitId: string, expectation: Expectation): void {
  h.change((d) => {
    const habit = d.habits[habitId];
    if (habit) habit.expectation = copyExpectation(expectation);
  });
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

/** Move a habit to position `to` in display order (0 = top). */
export function moveHabit(h: DocHandle<LedgerDoc>, habitId: string, to: number): void {
  h.change((d) => {
    const list = activeHabits(d);
    const i = list.findIndex((x) => x.id === habitId);
    const j = Math.max(0, Math.min(to, list.length - 1));
    if (i < 0 || i === j) return;
    list.splice(j, 0, list.splice(i, 1)[0]!);
    // renumber so habits without an order get one; pin colours first, since
    // an unset hue is derived from the order
    list.forEach((x, k) => {
      const habit = d.habits[x.id]!;
      if (habit.hue === undefined) habit.hue = habitHue(x);
      if (habit.order !== k + 1) habit.order = k + 1;
    });
  });
}

/** Link a habit to signals (ids from the signals service); an empty list unlinks all. */
export function setHabitSignals(h: DocHandle<LedgerDoc>, habitId: string, signals: string[]): void {
  h.change((d) => {
    const habit = d.habits[habitId];
    if (!habit) return;
    if (signals.length) habit.signals = [...signals];
    else delete habit.signals;
  });
}

/** What a habit shows from its linked signals; an empty value removes the setting. */
export function setHabitDisplay(h: DocHandle<LedgerDoc>, habitId: string, display: HabitDisplay): void {
  h.change((d) => {
    const habit = d.habits[habitId];
    if (!habit) return;
    // plain copies: Automerge can't take objects that live in another doc
    const ref = (r: MetricRef): MetricRef => ({ signal: r.signal, metric: r.metric });
    const next: HabitDisplay = {};
    if (display.streak) next.streak = ref(display.streak);
    if (display.metrics?.length) next.metrics = display.metrics.map(ref);
    if (display.cells === "value") next.cells = "value";
    if (next.streak || next.metrics || next.cells) habit.display = next;
    else delete habit.display;
  });
}

/** When a habit's linked signals count a day (see Habit.thresholds); an empty list removes them. */
export function setHabitThresholds(h: DocHandle<LedgerDoc>, habitId: string, thresholds: Threshold[]): void {
  h.change((d) => {
    const habit = d.habits[habitId];
    if (!habit) return;
    if (thresholds.length)
      habit.thresholds = thresholds.map((t) => ({ signal: t.signal, metric: t.metric, op: t.op, value: t.value }));
    else delete habit.thresholds;
  });
}

/**
 * Give the doc its tag maps if it predates tags. Run when a doc is opened, so
 * the maps exist (and have synced) before anyone tags anything: two devices
 * each creating the map offline would keep only one device's tags.
 */
export function ensureTags(h: DocHandle<LedgerDoc>): void {
  const d0 = h.doc() as LedgerDoc | undefined;
  if (!d0 || (d0.tags && d0.tagged)) return;
  h.change((d) => {
    if (!d.tags) d.tags = {};
    if (!d.tagged) d.tagged = {};
  });
}

/**
 * Merge copies of the tag maps that were made separately. A device (or script)
 * that opens a copy of the doc from before tags makes its own empty maps; when
 * that meets the server's, Automerge keeps one map per key and hides the other,
 * so tags seem to vanish. This puts every copy's entries back into one map.
 * Returns whether it changed the doc. A tag or tagging deleted in one copy
 * after the split comes back: better than losing the other copy's.
 */
export function healTags(h: DocHandle<LedgerDoc>): boolean {
  const d0 = h.doc() as LedgerDoc | undefined;
  if (!d0) return false;
  const merged = (key: "tags" | "tagged") => {
    const copies = Object.values(getConflicts(d0, key) ?? {});
    if (copies.length < 2) return undefined;
    // plain copies: Automerge can't take objects that live in the doc
    return Object.assign({}, ...copies.map((c) => JSON.parse(JSON.stringify(c)) as object));
  };
  const tags = merged("tags") as LedgerDoc["tags"];
  const tagged = merged("tagged") as LedgerDoc["tagged"];
  if (!tags && !tagged) return false;
  h.change((d) => {
    if (tags) d.tags = tags;
    if (tagged) d.tagged = tagged;
  });
  return true;
}

const sameName = (a: string, b: string) => a.trim().localeCompare(b.trim(), undefined, { sensitivity: "base" }) === 0;

/** A tag with this name (an existing one when the name is taken, ignoring case); its id. */
export function createTag(h: DocHandle<LedgerDoc>, name: string): string {
  const existing = allTags(h.doc() as LedgerDoc).find((t) => sameName(t.name, name));
  if (existing) return existing.id;
  ensureTags(h);
  const id = newId();
  h.change((d) => {
    d.tags![id] = { id, name: name.trim() };
  });
  return id;
}

export function renameTag(h: DocHandle<LedgerDoc>, tagId: string, name: string): void {
  h.change((d) => {
    const t = d.tags?.[tagId];
    if (t && name.trim()) t.name = name.trim();
  });
}

/** Delete a tag and take it off every habit. Habits themselves are untouched. */
export function deleteTag(h: DocHandle<LedgerDoc>, tagId: string): void {
  h.change((d) => {
    if (d.tags) delete d.tags[tagId];
    for (const k of Object.keys(d.tagged ?? {})) if (k.endsWith(` ${tagId}`)) delete d.tagged![k];
  });
}

/** Put a tag on a habit, or take it off. */
export function setHabitTag(h: DocHandle<LedgerDoc>, habitId: string, tagId: string, on: boolean): void {
  ensureTags(h);
  h.change((d) => {
    const k = taggedKey(habitId, tagId);
    if (on && d.tags?.[tagId]) d.tagged![k] = true;
    else if (!on) delete d.tagged![k];
  });
}

/** Add a note about a habit on a day: a reason and optional text. It doesn't change the day. */
export function addNote(h: DocHandle<LedgerDoc>, habitId: string, date: string, reason: string, text: string): string {
  if (!(h.doc() as LedgerDoc).eventTypes[NOTE_TYPE])
    h.change((d) => {
      d.eventTypes[NOTE_TYPE] = { id: NOTE_TYPE, name: "Note" };
    });
  const attrs: Attrs = { habit: habitId, reason };
  if (text) attrs.text = text;
  return logEvent(h, { typeId: NOTE_TYPE, occurred: { kind: "day", date }, attrs });
}
