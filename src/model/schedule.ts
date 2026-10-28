// What a habit's expectation means on a given day: whether it's due, how its
// streak counts, and how to describe it. Weeks run Sunday to Saturday, like
// the calendar.
import { doneDates, isDone, isExcused, shiftDate, type DoneIndex } from "./reduce";
import type { Expectation, Habit, PeriodUnit, TimeUnit } from "./types";

export const DAILY: Expectation = { kind: "daily" };

export const TIME_UNITS: TimeUnit[] = ["day", "week", "month", "year"];
export const PERIOD_UNITS: PeriodUnit[] = ["week", "month", "year"];
/** Most check-ins a period can hold (one a day). */
export const PERIOD_DAYS: Record<PeriodUnit, number> = { week: 7, month: 31, year: 366 };

const valid = (e: Expectation | undefined): boolean => {
  switch (e?.kind) {
    case "daily":
      return true;
    case "weekdays":
      return Array.isArray(e.days) && e.days.length > 0;
    case "every":
      return e.n >= 1 && TIME_UNITS.includes(e.unit);
    case "per":
      return e.times >= 1 && PERIOD_UNITS.includes(e.unit);
    default:
      return false;
  }
};

/**
 * The habit's expectation, or daily if it has a shape this build doesn't
 * know (written by an older or newer build). Read it through here.
 */
export const expectationOf = (habit: Habit): Expectation =>
  valid(habit.expectation) ? habit.expectation : DAILY;

/** 0 = Sunday … 6 = Saturday. */
export const dayOfWeek = (date: string) => new Date(`${date}T00:00`).getDay();

const toUtc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};
/** Whole days from `a` to `b`. */
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / 86_400_000);

