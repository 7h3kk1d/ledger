import { describe, expect, it } from "vitest";
import {
  bestStreak,
  currentEvents,
  dayRange,
  doneIndex,
  habitDoneOn,
  habitStreak,
  localDate,
  monthGrid,
  shiftDate,
} from "./reduce";
import type { Event, Habit } from "./types";

const ev = (id: string, over: Partial<Event> = {}): Event => ({
  id,
  typeId: "t1",
  author: "local",
  loggedAt: "2026-10-21T12:00:00.000Z",
  occurred: { kind: "day", date: "2026-10-21" },
  attrs: {},
  ...over,
});
const docOf = (...es: Event[]) => ({
  events: Object.fromEntries(es.map((e) => [e.id, e])),
});
const habit: Habit = {
  id: "h1",
  name: "Stretch",
  eventTypeIds: ["t1"],
  expectation: { kind: "daily" },
};

describe("currentEvents", () => {
  it("returns plain events", () => {
    expect(currentEvents(docOf(ev("a"))).map((e) => e.id)).toEqual(["a"]);
  });
  it("replaces an amended event with its amendment", () => {
    const d = docOf(ev("a"), ev("b", { amends: "a" }));
    expect(currentEvents(d).map((e) => e.id)).toEqual(["b"]);
  });
  it("follows amend chains", () => {
    const d = docOf(ev("a"), ev("b", { amends: "a" }), ev("c", { amends: "b" }));
    expect(currentEvents(d).map((e) => e.id)).toEqual(["c"]);
  });
  it("hides tombstoned events but keeps them in the raw log", () => {
    const d = docOf(ev("a"), ev("x", { amends: "a", deleted: true }));
    expect(currentEvents(d)).toEqual([]);
    expect(Object.keys(d.events)).toContain("a");
  });
});

describe("monthGrid", () => {
  it("pads to whole Sunday-first weeks", () => {
    const g = monthGrid("2026-10"); // Oct 1 2026 is a Thursday
    expect(g).toHaveLength(35);
    expect(g[0]).toBe("2026-09-27");
    expect(g[4]).toBe("2026-10-01");
    expect(g[34]).toBe("2026-10-31");
  });
  it("handles a month that fits exactly in 4 weeks", () => {
    const g = monthGrid("2026-02"); // Feb 1 2026 is a Sunday, 28 days
    expect(g).toHaveLength(28);
    expect(g[0]).toBe("2026-02-01");
    expect(g[27]).toBe("2026-02-28");
  });
  it("can need six rows", () => {
    expect(monthGrid("2026-08")).toHaveLength(42); // Aug 1 2026 is a Saturday
  });
});

describe("dayRange / habitStreak", () => {
  const day = (id: string, date: string) =>
    ev(id, { occurred: { kind: "day", date } });
  it("builds ranges across month boundaries", () => {
    expect(dayRange("2026-03-02", 4)).toEqual([
      "2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02",
    ]);
  });
  it("counts consecutive days ending today", () => {
    const d = docOf(day("a", "2026-10-19"), day("b", "2026-10-20"), day("c", "2026-10-21"));
    expect(habitStreak(d, habit, "2026-10-21")).toBe(3);
  });
  it("keeps the streak alive when today isn't done yet", () => {
    const d = docOf(day("a", "2026-10-19"), day("b", "2026-10-20"));
    expect(habitStreak(d, habit, "2026-10-21")).toBe(2);
  });
  it("breaks on a gap", () => {
    const d = docOf(day("a", "2026-10-18"), day("c", "2026-10-21"));
    expect(habitStreak(d, habit, "2026-10-21")).toBe(1);
    expect(habitStreak(docOf(day("a", "2026-10-18")), habit, "2026-10-21")).toBe(0);
  });
});

describe("habitDoneOn", () => {
  it("is done when a whole-day event exists for the date", () => {
    expect(habitDoneOn(docOf(ev("a")), habit, "2026-10-21")).toBe(true);
    expect(habitDoneOn(docOf(ev("a")), habit, "2026-10-20")).toBe(false);
  });
  it("uses the local date for exact timestamps", () => {
    const at = new Date(2026, 9, 21, 23, 30).toISOString();
    const d = docOf(ev("a", { occurred: { kind: "instant", at } }));
    expect(habitDoneOn(d, habit, localDate(new Date(at)))).toBe(true);
  });
  it("ignores other event types and undone days", () => {
    expect(
      habitDoneOn(docOf(ev("a", { typeId: "other" })), habit, "2026-10-21"),
    ).toBe(false);
    const undone = docOf(ev("a"), ev("x", { amends: "a", deleted: true }));
    expect(habitDoneOn(undone, habit, "2026-10-21")).toBe(false);
  });
});

describe("bestStreak", () => {
  const day = (id: string, date: string) => ev(id, { occurred: { kind: "day", date } });
  it("finds the longest run, across month boundaries", () => {
    const d = docOf(
      day("a", "2026-09-29"), day("b", "2026-09-30"), day("c", "2026-10-01"),
      day("d", "2026-10-05"), day("e", "2026-10-06"),
    );
    expect(bestStreak(doneIndex(d), habit)).toBe(3);
  });
  it("is zero with no events", () => {
    expect(bestStreak(doneIndex(docOf()), habit)).toBe(0);
  });
});

describe("shiftDate", () => {
  it("moves forward and back across month and year ends", () => {
    expect(shiftDate("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDate("2026-12-28", 7)).toBe("2027-01-04");
    expect(shiftDate("2026-10-21", 0)).toBe("2026-10-21");
  });
});
