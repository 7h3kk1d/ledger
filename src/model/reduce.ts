import type { Observation, SignalIndex } from "./signals";
import type { Event, Habit, HabitDisplay, LedgerDoc, MetricRef, Occurred, Threshold } from "./types";

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

/**
 * Which local dates count for habits: the log's own events, and the
 * observations of signals habits link to. Manual check-ins and signals add
 * together; neither cancels the other.
 */
export interface DoneIndex {
  /** Local dates with at least one live event, per event type id. */
  types: Map<string, Set<string>>;
  /** Linked signals' observations by local date, per signal id. */
  signals: SignalIndex;
}

/** One pass over the log; views look dates up here instead of rescanning. */
export function doneIndex(doc: Pick<LedgerDoc, "events">, signals: SignalIndex = new Map()): DoneIndex {
  const types = new Map<string, Set<string>>();
  for (const e of currentEvents(doc)) {
    let days = types.get(e.typeId);
    if (!days) types.set(e.typeId, (days = new Set()));
    days.add(occurredDate(e.occurred));
  }
  return { types, signals };
}

const validId = (s: unknown): s is string => typeof s === "string" && s.length > 0;

/** The habit's linked signal ids; anything malformed is ignored. */
export const signalsOf = (habit: Habit): string[] =>
  Array.isArray(habit.signals) ? habit.signals.filter(validId) : [];

const validRef = (r: unknown): r is MetricRef =>
  typeof r === "object" && r !== null && validId((r as MetricRef).signal) && validId((r as MetricRef).metric);

/** The habit's display settings, keeping only well-formed references to its linked signals. */
export function displayOf(habit: Habit): HabitDisplay {
  const d = habit.display;
  if (typeof d !== "object" || d === null) return {};
  const linked = new Set(signalsOf(habit));
  const ok = (r: unknown): r is MetricRef => validRef(r) && linked.has(r.signal);
  const out: HabitDisplay = {};
  if (ok(d.streak)) out.streak = d.streak;
  if (Array.isArray(d.metrics)) {
    const metrics = d.metrics.filter(ok);
    if (metrics.length) out.metrics = metrics;
  }
  return out;
}

/** The habit's thresholds by signal: well-formed, for linked signals, the first per signal. */
export function thresholdsOf(habit: Habit): Map<string, Threshold> {
  const out = new Map<string, Threshold>();
  if (!Array.isArray(habit.thresholds)) return out;
  const linked = new Set(signalsOf(habit));
  for (const t of habit.thresholds as unknown[]) {
    if (!validRef(t) || !linked.has(t.signal) || out.has(t.signal)) continue;
    const { op, value } = t as Threshold;
    if ((op === "atLeast" || op === "atMost") && typeof value === "number" && Number.isFinite(value))
      out.set(t.signal, { signal: t.signal, metric: t.metric, op, value });
  }
  return out;
}

/**
 * A day's total of a metric over a signal's observations (excuses aside), or
 * undefined when none of them reports it.
 */
export function dayTotal(obs: readonly Observation[] | undefined, metric: string): number | undefined {
  let total: number | undefined;
  for (const o of obs ?? []) {
    const v = o.metrics[metric];
    if (o.effect !== "excuses" && typeof v === "number") total = (total ?? 0) + v;
  }
  return total;
}

/** Whether a day's total passes a threshold; a day without the metric doesn't. */
export const meets = (t: Threshold, total: number | undefined): boolean =>
  total !== undefined && (t.op === "atLeast" ? total >= t.value : total <= t.value);

/** Whether one linked signal counts the day as done. */
function signalSatisfies(idx: DoneIndex, id: string, t: Threshold | undefined, date: string): boolean {
  const d = idx.signals.get(id);
  if (!d) return false;
  return t ? meets(t, dayTotal(d.byDate.get(date), t.metric)) : d.satisfied.has(date);
}

/** Checked in by hand that day (an event of the habit's own types). */
export function manualDone(idx: DoneIndex, habit: Habit, date: string): boolean {
  return habit.eventTypeIds.some((t) => idx.types.get(t)?.has(date));
}

/**
 * A linked signal counts the day: its total passes the habit's threshold for
 * it, or, without one, one of its observations satisfies the day.
 */
export function signalDone(idx: DoneIndex, habit: Habit, date: string): boolean {
  const ts = thresholdsOf(habit);
  return signalsOf(habit).some((s) => signalSatisfies(idx, s, ts.get(s), date));
}

export function isDone(idx: DoneIndex, habit: Habit, date: string): boolean {
  return manualDone(idx, habit, date) || signalDone(idx, habit, date);
}

/** Not done, but a linked signal excuses the day (e.g. a streak freeze). */
export function isExcused(idx: DoneIndex, habit: Habit, date: string): boolean {
  return !isDone(idx, habit, date) && signalsOf(habit).some((s) => idx.signals.get(s)?.excused.has(date));
}

/**
 * A linked habit's day that no linked signal has data for (before its data
 * starts, or after its last fetch), and that wasn't checked in: whether it was
 * missed can't be told. Habits without linked signals never have such days.
 */
export function isUnknown(idx: DoneIndex, habit: Habit, date: string): boolean {
  const linked = signalsOf(habit);
  if (linked.length === 0 || isDone(idx, habit, date) || isExcused(idx, habit, date)) return false;
  return !linked.some((s) => {
    const d = idx.signals.get(s);
    return d?.from !== undefined && d.to !== undefined && d.from <= date && date <= d.to;
  });
}

/** All done dates for a habit, sorted ascending. */
export function doneDates(idx: DoneIndex, habit: Habit): string[] {
  const all = new Set<string>();
  for (const t of habit.eventTypeIds) for (const d of idx.types.get(t) ?? []) all.add(d);
  const ts = thresholdsOf(habit);
  for (const s of signalsOf(habit)) {
    const d = idx.signals.get(s);
    const t = ts.get(s);
    if (!d) continue;
    if (!t) for (const date of d.satisfied) all.add(date);
    else for (const [date, obs] of d.byDate) if (meets(t, dayTotal(obs, t.metric))) all.add(date);
  }
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

/** The event type of notes on a day (see notesOn); created on first use. */
export const NOTE_TYPE = "ledger:note";

export interface Note {
  event: Event;
  reason: string;
  text: string;
}

/**
 * Live notes about a habit on a local date. A note explains a day (a reason
 * such as travel, and optional text) without changing whether it's done.
 */
export function notesOn(doc: Pick<LedgerDoc, "events">, habitId: string, date: string): Note[] {
  return currentEvents(doc)
    .filter((e) => e.typeId === NOTE_TYPE && e.attrs.habit === habitId && occurredDate(e.occurred) === date)
    .map((e) => ({ event: e, reason: String(e.attrs.reason ?? ""), text: String(e.attrs.text ?? "") }));
}

/** "habitId date" for every day with a live note, to badge cells without rescanning. */
export function noteIndex(doc: Pick<LedgerDoc, "events">): Set<string> {
  const out = new Set<string>();
  for (const e of currentEvents(doc))
    if (e.typeId === NOTE_TYPE && typeof e.attrs.habit === "string") out.add(`${e.attrs.habit} ${occurredDate(e.occurred)}`);
  return out;
}