/** `n` months later, on the same day of the month or the month's last day. */
function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const months = y * 12 + (m - 1) + n;
  const yy = Math.floor(months / 12);
  const mm = (months % 12) + 1;
  const last = new Date(yy, mm, 0).getDate();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${yy}-${p(mm)}-${p(Math.min(d, last))}`;
}

/** `date` moved on by `n` of `unit`. */
export function addUnits(date: string, n: number, unit: TimeUnit): string {
  switch (unit) {
    case "day":
      return shiftDate(date, n);
    case "week":
      return shiftDate(date, 7 * n);
    case "month":
      return addMonths(date, n);
    case "year":
      return addMonths(date, 12 * n);
  }
}

/** First day of the calendar week, month or year containing `date`. */
function periodStart(date: string, unit: PeriodUnit): string {
  if (unit === "week") return shiftDate(date, -dayOfWeek(date));
  if (unit === "month") return `${date.slice(0, 7)}-01`;
  return `${date.slice(0, 4)}-01-01`;
}

/** Done days in [from, to), both local dates. */
const countBetween = (dates: string[], from: string, to: string) =>
  dates.filter((d) => d >= from && d < to).length;

/** Last done date strictly before `date`. */
function lastBefore(idx: DoneIndex, habit: Habit, date: string): string | undefined {
  return doneDates(idx, habit).filter((d) => d < date).at(-1);
}

/**
 * Whether the habit is expected on `date` at all. Only fixed weekdays leave
 * days out; the other kinds can be done on any day.
 */
export function isScheduled(habit: Habit, date: string): boolean {
  const e = expectationOf(habit);
  return e.kind !== "weekdays" || e.days.includes(dayOfWeek(date));
}

/**
 * Whether excuses (a linked signal's "knowingly skipped, and that's fine")
 * apply to the habit. Only day-by-day habits for now: an excused day is left
 * out like a rest day. Interval and per-period habits ignore them.
 */
const excusable = (e: Expectation) => e.kind === "daily" || e.kind === "weekdays";

/** Whether the habit still needs doing on `date`, ignoring a check-in that day. */
export function isDue(idx: DoneIndex, habit: Habit, date: string): boolean {
  const e = expectationOf(habit);
  switch (e.kind) {
    case "daily":
      return !isExcused(idx, habit, date);
    case "weekdays":
      return e.days.includes(dayOfWeek(date)) && !isExcused(idx, habit, date);
    case "every": {
      const last = lastBefore(idx, habit, date);
      return !last || date >= addUnits(last, e.n, e.unit);
    }
    case "per":
      return countBetween(doneDates(idx, habit), periodStart(date, e.unit), date) < e.times;
  }
}

/**
 * How a day looks for a habit:
 * - done: checked in
 * - rest: a fixed weekday habit's day off
 * - excused: a linked signal excuses the day (day-by-day habits only)
 * - covered: not needed, an earlier check-in takes care of it (inside an
 *   interval, or after the period's target is met)
 * - late: past an interval habit's due date
 * - open: expected and not done yet
 */
export type DayState = "done" | "rest" | "excused" | "covered" | "late" | "open";

export function dayState(idx: DoneIndex, habit: Habit, date: string): DayState {
  if (isDone(idx, habit, date)) return "done";
  const e = expectationOf(habit);
  if (excusable(e) && isScheduled(habit, date) && isExcused(idx, habit, date)) return "excused";
  if (e.kind === "weekdays") return isScheduled(habit, date) ? "open" : "rest";
  if (!isDue(idx, habit, date)) return "covered";
  if (e.kind === "every") {
    const last = lastBefore(idx, habit, date);
    if (last && date > addUnits(last, e.n, e.unit)) return "late";
  }
  return "open";
}

/** Whether the habit belongs in the day's to-do count: due, or done anyway. */
export const countsOn = (idx: DoneIndex, habit: Habit, date: string) =>
  isDone(idx, habit, date) || isDue(idx, habit, date);

/** "2/3 this week" for period habits; "due", "next in 3d" or "2d late" for intervals. */
export function progress(idx: DoneIndex, habit: Habit, today: string): string | undefined {
  const e = expectationOf(habit);
  if (e.kind === "per") {
    const n = countBetween(doneDates(idx, habit), periodStart(today, e.unit), shiftDate(today, 1));
    return `${n}/${e.times} this ${e.unit}`;
  }
  if (e.kind === "every") {
    const last = isDone(idx, habit, today) ? today : lastBefore(idx, habit, today);
    if (!last) return "due";
    const left = daysBetween(today, addUnits(last, e.n, e.unit));
    return left > 0 ? `next in ${left}d` : left === 0 ? "due" : `${-left}d late`;
  }
  return undefined;
}

/**
 * The current streak, in the habit's own unit (see streakUnit). The period in
 * progress never breaks it: a day not done yet, a week still short of its
 * target, an interval not over.
 */
export function habitStreak(idx: DoneIndex, habit: Habit, today: string): number {
  const e = expectationOf(habit);
  const dates = doneDates(idx, habit).filter((d) => d <= today);
  if (dates.length === 0) return 0;
  const first = dates[0]!;
  switch (e.kind) {
    case "daily":
    case "weekdays": {
      let day = today;
      if (!isDone(idx, habit, day)) day = shiftDate(day, -1);
      let n = 0;
      for (; day >= first; day = shiftDate(day, -1)) {
        // days off and excused days neither add to the streak nor break it
        if (!isScheduled(habit, day) || isExcused(idx, habit, day)) continue;
        if (!isDone(idx, habit, day)) break;
        n++;
      }
      return n;
    }
    case "every": {
      const inTime = (a: string, b: string) => b <= addUnits(a, e.n, e.unit);
      if (!inTime(dates.at(-1)!, today)) return 0;
      let n = 1;
      for (let i = dates.length - 1; i > 0 && inTime(dates[i - 1]!, dates[i]!); i--) n++;
      return n;
    }
    case "per": {
      const starts = periodStarts(e.unit, first, today);
      let n = 0;
      for (let i = starts.length - 1; i >= 0; i--) {
        const met = countBetween(dates, starts[i]!, addUnits(starts[i]!, 1, e.unit)) >= e.times;
        if (met) n++;
        else if (i < starts.length - 1) break; // the current period may still get there
      }
      return n;
    }
  }
}

/** The longest streak ever, in the same unit as habitStreak. */
export function bestStreak(idx: DoneIndex, habit: Habit): number {
  const e = expectationOf(habit);
  const dates = doneDates(idx, habit);
  if (dates.length === 0) return 0;
  const first = dates[0]!;
  const last = dates.at(-1)!;
  let best = 0;
  let run = 0;
  const step = (ok: boolean) => {
    run = ok ? run + 1 : 0;
    best = Math.max(best, run);
  };
  switch (e.kind) {
    case "daily":
    case "weekdays":
      for (let day = first; day <= last; day = shiftDate(day, 1))
        if (isScheduled(habit, day) && !isExcused(idx, habit, day)) step(isDone(idx, habit, day));
      return best;
    case "every":
      step(true);
      for (let i = 1; i < dates.length; i++) {
        if (dates[i]! > addUnits(dates[i - 1]!, e.n, e.unit)) run = 0;
        step(true);
      }
      return best;
    case "per":
      for (const s of periodStarts(e.unit, first, last))
        step(countBetween(dates, s, addUnits(s, 1, e.unit)) >= e.times);
      return best;
  }
}

function periodStarts(unit: PeriodUnit, from: string, to: string): string[] {
  const out: string[] = [];
  for (let s = periodStart(from, unit); s <= to; s = addUnits(s, 1, unit)) out.push(s);
  return out;
}

/** Short unit after a streak number: days for day-based habits. */
export function streakUnit(e: Expectation): string {
  if (e.kind === "every") return "×";
  if (e.kind === "per") return { week: "w", month: "mo", year: "y" }[e.unit];
  return "";
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function scheduleLabel(e: Expectation): string {
  switch (e.kind) {
    case "daily":
      return "Every day";
    case "weekdays":
      return [...e.days].sort().map((d) => WEEKDAYS[d]).join(" ");
    case "every":
      return e.n === 1 ? `Every ${e.unit}` : `Every ${e.n} ${e.unit}s`;
    case "per":
      return `${e.times}× a ${e.unit}`;
  }
}
