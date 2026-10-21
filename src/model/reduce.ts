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
  return dayRange(date, 1 + Math.abs(days))[days < 0 ? 0 : Math.abs(days)]!;
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

/**
 * Consecutive done days ending today. A not-yet-done today doesn't break
 * the streak, so it counts back from yesterday in that case.
 */
export function habitStreak(
  doc: Pick<LedgerDoc, "events">,
  habit: Habit,
  today: string,
): number {
  const doneDays = new Set(
    currentEvents(doc)
      .filter((e) => habit.eventTypeIds.includes(e.typeId))
      .map((e) => occurredDate(e.occurred)),
  );
  let day = doneDays.has(today) ? today : shiftDate(today, -1);
  let n = 0;
  while (doneDays.has(day)) {
    n++;
    day = shiftDate(day, -1);
  }
  return n;
}

export function habitDoneOn(
  doc: Pick<LedgerDoc, "events">,
  habit: Habit,
  date: string,
): boolean {
  return habitEventsOn(doc, habit, date).length > 0;
}
