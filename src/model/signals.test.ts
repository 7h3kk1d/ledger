import { describe, expect, it } from "vitest";
import { dayTotal, displayOf, doneDates, doneIndex, isDone, isExcused, isUnknown, localDate, manualDone, meets, signalsOf, thresholdsOf } from "./reduce";
import { bestStreak, countsOn, dayState, habitStreak, isDue, progress } from "./schedule";
import {
  mergeAnswer,
  observationDate,
  signalIndex,
  type Observation,
  type SignalData,
} from "./signals";
import type { Event, Expectation, Habit } from "./types";

const TODAY = "2026-10-21";
const S = "src/stream/acct"; // opaque to Ledger

const day = (id: string, date: string, effect: Observation["effect"] = "satisfies"): Observation => ({
  id,
  occurred: { kind: "day", date },
  effect,
  metrics: {},
});
// covered from the start of 2026 to the evening of TODAY (local)
const COVER = { coveredFrom: "2026-01-01", freshAt: new Date(2026, 9, 21, 20).toISOString() };
const data = (...observations: Observation[]): Map<string, SignalData> =>
  new Map([[S, { observations, current: {}, ...COVER }]]);
const habit = (expectation: Expectation = { kind: "daily" }, over: Partial<Habit> = {}): Habit => ({
  id: "h",
  name: "H",
  eventTypeIds: ["t"],
  expectation,
  signals: [S],
  ...over,
});
const manual = (date: string): Event => ({
  id: `m-${date}`,
  typeId: "t",
  author: "local",
  loggedAt: `${date}T12:00:00Z`,
  occurred: { kind: "day", date },
  attrs: {},
});
const index = (obs: Observation[], events: Event[] = []) =>
  doneIndex({ events: Object.fromEntries(events.map((e) => [e.id, e])) }, signalIndex(data(...obs)));

describe("observationDate", () => {
  it("uses the source's own date for whole days", () => {
    expect(observationDate(day("a", "2026-10-20"))).toBe("2026-10-20");
  });
  it("puts an instant on its local day", () => {
    const at = "2026-10-21T03:30:00Z";
    const o: Observation = { id: "a", occurred: { kind: "instant", at }, effect: "satisfies", metrics: {} };
    expect(observationDate(o)).toBe(localDate(new Date(at)));
  });
  it("counts an interval on the day it ends", () => {
    const start = "2026-10-20T23:00:00";
    const end = "2026-10-21T07:00:00";
    const o: Observation = { id: "a", occurred: { kind: "interval", start, end }, effect: "satisfies", metrics: {} };
    expect(observationDate(o)).toBe(localDate(new Date(end)));
  });
});

describe("mergeAnswer", () => {
  const held: SignalData = { observations: [day("a", "2026-10-19"), day("b", "2026-10-20")], current: { streak: 4, xp: 10 }, freshAt: "t1" };
  it("replaces everything on a complete answer", () => {
    const m = mergeAnswer(held, { complete: true, current: { streak: 5 }, observations: [day("c", TODAY)], fresh_at: "t2" });
    expect(m.observations.map((o) => o.id)).toEqual(["c"]);
    expect(m.current).toEqual({ streak: 5 });
    expect(m.freshAt).toBe("t2");
  });
  it("merges live observations by id on an incremental answer", () => {
    const m = mergeAnswer(held, {
      complete: false,
      current: { streak: 5 },
      observations: [day("b", "2026-10-20", "excuses"), day("c", TODAY)],
    });
    expect(m.observations.map((o) => [o.id, o.effect])).toEqual([
      ["a", "satisfies"],
      ["b", "excuses"],
      ["c", "satisfies"],
    ]);
    expect(m.current).toEqual({ streak: 5, xp: 10 });
    expect(m.freshAt).toBe("t1");
  });
});

