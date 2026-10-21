import { describe, expect, it } from "vitest";
import { currentEvents, habitDoneOn, localDate } from "./reduce";
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
