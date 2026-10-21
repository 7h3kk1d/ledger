import { describe, expect, it } from "vitest";
import type { DoneIndex } from "./reduce";
import {
  bestStreak,
  countsOn,
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
const done = (...dates: string[]): DoneIndex => new Map([["t", new Set(dates)]]);

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
  const weekly = habit({ kind: "every", days: 7 });
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
  const thrice = habit({ kind: "perWeek", times: 3 });
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
  const twice = habit({ kind: "perMonth", times: 2 });
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

describe("daily", () => {
  it("is always due and keeps its day streak", () => {
    const daily = habit({ kind: "daily" });
    expect(isDue(done(TODAY), daily, TODAY)).toBe(true);
    expect(habitStreak(done("2026-10-19", "2026-10-20"), daily, TODAY)).toBe(2);
  });
});

describe("scheduleLabel", () => {
  it("describes each kind", () => {
    expect(scheduleLabel({ kind: "weekdays", days: [5, 1, 3] })).toBe("Mon Wed Fri");
    expect(scheduleLabel({ kind: "every", days: 10 })).toBe("Every 10 days");
    expect(scheduleLabel({ kind: "perWeek", times: 3 })).toBe("3× a week");
  });
});
