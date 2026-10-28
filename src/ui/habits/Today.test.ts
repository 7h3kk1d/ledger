import { describe, expect, it } from "vitest";
import type { DoneIndex } from "../../model/reduce";
import { signalIndex, type Observation, type SignalData, type SignalInfo } from "../../model/signals";
import type { Expectation, Habit } from "../../model/types";
import type { Signals } from "../../signals/useSignals";
import { tileSub, todaySections } from "./Today";

const TODAY = "2026-10-21"; // a Wednesday
const habit = (id: string, expectation: Expectation = { kind: "daily" }, over: Partial<Habit> = {}): Habit =>
  ({ id, name: id, eventTypeIds: [id], expectation, ...over });
const index = (done: Record<string, string[]>, signals: Signals["index"] = new Map()): DoneIndex => ({
  types: new Map(Object.entries(done).map(([t, ds]) => [t, new Set(ds)])),
  signals,
});
const ids = (hs: Habit[]) => hs.map((h) => h.id);

const a = habit("a");
const b = habit("b");
const c = habit("c");
const tue = habit("tue", { kind: "weekdays", days: [2] }); // rests on Wednesdays
const all = [a, b, tue, c];

describe("todaySections", () => {
  const idx = index({ b: [TODAY] });
  it("keeps everything due in habit order, done or not, when done isn't hidden", () => {
    const s = todaySections(all, idx, TODAY, { hideDone: false });
    expect(ids(s.open)).toEqual(["a", "b", "c"]);
    expect(s.done).toEqual([]);
    expect(ids(s.notDue)).toEqual(["tue"]);
  });
  it("moves done habits to their own section when hidden, and unticking brings them back", () => {
    const s = todaySections(all, idx, TODAY, { hideDone: true });
    expect(ids(s.open)).toEqual(["a", "c"]);
    expect(ids(s.done)).toEqual(["b"]);
    expect(ids(todaySections(all, index({}), TODAY, { hideDone: true }).open)).toEqual(["a", "b", "c"]);
  });
  it("leaves a just-ticked habit in place for a moment", () => {
    const s = todaySections(all, idx, TODAY, { hideDone: true, keep: new Set(["b"]) });
    expect(ids(s.open)).toEqual(["a", "b", "c"]);
  });
  it("counts a habit done on its day off as done today", () => {
    const s = todaySections(all, index({ tue: [TODAY] }), TODAY, { hideDone: true });
    expect(ids(s.done)).toEqual(["tue"]);
    expect(s.notDue).toEqual([]);
  });
});

const RING = "src/ring/acct";
const INFO: SignalInfo = {
  id: RING, source: "src", account: "acct", label: "Ring", grain: "day", live: false,
  metrics: [
    { key: "calories", label: "Move", unit: "Cal", on: "observation", goal: "goal" },
    { key: "goal", label: "Goal", unit: "Cal", on: "observation" },
    { key: "latest", label: "Latest", unit: "Cal", on: "current" },
  ],
};
const signals = (obs: Observation[], current: Record<string, number> = {}): Signals => {
  const map = new Map<string, SignalData>([[RING, { observations: obs, current }]]);
  return {
    state: { enabled: true, catalog: [INFO], data: map, loading: false },
    index: signalIndex(map),
    info: (id) => (id === RING ? INFO : undefined),
    refresh: () => {},
  } as Signals;
};

describe("tileSub", () => {
  const none = signals([]);
  it("shows the streak for a daily habit", () => {
    expect(tileSub(none, index({ a: ["2026-10-19", "2026-10-20"] }), a, TODAY)).toBe("🔥 2");
    expect(tileSub(none, index({}), a, TODAY)).toBeUndefined();
  });
  it("shows where a period habit stands", () => {
    const thrice = habit("w", { kind: "per", times: 3, unit: "week" });
    expect(tileSub(none, index({ w: ["2026-10-19"] }), thrice, TODAY)).toBe("1/3 this week");
  });
  it("prefers today's value from linked data", () => {
    const s = signals([
      { id: "x", occurred: { kind: "day", date: TODAY }, effect: "info", metrics: { calories: 299, goal: 680 } },
    ]);
    const ring = habit("r", { kind: "daily" }, { eventTypeIds: [], signals: [RING] });
    expect(tileSub(s, index({}, s.index), ring, TODAY)).toBe("299 of 680 Cal");
  });
  it("shows the values picked to show with the name, before the streak", () => {
    const s = signals([], { latest: 44 });
    const h = habit("w", { kind: "daily" }, {
      eventTypeIds: [], signals: [RING], display: { metrics: [{ signal: RING, metric: "latest" }] },
    });
    expect(tileSub(s, index({}, s.index), h, TODAY)).toBe("44 Cal");
  });
});
