import { describe, expect, it } from "vitest";
import type { Observation, SignalData } from "../model/signals";
import { mergeSignal, mergeStates } from "./provider";
import type { SignalsState } from "./client";
import { recipesOf, validRecipe } from "../model/reduce";
import type { Habit } from "../model/types";

const obs = (id: string, end: string): Observation => ({
  id,
  occurred: { kind: "interval", start: end, end },
  effect: "satisfies",
  metrics: {},
});
const data = (o: Observation[], freshAt?: string): SignalData => ({ observations: o, current: {}, freshAt });
const state = (d: [string, SignalData][]): SignalsState => ({ enabled: true, catalog: [], data: new Map(d), loading: false });

describe("merging device answers into the service's", () => {
  it("keeps the service's copy of an observation both have", () => {
    const remote = data([{ ...obs("healthkit:workout:T1", "2026-11-20T10:00:00Z"), detail: "server" }], "2026-11-20T11:00:00Z");
    const device = data([{ ...obs("healthkit:workout:T1", "2026-11-20T10:00:00Z"), detail: "phone" }]);
    expect(mergeSignal(remote, device)?.observations).toEqual([remote.observations[0]]);
  });

  it("adds what only the device has, as provisional", () => {
    const remote = data([obs("a", "2026-11-19T10:00:00Z")], "2026-11-20T09:00:00Z");
    const device = data([obs("b", "2026-11-20T10:00:00Z")], "2026-11-20T10:05:00Z");
    const m = mergeSignal(remote, device)!;
    expect(m.observations.map((o) => [o.id, o.provisional])).toEqual([["a", undefined], ["b", true]]);
    expect(m.freshAt).toBe("2026-11-20T10:05:00Z");
  });

  it("drops a device-only observation the service, a day past it, still doesn't have", () => {
    const device = data([obs("old", "2026-11-18T10:00:00Z"), obs("new", "2026-11-20T08:00:00Z")]);
    const remote = data([], "2026-11-20T12:00:00Z");
    expect(mergeSignal(remote, device)?.observations.map((o) => o.id)).toEqual(["new"]);
  });

  it("answers offline from the device alone", () => {
    const merged = mergeStates(state([]), state([["s", data([obs("x", "2026-11-20T10:00:00Z")])]]));
    expect(merged.data.get("s")?.observations[0]?.provisional).toBe(true);
  });

  it("is the service's state untouched without device data", () => {
    const remote = state([["s", data([])]]);
    expect(mergeStates(remote, undefined)).toBe(remote);
  });
});

describe("recipes on habits", () => {
  const habit = (recipes: unknown, signals = ["s1", "s2"]): Habit =>
    ({ id: "h", name: "PT", eventTypeIds: [], expectation: {} as Habit["expectation"], signals, recipes }) as Habit;

  it("reads well-formed recipes of linked signals only", () => {
    const h = habit({
      s1: { kind: "healthkit.workouts", bundleId: "com.trainerize.Trainerize" },
      s2: { kind: "healthkit.ring", ring: "flex" },
      s3: { kind: "healthkit.sleep" },
    });
    expect([...recipesOf(h)]).toEqual([["s1", { kind: "healthkit.workouts", bundleId: "com.trainerize.Trainerize" }]]);
  });

  it("ignores kinds it doesn't know", () => {
    expect(validRecipe({ kind: "fitbit.steps" })).toBeUndefined();
    expect(validRecipe({ kind: "healthkit.sample", type: "bodyMass" })).toEqual({ kind: "healthkit.sample", type: "bodyMass" });
  });
});

describe("mergeStates: the phone's own freshness", () => {
  it("says when this phone last read its data, so an unreachable server isn't the whole story", () => {
    const remote: SignalsState = { enabled: true, catalog: [], data: new Map(), loading: false, error: "offline" };
    const device: SignalsState = {
      enabled: true, catalog: [], loading: false, lastOk: 1234,
      data: new Map([["s", { observations: [], current: {} } as unknown as SignalData]]),
    };
    expect(mergeStates(remote, device).deviceOk).toBe(1234);
    expect(mergeStates(remote, undefined).deviceOk).toBeUndefined();
  });
});
