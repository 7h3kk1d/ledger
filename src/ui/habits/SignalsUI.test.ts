import { describe, expect, it } from "vitest";
import { compactNumber, signalIndex, type Observation, type SignalData, type SignalInfo } from "../../model/signals";
import type { Habit } from "../../model/types";
import type { Signals } from "../../signals/useSignals";
import { currentValue, dayProgress } from "./SignalsUI";

const RING = "src/ring/acct";
const SLEEP = "src/sleep/acct";
const day = (id: string, date: string, metrics: Record<string, number>): Observation => ({
  id,
  occurred: { kind: "day", date },
  effect: "info",
  metrics,
});
const INFO: Record<string, SignalInfo> = {
  [RING]: {
    id: RING, source: "src", account: "acct", label: "Ring", grain: "day", live: false,
    metrics: [
      { key: "calories", label: "Move", unit: "Cal", on: "observation", goal: "goal" },
      { key: "goal", label: "Goal", unit: "Cal", on: "observation" },
      { key: "latest", label: "Latest", unit: "Cal", on: "current", goal: "latest_goal" },
    ],
  },
  [SLEEP]: {
    id: SLEEP, source: "src", account: "acct", label: "Sleep", grain: "day", live: false,
    metrics: [{ key: "hours", label: "Asleep", unit: "h", on: "observation" }],
  },
};
const signals = (data: Record<string, Observation[]>, current: Record<string, number> = {}): Signals => {
  const map = new Map<string, SignalData>(
    Object.entries(data).map(([id, observations]) => [id, { observations, current }]),
  );
  return {
    state: { enabled: true, catalog: Object.values(INFO), data: map, loading: false },
    index: signalIndex(map),
    info: (id) => INFO[id],
    refresh: () => {},
  } as Signals;
};
const habit = (over: Partial<Habit>): Habit => ({ id: "h", name: "H", eventTypeIds: [], expectation: { kind: "daily" }, ...over });

describe("dayProgress", () => {
  it("measures against the source's goal", () => {
    const s = signals({ [RING]: [day("a", "2026-10-28", { calories: 170, goal: 680 })] });
    expect(dayProgress(s, habit({ signals: [RING] }), "2026-10-28")).toEqual({
      value: 170, fraction: 0.25, text: "170 of 680 Cal",
    });
    expect(dayProgress(s, habit({ signals: [RING] }), "2026-10-27")).toBeUndefined();
  });

  it("measures against a threshold, which wins over a goal", () => {
    const s = signals({ [SLEEP]: [day("a", "2026-10-25", { hours: 6.8 })] });
    const h = habit({ signals: [SLEEP], thresholds: [{ signal: SLEEP, metric: "hours", op: "atLeast", value: 8 }] });
    expect(dayProgress(s, h, "2026-10-25")).toEqual({ value: 6.8, fraction: 0.85, text: "6.8 of 8 h" });
  });

  it("an at-most threshold gives the value but no fraction; no goal or threshold, nothing", () => {
    const s = signals({ [SLEEP]: [day("a", "2026-10-25", { hours: 6.8 })] });
    const h = habit({ signals: [SLEEP], thresholds: [{ signal: SLEEP, metric: "hours", op: "atMost", value: 8 }] });
    expect(dayProgress(s, h, "2026-10-25")).toEqual({ value: 6.8, text: "6.8 h" });
    expect(dayProgress(s, habit({ signals: [SLEEP] }), "2026-10-25")).toBeUndefined();
  });
});

describe("currentValue", () => {
  it("shows a current value with its goal", () => {
    const s = signals({ [RING]: [] }, { latest: 134, latest_goal: 680 });
    expect(currentValue(s, { signal: RING, metric: "latest" })?.text).toBe("134 / 680 Cal");
  });
});

describe("compactNumber", () => {
  it("fits a cell", () => {
    expect([7.62, 48.4, 680, 1116, 12345].map(compactNumber)).toEqual(["7.6", "48", "680", "1.1k", "12k"]);
  });
});