describe("habits backed by signals", () => {
  it("counts a satisfying observation as done, and info as nothing", () => {
    const idx = index([day("a", TODAY), day("b", "2026-10-20", "info")]);
    expect(isDone(idx, habit(), TODAY)).toBe(true);
    expect(manualDone(idx, habit(), TODAY)).toBe(false);
    expect(isDone(idx, habit(), "2026-10-20")).toBe(false);
    expect(dayState(idx, habit(), "2026-10-20")).toBe("open");
  });
  it("adds manual check-ins and signals together", () => {
    const idx = index([day("a", "2026-10-20")], [manual(TODAY)]);
    expect(habitStreak(idx, habit(), TODAY)).toBe(2);
  });
  it("ignores signals the habit doesn't link", () => {
    const idx = index([day("a", TODAY)]);
    expect(isDone(idx, habit(undefined, { signals: undefined }), TODAY)).toBe(false);
  });
  it("skips excused days in day-by-day streaks without breaking them", () => {
    // 18 done, 19 excused (freeze), 20 done, 21 not yet
    const idx = index([day("a", "2026-10-18"), day("b", "2026-10-19", "excuses"), day("c", "2026-10-20")]);
    const h = habit();
    expect(dayState(idx, h, "2026-10-19")).toBe("excused");
    expect(isExcused(idx, h, "2026-10-19")).toBe(true);
    expect(habitStreak(idx, h, TODAY)).toBe(2);
    expect(bestStreak(idx, h)).toBe(2);
    // without the excuse the 19th breaks it
    expect(habitStreak(index([day("a", "2026-10-18"), day("c", "2026-10-20")]), h, TODAY)).toBe(1);
  });
  it("leaves an excused day out of what's due", () => {
    const idx = index([day("b", TODAY, "excuses")]);
    expect(isDue(idx, habit(), TODAY)).toBe(false);
    expect(countsOn(idx, habit(), TODAY)).toBe(false);
  });
  it("lets a done day win over an excuse the same day", () => {
    const idx = index([day("a", TODAY), day("b", TODAY, "excuses")]);
    expect(dayState(idx, habit(), TODAY)).toBe("done");
    expect(isExcused(idx, habit(), TODAY)).toBe(false);
  });
  it("applies any expectation to a sparse stream: every 6 months", () => {
    const h = habit({ kind: "every", n: 6, unit: "month" });
    // last service 2026-03-02: due 2026-09-02, 49 days ago
    const late = index([day("oil", "2026-03-02")]);
    expect(progress(late, h, TODAY)).toBe("49d late");
    expect(dayState(late, h, TODAY)).toBe("late");
    expect(isDue(late, h, TODAY)).toBe(true);
    // last service 2026-08-01: next 2027-02-01
    const fine = index([day("oil", "2026-08-01")]);
    expect(progress(fine, h, TODAY)).toBe("next in 103d");
    expect(dayState(fine, h, TODAY)).toBe("covered");
  });
});

describe("days without data", () => {
  const idx = (cover: Partial<SignalData>, events: Event[] = []) =>
    doneIndex(
      { events: Object.fromEntries(events.map((e) => [e.id, e])) },
      signalIndex(new Map([[S, { observations: [day("a", "2026-10-15")], current: {}, ...cover }]])),
    );
  it("tells a missed day from one before the data starts", () => {
    const i = idx({ coveredFrom: "2026-10-15", freshAt: COVER.freshAt });
    expect(dayState(i, habit(), "2026-10-14")).toBe("unknown");
    expect(dayState(i, habit(), "2026-10-16")).toBe("open"); // covered, nothing: missed
    expect(isUnknown(i, habit(), "2026-10-15")).toBe(false); // done
  });
  it("has no data after the last fetch", () => {
    const i = idx({ coveredFrom: "2026-10-01", freshAt: new Date(2026, 9, 19, 12).toISOString() });
    expect(dayState(i, habit(), "2026-10-19")).toBe("open");
    expect(dayState(i, habit(), TODAY)).toBe("unknown");
  });
  it("still counts a check-in on a day without data", () => {
    const i = idx({}, [manual(TODAY)]);
    expect(dayState(i, habit(), TODAY)).toBe("done");
    expect(dayState(i, habit(), "2026-10-20")).toBe("unknown");
  });
  it("never applies to habits without linked signals, or to rest days", () => {
    const i = idx({});
    expect(dayState(i, habit(undefined, { signals: undefined }), "2026-10-20")).toBe("open");
    expect(dayState(i, habit({ kind: "weekdays", days: [1] }), "2026-10-20")).toBe("rest");
  });
  it("keeps the earliest coverage when live answers merge in", () => {
    const held: SignalData = { observations: [], current: {}, coveredFrom: "2026-10-01" };
    expect(mergeAnswer(held, { complete: false, current: {}, observations: [], covered_from: "2026-10-28" }).coveredFrom).toBe("2026-10-01");
    expect(mergeAnswer(held, { complete: true, current: {}, observations: [], covered_from: "2026-10-28" }).coveredFrom).toBe("2026-10-28");
  });
});

