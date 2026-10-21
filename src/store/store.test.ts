import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { Repo, type DocHandle } from "@automerge/automerge-repo";
import { currentEvents, habitDoneOn } from "../model/reduce";
import type { LedgerDoc } from "../model/types";
import { amendEvent, createDailyHabit, logEvent, tombstoneEvent } from "./store";

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
