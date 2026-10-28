import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { Repo, type DocHandle } from "@automerge/automerge-repo";
import { activeHabits, currentEvents, displayOf, habitDoneOn, notesOn, signalsOf } from "../model/reduce";
import type { LedgerDoc } from "../model/types";
import {
  addNote,
  createHabit,
  logEvent,
  moveHabit,
  renameHabit,
  setHabitArchived,
  setHabitDisplay,
  setHabitSignals,
  toggleHabit,
  tombstoneEvent,
} from "./mutations";

const doc = (h: DocHandle<LedgerDoc>) => h.doc() as LedgerDoc;
const newHandle = () =>
  new Repo({}).create<LedgerDoc>({ eventTypes: {}, habits: {}, events: {} });

describe("store mutations", () => {
  it("tombstones an event read straight from the doc", () => {
    const h = newHandle();
    const habitId = createHabit(h, "Stretch");
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
    const habitId = createHabit(h, "Strech");
    const typeId = doc(h).habits[habitId]!.eventTypeIds[0]!;
    logEvent(h, { typeId, occurred: { kind: "day", date: "2026-10-21" } });
    renameHabit(h, habitId, "Stretch");
    expect(doc(h).habits[habitId]!.name).toBe("Stretch");
    expect(doc(h).eventTypes[typeId]!.name).toBe("Stretch");
    expect(habitDoneOn(doc(h), doc(h).habits[habitId]!, "2026-10-21")).toBe(true);
  });

  it("archives and restores without losing events", () => {
    const h = newHandle();
    const habitId = createHabit(h, "Stretch");
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
    const id = createHabit(h, "Stretch");
    const habit = doc(h).habits[id]!;
    toggleHabit(h, habit, "2026-10-20");
    toggleHabit(h, habit, "2026-10-20");
    expect(habitDoneOn(doc(h), habit, "2026-10-20")).toBe(false);
  });
});

describe("habit order", () => {
  it("appends new habits and moves them to a position", () => {
    const h = newHandle();
    const [a, b, c, d] = ["B first", "A second", "C", "D"].map((n) => createHabit(h, n));
    const order = () => activeHabits(doc(h)).map((x) => x.id);
    expect(order()).toEqual([a, b, c, d]);
    moveHabit(h, d!, 1);
    expect(order()).toEqual([a, d, b, c]);
    moveHabit(h, a!, 3);
    expect(order()).toEqual([d, b, c, a]);
    moveHabit(h, b!, -5); // clamped to the top
    expect(order()).toEqual([b, d, c, a]);
    moveHabit(h, b!, 0); // already there: no-op
    expect(order()).toEqual([b, d, c, a]);
  });
});

describe("habit colours", () => {
  it("gives new habits distinct colours and keeps them across reorder", () => {
    const h = newHandle();
    const ids = ["A", "B", "C"].map((n) => createHabit(h, n));
    const hues = () => ids.map((id) => doc(h).habits[id]!.hue);
    const before = hues();
    expect(new Set(before).size).toBe(3);
    moveHabit(h, ids[2]!, 0);
    expect(hues()).toEqual(before);
  });
});

describe("notes and linked signals", () => {
  it("adds and deletes a note without changing the day", () => {
    const h = newHandle();
    const habitId = createHabit(h, "Duolingo");
    const habit = doc(h).habits[habitId]!;
    addNote(h, habitId, "2026-10-20", "Travel", "flight to Denver");
    const notes = notesOn(doc(h), habitId, "2026-10-20");
    expect(notes.map((n) => [n.reason, n.text])).toEqual([["Travel", "flight to Denver"]]);
    expect(notesOn(doc(h), "other", "2026-10-20")).toEqual([]);
    expect(habitDoneOn(doc(h), habit, "2026-10-20")).toBe(false);
    tombstoneEvent(h, notes[0]!.event);
    expect(notesOn(doc(h), habitId, "2026-10-20")).toEqual([]);
  });

  it("links signals and display settings, and clears them", () => {
    const h = newHandle();
    const habitId = createHabit(h, "Duolingo");
    setHabitSignals(h, habitId, ["duolingo/practice/me"]);
    setHabitDisplay(h, habitId, { streak: { signal: "duolingo/practice/me", metric: "streak" } });
    expect(signalsOf(doc(h).habits[habitId]!)).toEqual(["duolingo/practice/me"]);
    expect(displayOf(doc(h).habits[habitId]!).streak?.metric).toBe("streak");
    setHabitDisplay(h, habitId, {});
    setHabitSignals(h, habitId, []);
    expect(doc(h).habits[habitId]!.signals).toBeUndefined();
    expect(doc(h).habits[habitId]!.display).toBeUndefined();
  });
});
