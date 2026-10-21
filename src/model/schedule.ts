// What a habit's expectation means on a given day: whether it's due, how its
// streak counts, and how to describe it. Weeks run Sunday to Saturday, like
// the calendar.
import { doneDates, isDone, shiftDate, type DoneIndex } from "./reduce";
import type { Expectation, Habit } from "./types";

export const DAILY: Expectation = { kind: "daily" };

/** 0 = Sunday … 6 = Saturday. */
export const dayOfWeek = (date: string) => new Date(`${date}T00:00`).getDay();

const toUtc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};
/** Whole days from `a` to `b`. */
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / 86_400_000);

const weekStart = (date: string) => shiftDate(date, -dayOfWeek(date));
const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
const nextMonth = (start: string) => {
  const [y, m] = start.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};

type Period = { start: (date: string) => string; next: (start: string) => string; times: number };
function period(e: Expectation): Period | undefined {
  if (e.kind === "perWeek") return { start: weekStart, next: (s) => shiftDate(s, 7), times: e.times };
  if (e.kind === "perMonth") return { start: monthStart, next: nextMonth, times: e.times };
  return undefined;
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
  const e = habit.expectation;
  return e.kind !== "weekdays" || e.days.includes(dayOfWeek(date));
}

/** Whether the habit still needs doing on `date`, ignoring a check-in that day. */
export function isDue(idx: DoneIndex, habit: Habit, date: string): boolean {
  const e = habit.expectation;
  switch (e.kind) {
    case "daily":
      return true;
    case "weekdays":
      return e.days.includes(dayOfWeek(date));
    case "every": {
      const last = lastBefore(idx, habit, date);
      return !last || daysBetween(last, date) >= e.days;
    }
    case "perWeek":
    case "perMonth": {
      const p = period(e)!;
      return countBetween(doneDates(idx, habit), p.start(date), date) < p.times;
    }
  }
}

/** Whether the habit belongs in the day's to-do count: due, or done anyway. */
export const countsOn = (idx: DoneIndex, habit: Habit, date: string) =>
  isDone(idx, habit, date) || isDue(idx, habit, date);

/** "2/3 this week" for period habits; "due", "in 3d" or "2d late" for intervals. */
export function progress(idx: DoneIndex, habit: Habit, today: string): string | undefined {
  const e = habit.expectation;
  const p = period(e);
  if (p) {
    const n = countBetween(doneDates(idx, habit), p.start(today), shiftDate(today, 1));
    return `${n}/${p.times} this ${e.kind === "perWeek" ? "week" : "month"}`;
  }
  if (e.kind === "every") {
    if (isDone(idx, habit, today)) return `next in ${e.days}d`;
    const last = lastBefore(idx, habit, today);
    if (!last) return "due";
    const left = e.days - daysBetween(last, today);
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
  const e = habit.expectation;
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
        if (!isScheduled(habit, day)) continue;
        if (!isDone(idx, habit, day)) break;
        n++;
      }
      return n;
    }
    case "every": {
      if (daysBetween(dates.at(-1)!, today) > e.days) return 0;
      let n = 1;
      for (let i = dates.length - 1; i > 0 && daysBetween(dates[i - 1]!, dates[i]!) <= e.days; i--) n++;
      return n;
    }
    case "perWeek":
    case "perMonth": {
      const p = period(e)!;
      const starts = periodStarts(p, first, today);
      let n = 0;
      for (let i = starts.length - 1; i >= 0; i--) {
        const met = countBetween(dates, starts[i]!, p.next(starts[i]!)) >= p.times;
        if (met) n++;
        else if (i < starts.length - 1) break; // the current period may still get there
      }
      return n;
    }
  }
}

/** The longest streak ever, in the same unit as habitStreak. */
export function bestStreak(idx: DoneIndex, habit: Habit): number {
  const e = habit.expectation;
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
        if (isScheduled(habit, day)) step(isDone(idx, habit, day));
      return best;
    case "every":
      step(true);
      for (let i = 1; i < dates.length; i++) {
        if (daysBetween(dates[i - 1]!, dates[i]!) > e.days) run = 0;
        step(true);
      }
      return best;
    case "perWeek":
    case "perMonth": {
      const p = period(e)!;
      for (const s of periodStarts(p, first, last)) step(countBetween(dates, s, p.next(s)) >= p.times);
      return best;
    }
  }
}

function periodStarts(p: Period, from: string, to: string): string[] {
  const out: string[] = [];
  for (let s = p.start(from); s <= to; s = p.next(s)) out.push(s);
  return out;
}

/** Short unit after a streak number: days for day-based habits. */
export function streakUnit(e: Expectation): string {
  return e.kind === "perWeek" ? "w" : e.kind === "perMonth" ? "mo" : e.kind === "every" ? "×" : "";
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function scheduleLabel(e: Expectation): string {
  switch (e.kind) {
    case "daily":
      return "Every day";
    case "weekdays":
      return [...e.days].sort().map((d) => WEEKDAYS[d]).join(" ");
    case "every":
      return `Every ${e.days} days`;
    case "perWeek":
      return `${e.times}× a week`;
    case "perMonth":
      return `${e.times}× a month`;
  }
}
