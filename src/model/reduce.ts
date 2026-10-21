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

export function habitDoneOn(
  doc: Pick<LedgerDoc, "events">,
  habit: Habit,
  date: string,
): boolean {
  return habitEventsOn(doc, habit, date).length > 0;
}