describe("habit fields from other builds", () => {
  it("ignores malformed signal links and display settings", () => {
    const h = habit(undefined, {
      signals: [S, "", 3 as unknown as string],
      display: {
        streak: { signal: "not-linked", metric: "streak" },
        metrics: [{ signal: S, metric: "xp" }, { signal: S } as unknown as { signal: string; metric: string }],
      },
    });
    expect(signalsOf(h)).toEqual([S]);
    expect(displayOf(h)).toEqual({ metrics: [{ signal: S, metric: "xp" }] });
    expect(displayOf(habit(undefined, { display: "x" as unknown as Habit["display"] }))).toEqual({});
  });
});

describe("thresholds", () => {
  const night = (id: string, date: string, hours: number, effect: Observation["effect"] = "satisfies"): Observation => ({
    ...day(id, date, effect),
    metrics: { hours },
  });
  const sleep = (over: Partial<Habit> = {}) =>
    habit({ kind: "daily" }, { thresholds: [{ signal: S, metric: "hours", op: "atLeast", value: 7 }], ...over });

  it("counts a day only when the day's total passes", () => {
    const idx = index([night("a", "2026-10-19", 7.5), night("b", "2026-10-20", 6), night("c", "2026-10-21", 7)]);
    const h = sleep();
    expect(["2026-10-19", "2026-10-20", "2026-10-21"].map((d) => isDone(idx, h, d))).toEqual([true, false, true]);
    expect(doneDates(idx, h)).toEqual(["2026-10-19", "2026-10-21"]);
    expect(habitStreak(idx, h, TODAY)).toBe(1);
  });

  it("adds up a day's observations and leaves excuses out", () => {
    const idx = index([night("a", "2026-10-21", 4, "info"), night("b", "2026-10-21", 3.5), night("c", "2026-10-20", 9, "excuses")]);
    expect(isDone(idx, sleep(), "2026-10-21")).toBe(true); // 7.5, info counts toward the total
    expect(isDone(idx, sleep(), "2026-10-20")).toBe(false);
    expect(isExcused(idx, sleep(), "2026-10-20")).toBe(true);
  });

  it("at most: a day with the metric at or under the value", () => {
    const h = sleep({ thresholds: [{ signal: S, metric: "hours", op: "atMost", value: 7 }] });
    const idx = index([night("a", "2026-10-20", 6), night("b", "2026-10-21", 8)]);
    expect(isDone(idx, h, "2026-10-20")).toBe(true);
    expect(isDone(idx, h, "2026-10-21")).toBe(false);
    expect(isDone(idx, h, "2026-10-19")).toBe(false); // nothing reported isn't zero
  });

  it("a manual check-in still counts", () => {
    const idx = index([night("a", "2026-10-20", 5)], [manual("2026-10-20")]);
    expect(isDone(idx, sleep(), "2026-10-20")).toBe(true);
  });

  it("keeps only well-formed thresholds for linked signals, one each", () => {
    const h = habit({ kind: "daily" }, {
      thresholds: [
        { signal: S, metric: "hours", op: "atLeast", value: 7 },
        { signal: S, metric: "hours", op: "atMost", value: 9 },
        { signal: "other/x/y", metric: "hours", op: "atLeast", value: 1 },
        { signal: S, metric: "deep", op: "more", value: 1 } as never,
      ],
    });
    expect([...thresholdsOf(h).values()]).toEqual([{ signal: S, metric: "hours", op: "atLeast", value: 7 }]);
    expect(thresholdsOf(habit({ kind: "daily" }, { thresholds: "x" as never })).size).toBe(0);
  });

  it("dayTotal is undefined when nothing reports the metric", () => {
    expect(dayTotal([day("a", TODAY)], "hours")).toBeUndefined();
    expect(meets({ signal: S, metric: "hours", op: "atMost", value: 1 }, undefined)).toBe(false);
  });
});
