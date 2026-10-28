import { describe, expect, it } from "vitest";
import type { DoneIndex } from "./reduce";
import {
  bestStreak,
  countsOn,
  dayState,
  expectationOf,
  dayOfWeek,
  habitStreak,
  isDue,
  isScheduled,
  progress,
  scheduleLabel,
} from "./schedule";
import type { Expectation, Habit } from "./types";

const TODAY = "2026-10-21"; // a Wednesday; its week is Sun 18 – Sat 24
const habit = (expectation: Expectation): Habit => ({ id: "h", name: "H", eventTypeIds: ["t"], expectation });
const done = (...dates: string[]): DoneIndex => ({ types: new Map([["t", new Set(dates)]]), signals: new Map() });

describe("weekdays", () => {
  const mwf = habit({ kind: "weekdays", days: [1, 3, 5] });
  it("is only scheduled and due on its days", () => {
    expect(dayOfWeek(TODAY)).toBe(3);
    expect(isScheduled(mwf, TODAY)).toBe(true);
    expect(isScheduled(mwf, "2026-10-20")).toBe(false);
    expect(isDue(done(), mwf, "2026-10-20")).toBe(false);
  });
  it("counts streaks over scheduled days only", () => {
    // Fri 16, Mon 19, Wed 21 (the Tuesday between doesn't matter)
    const idx = done("2026-10-16", "2026-10-19", TODAY);
    expect(habitStreak(idx, mwf, TODAY)).toBe(3);
    // not done yet today: still 2
    expect(habitStreak(done("2026-10-16", "2026-10-19"), mwf, TODAY)).toBe(2);
    // Monday missed
    expect(habitStreak(done("2026-10-16", TODAY), mwf, TODAY)).toBe(1);
    expect(bestStreak(idx, mwf)).toBe(3);
  });
});

describe("every N days", () => {
  const weekly = habit({ kind: "every", n: 7, unit: "day" });
  it("is due again N days after the last time", () => {
    expect(isDue(done(), weekly, TODAY)).toBe(true);
    expect(isDue(done("2026-10-15"), weekly, TODAY)).toBe(false);
    expect(isDue(done("2026-10-14"), weekly, TODAY)).toBe(true);
    expect(progress(done("2026-10-15"), weekly, TODAY)).toBe("next in 1d");
    expect(progress(done("2026-10-14"), weekly, TODAY)).toBe("due");
    expect(progress(done("2026-10-11"), weekly, TODAY)).toBe("3d late");
    expect(progress(done(TODAY), weekly, TODAY)).toBe("next in 7d");
  });
  it("counts check-ins kept within the interval", () => {
    const idx = done("2026-09-20", "2026-10-01", "2026-10-07", "2026-10-14");
    expect(habitStreak(idx, weekly, TODAY)).toBe(3); // 20 Sep → 1 Oct is 11 days
    expect(habitStreak(idx, weekly, "2026-10-22")).toBe(0); // 8 days since
    expect(bestStreak(idx, weekly)).toBe(3);
  });
});

describe("times per week", () => {
  const thrice = habit({ kind: "per", times: 3, unit: "week" });
  it("is due until the week's target is met", () => {
    expect(isDue(done("2026-10-18", "2026-10-19"), thrice, TODAY)).toBe(true);
    expect(isDue(done("2026-10-18", "2026-10-19", "2026-10-20"), thrice, TODAY)).toBe(false);
    // last week's check-ins don't count
    expect(isDue(done("2026-10-15", "2026-10-16", "2026-10-17"), thrice, TODAY)).toBe(true);
    expect(progress(done("2026-10-18", TODAY), thrice, TODAY)).toBe("2/3 this week");
  });
  it("counts in today when done today even though the target is met", () => {
    const idx = done("2026-10-18", "2026-10-19", "2026-10-20", TODAY);
    expect(countsOn(idx, thrice, TODAY)).toBe(true);
    expect(countsOn(done("2026-10-18", "2026-10-19", "2026-10-20"), thrice, TODAY)).toBe(false);
  });
  it("counts weeks met; the current week can't break it", () => {
    const twoWeeks = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-11", "2026-10-13", "2026-10-17"];
    expect(habitStreak(done(...twoWeeks), thrice, TODAY)).toBe(2);
    expect(habitStreak(done(...twoWeeks, "2026-10-18", "2026-10-19", TODAY), thrice, TODAY)).toBe(3);
    // the week of 11 Oct short by one
    expect(habitStreak(done("2026-10-04", "2026-10-05", "2026-10-06", "2026-10-11"), thrice, TODAY)).toBe(0);
    expect(bestStreak(done(...twoWeeks), thrice)).toBe(2);
  });
});

