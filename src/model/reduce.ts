import type { Event, Habit, LedgerDoc, Occurred } from "./types";

/** Local YYYY-MM-DD for a Date (midnight-to-midnight day boundary). */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function occurredDate(o: Occurred): string {
  return o.kind === "day" ? o.date : localDate(new Date(o.at));
}

/**
 * Live events: everything not superseded by an amend or tombstone.
 * The raw log is never modified; edits and deletes are appended entries.
 */
export function currentEvents(doc: Pick<LedgerDoc, "events">): Event[] {
  const all = Object.values(doc.events);
  const superseded = new Set<string>();
  for (const e of all) if (e.amends) superseded.add(e.amends);
  return all.filter((e) => !e.deleted && !superseded.has(e.id));
}

/** Live events that count toward `habit` on the given local date. */
export function habitEventsOn(
  doc: Pick<LedgerDoc, "events">,
  habit: Habit,
  date: string,
): Event[] {
  return currentEvents(doc).filter(
    (e) =>
      habit.eventTypeIds.includes(e.typeId) &&
      occurredDate(e.occurred) === date,
  );
}

/** `n` consecutive local dates ending at `end` (inclusive), oldest first. */
export function dayRange(end: string, n: number): string[] {
  const [y, m, d] = end.split("-").map(Number) as [number, number, number];
  return Array.from({ length: n }, (_, i) =>
    localDate(new Date(y, m - 1, d - (n - 1 - i))),
  );
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return localDate(new Date(y, m - 1, d + days));
}

/**
 * Whole weeks (Sunday-first) covering a month, as local dates. Includes
 * leading/trailing days from adjacent months to fill the grid.
 */
export function monthGrid(month: string): string[] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const lead = new Date(y, m - 1, 1).getDay();
  const weeks = Math.ceil((lead + new Date(y, m, 0).getDate()) / 7);
  return dayRange(localDate(new Date(y, m - 1, weeks * 7 - lead)), weeks * 7);
}

/** Local dates with at least one live event, per event type id. */
export type DoneIndex = Map<string, Set<string>>;

/** One pass over the log; views look dates up here instead of rescanning. */
export function doneIndex(doc: Pick<LedgerDoc, "events">): DoneIndex {
  const idx: DoneIndex = new Map();
  for (const e of currentEvents(doc)) {
    let days = idx.get(e.typeId);
    if (!days) idx.set(e.typeId, (days = new Set()));
    days.add(occurredDate(e.occurred));
  }
  return idx;
}

export function isDone(idx: DoneIndex, habit: Habit, date: string): boolean {
  return habit.eventTypeIds.some((t) => idx.get(t)?.has(date));
}

/** All done dates for a habit, sorted ascending. */
export function doneDates(idx: DoneIndex, habit: Habit): string[] {
  const all = new Set<string>();
  for (const t of habit.eventTypeIds) for (const d of idx.get(t) ?? []) all.add(d);
  return [...all].sort();
}

export const hashHue = (s: string) =>
  [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

/** Habit colour palette (hues); all readable behind a white checkmark. */
export const HUES = [0, 22, 38, 150, 172, 195, 215, 245, 275, 320];

/** Explicit hue, else spread by display order (distinct for the first ten). */
export const habitHue = (habit: Habit) =>
  habit.hue ?? HUES[((habit.order ?? hashHue(habit.id)) - 1 + HUES.length) % HUES.length]!;

const byOrder = (a: Habit, b: Habit) =>
  (a.order ?? Infinity) - (b.order ?? Infinity) || a.name.localeCompare(b.name);

export function habitDoneOn(
  doc: Pick<LedgerDoc, "events">,
  habit: Habit,
  date: string,
): boolean {
  return habitEventsOn(doc, habit, date).length > 0;
}

export function activeHabits(doc: Pick<LedgerDoc, "habits">): Habit[] {
  return Object.values(doc.habits).filter((h) => !h.archived).sort(byOrder);
}

export function archivedHabits(doc: Pick<LedgerDoc, "habits">): Habit[] {
  return Object.values(doc.habits).filter((h) => h.archived).sort(byOrder);
}
