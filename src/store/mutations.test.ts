import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { Repo, type DocHandle } from "@automerge/automerge-repo";
import { activeHabits, currentEvents, habitDoneOn } from "../model/reduce";
import type { LedgerDoc } from "../model/types";
import {
  createDailyHabit,
  logEvent,
  moveHabit,
  renameHabit,
  setHabitArchived,
  toggleHabit,
  tombstoneEvent,
} from "./mutations";

const doc = (h: DocHandle<LedgerDoc>) => h.doc() as LedgerDoc;
const newHandle = () =>
  new Repo({}).create<LedgerDoc>({ eventTypes: {}, habits: {}, events: {} });

describe("store mutations", () => {
  it("tombstones an event read straight from the doc", () => {
    const h = newHandle();
    const habitId = createDailyHabit(h, "Stretch");
    const habit = doc(h).habits[habitId]!;
    const id = logEvent(h, {
      typeId: habit.eventTypeIds[0]!,
      occurred: { kind: "day", date: "2026-10-21" },
    });
    expect(habitDoneOn(doc(h), habit, "2026-10-21")).toBe(true);

    tombstoneEvent(h, doc(h).events[id]!);

    expect(currentEvents(doc(h))).toEqual([]);
    expect(habitDoneOn(doc(h), habit, "2026-10-21")).toBe(false);
    expect(doc(h).events[id]).toBeDefined(); // original stays in the raw log
  });

});

describe("habit management", () => {
  it("renames a habit and its event type, keeping history", () => {
    const h = newHandle();
    const habitId = createDailyHabit(h, "Strech");
    const typeId = doc(h).habits[habitId]!.eventTypeIds[0]!;
    logEvent(h, { typeId, occurred: { kind: "day", date: "2026-10-21" } });
    renameHabit(h, habitId, "Stretch");
    expect(doc(h).habits[habitId]!.name).toBe("Stretch");
    expect(doc(h).eventTypes[typeId]!.name).toBe("Stretch");
    expect(habitDoneOn(doc(h), doc(h).habits[habitId]!, "2026-10-21")).toBe(true);
  });

  it("archives and restores without losing events", () => {
    const h = newHandle();
    const habitId = createDailyHabit(h, "Stretch");
    const typeId = doc(h).habits[habitId]!.eventTypeIds[0]!;
    logEvent(h, { typeId, occurred: { kind: "day", date: "2026-10-21" } });
    setHabitArchived(h, habitId, true);
    expect(activeHabits(doc(h))).toEqual([]);
    expect(currentEvents(doc(h))).toHaveLength(1);
    setHabitArchived(h, habitId, false);
    expect(activeHabits(doc(h)).map((x) => x.id)).toEqual([habitId]);
  });
});

describe("toggleHabit", () => {
  it("unchecks on a second tap even when called with no re-render between", () => {
    const h = newHandle();
    const id = createDailyHabit(h, "Stretch");
    const habit = doc(h).habits[id]!;
    toggleHabit(h, habit, "2026-10-20");
    toggleHabit(h, habit, "2026-10-20");
    expect(habitDoneOn(doc(h), habit, "2026-10-20")).toBe(false);
  });
});

describe("habit order", () => {
  it("appends new habits and swaps on move", () => {
    const h = newHandle();
    const a = createDailyHabit(h, "B first");
    const b = createDailyHabit(h, "A second");
    expect(activeHabits(doc(h)).map((x) => x.id)).toEqual([a, b]);
    moveHabit(h, b, -1);
    expect(activeHabits(doc(h)).map((x) => x.id)).toEqual([b, a]);
    moveHabit(h, b, -1); // already first: no-op
    expect(activeHabits(doc(h)).map((x) => x.id)).toEqual([b, a]);
  });
});

describe("habit colours", () => {
  it("gives new habits distinct colours and keeps them across reorder", () => {
    const h = newHandle();
    const ids = ["A", "B", "C"].map((n) => createDailyHabit(h, n));
    const hues = () => ids.map((id) => doc(h).habits[id]!.hue);
    const before = hues();
    expect(new Set(before).size).toBe(3);
    moveHabit(h, ids[2]!, -1);
    expect(hues()).toEqual(before);
  });
});