describe("times per month", () => {
  const twice = habit({ kind: "per", times: 2, unit: "month" });
  it("counts calendar months", () => {
    expect(isDue(done("2026-09-30", "2026-10-01"), twice, TODAY)).toBe(true);
    expect(isDue(done("2026-10-01", "2026-10-02"), twice, TODAY)).toBe(false);
    const idx = done("2026-08-01", "2026-08-31", "2026-09-10", "2026-09-11");
    expect(habitStreak(idx, twice, TODAY)).toBe(2);
    expect(habitStreak(done("2026-09-10", "2026-12-01", "2026-12-02"), twice, "2026-12-05")).toBe(1);
  });
  it("crosses year ends", () => {
    expect(bestStreak(done("2026-12-01", "2026-12-02", "2027-01-05", "2027-01-06"), twice)).toBe(2);
  });
});

describe("dayState", () => {
  it("marks days an interval check-in covers, then late ones", () => {
    const weekly = habit({ kind: "every", n: 7, unit: "day" });
    const idx = done("2026-10-10");
    expect(dayState(idx, weekly, "2026-10-10")).toBe("done");
    expect(dayState(idx, weekly, "2026-10-16")).toBe("covered");
    expect(dayState(idx, weekly, "2026-10-17")).toBe("open"); // due again
    expect(dayState(idx, weekly, "2026-10-18")).toBe("late");
    expect(dayState(done(), weekly, TODAY)).toBe("open"); // never done: just due
  });
  it("covers the rest of a period once its target is met", () => {
    const monthly = habit({ kind: "per", times: 1, unit: "month" });
    const idx = done("2026-10-03");
    expect(dayState(idx, monthly, "2026-10-02")).toBe("open");
    expect(dayState(idx, monthly, "2026-10-04")).toBe("covered");
    expect(dayState(idx, monthly, "2026-11-01")).toBe("open");
  });
  it("rests on a weekday habit's days off and leaves daily habits open", () => {
    expect(dayState(done(), habit({ kind: "weekdays", days: [0] }), TODAY)).toBe("rest");
    expect(dayState(done(), habit({ kind: "daily" }), TODAY)).toBe("open");
  });
});

describe("daily", () => {
  it("is always due and keeps its day streak", () => {
    const daily = habit({ kind: "daily" });
    expect(isDue(done(TODAY), daily, TODAY)).toBe(true);
    expect(habitStreak(done("2026-10-19", "2026-10-20"), daily, TODAY)).toBe(2);
  });
});

describe("longer units", () => {
  it("counts every-N weeks and months from the last time, month ends clamped", () => {
    const fortnightly = habit({ kind: "every", n: 2, unit: "week" });
    expect(isDue(done("2026-10-08"), fortnightly, TODAY)).toBe(false);
    expect(isDue(done("2026-10-07"), fortnightly, TODAY)).toBe(true);
    expect(progress(done("2026-10-10"), fortnightly, TODAY)).toBe("next in 3d");
    const monthly = habit({ kind: "every", n: 1, unit: "month" });
    expect(isDue(done("2026-09-22"), monthly, TODAY)).toBe(false);
    expect(isDue(done("2026-09-21"), monthly, TODAY)).toBe(true);
    // 31 Jan + 1 month is 28 Feb
    expect(dayState(done("2026-01-31"), monthly, "2026-02-28")).toBe("open");
    expect(dayState(done("2026-01-31"), monthly, "2026-02-27")).toBe("covered");
    expect(dayState(done("2026-01-31"), monthly, "2026-03-01")).toBe("late");
  });
  it("counts times per calendar year", () => {
    const yearly = habit({ kind: "per", times: 1, unit: "year" });
    expect(isDue(done("2026-01-05"), yearly, TODAY)).toBe(false);
    expect(isDue(done("2025-12-31"), yearly, TODAY)).toBe(true);
    expect(progress(done("2026-01-05"), yearly, TODAY)).toBe("1/1 this year");
    expect(habitStreak(done("2024-03-01", "2025-06-01"), yearly, TODAY)).toBe(2);
  });
});

describe("expectationOf", () => {
  it("treats a shape this build doesn't know as daily", () => {
    const old = habit({ kind: "perMonth", times: 1 } as unknown as Expectation);
    expect(isDue(done(TODAY), old, TODAY)).toBe(true);
    expect(scheduleLabel(expectationOf(old))).toBe("Every day");
  });
});

describe("scheduleLabel", () => {
  it("describes each kind", () => {
    expect(scheduleLabel({ kind: "weekdays", days: [5, 1, 3] })).toBe("Mon Wed Fri");
    expect(scheduleLabel({ kind: "every", n: 10, unit: "day" })).toBe("Every 10 days");
    expect(scheduleLabel({ kind: "per", times: 3, unit: "week" })).toBe("3× a week");
    expect(scheduleLabel({ kind: "every", n: 2, unit: "week" })).toBe("Every 2 weeks");
    expect(scheduleLabel({ kind: "every", n: 1, unit: "month" })).toBe("Every month");
  });
});
