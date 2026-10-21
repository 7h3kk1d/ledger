import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { Repo, type DocHandle } from "@automerge/automerge-repo";
import { activeHabits, currentEvents, habitDoneOn } from "../model/reduce";
import type { LedgerDoc } from "../model/types";
import { amendEvent, createDailyHabit, logEvent, renameHabit, setHabitArchived, tombstoneEvent } from "./store";

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

  it("amends an event, leaving the original in the log", () => {
    const h = newHandle();
    const id = logEvent(h, { typeId: "t", occurred: { kind: "day", date: "2026-10-21" } });
    const next = amendEvent(h, id, {
      typeId: "t",
      occurred: { kind: "day", date: "2026-10-20" },
      attrs: { note: "x" },
    });
    expect(currentEvents(doc(h)).map((e) => e.id)).toEqual([next]);
    expect(Object.keys(doc(h).events)).toHaveLength(2);
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
