// Mutations on a ledger doc handle. No browser or Vite dependencies, so the
// bootstrap script can use them too.
import type { DocHandle } from "@automerge/automerge-repo";
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
import { activeHabits, habitEventsOn, habitHue, HUES, localDate, NOTE_TYPE } from "../model/reduce";
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
    if (next.streak || next.metrics) habit.display = next;
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
