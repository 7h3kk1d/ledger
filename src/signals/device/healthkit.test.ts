// The same records and expectations as collectors' sources/apple-health/tests/test_signals.py
// (test_healthkit_rows_join_under_the_ids_the_phone_derives): the two must agree.
import { describe, expect, it } from "vitest";
import { deriveObservations, deriveSignal, type HealthRecords } from "./healthkit";
import { DeviceHealth } from "./deviceHealth";

const TRAINERIZE = { name: "Trainerize", bundle_id: "com.trainerize.Trainerize" };
const R: HealthRecords = {
  read_at: "2026-11-02T20:00:00.000Z",
  from: "2026-10-20T04:00:00.000Z",
  workouts: [
    { uuid: "t1", start: "2026-10-31T00:54:56.120Z", end: "2026-10-31T01:06:23.000Z", duration_s: 686.2, activity: "crossTraining",
      source: TRAINERIZE, metadata: { HKWorkoutBrandName: "Neck/Shoulder" }, energy_kcal: 52.0 },
    { uuid: "t3", start: "2026-11-02T12:00:00Z", end: "2026-11-02T12:30:00Z", duration_s: 1800, activity: "crossTraining",
      source: TRAINERIZE, metadata: { HKWorkoutBrandName: "Hips" }, energy_kcal: 100 },
    { uuid: "w9", start: "2026-11-02T14:00:00Z", end: "2026-11-02T15:00:00Z", duration_s: 3600, activity: "climbing",
      source: { name: "Watch", bundle_id: "com.apple.health" }, energy_kcal: 300 },
  ],
  sleep: [
    { uuid: "s1", start: "2026-11-02T03:00:00Z", end: "2026-11-02T03:30:00Z", stage: "awake", source: { name: "Watch" } },
    { uuid: "s2", start: "2026-11-02T03:30:00Z", end: "2026-11-02T08:30:00Z", stage: "asleepCore", source: { name: "Watch" } },
    { uuid: "s3", start: "2026-11-02T08:30:00Z", end: "2026-11-02T10:00:00Z", stage: "asleepDeep", source: { name: "Watch" } },
    // a phone that saw less of the night doesn't count
    { uuid: "s4", start: "2026-11-02T05:00:00Z", end: "2026-11-02T07:00:00Z", stage: "asleepUnspecified", source: { name: "iPhone" } },
  ],
  samples: [
    { uuid: "b1", type: "bodyMass", start: "2026-10-22T11:22:37Z", end: "2026-10-22T11:22:37Z", value: 79, unit: "kg", source: { name: "eufy Life" } },
    { uuid: "f1", type: "bodyFatPercentage", start: "2026-10-22T11:22:37Z", end: "2026-10-22T11:22:37Z", value: 0.226, unit: "%", source: { name: "eufy Life" } },
    { uuid: "x1", type: "bodyMass", start: "2026-10-23T05:00:00Z", end: "2026-10-23T05:00:00Z", value: 79, unit: "kg", source: { name: "FITIV Sync" } },
  ],
  activity: [{ day: "2026-11-02", move_kcal: 512, move_goal_kcal: 500, exercise_min: 31, exercise_goal_min: 45, stand_h: 9, stand_goal_h: 12 }],
};

describe("HealthKit recipes, on the phone", () => {
  it("counts the app's workouts under the service's ids, titled", () => {
    const o = deriveObservations({ kind: "healthkit.workouts", bundleId: "com.trainerize.Trainerize" }, R)!;
    expect(o.map((x) => [x.id, x.detail, x.metrics])).toEqual([
      ["healthkit:workout:T1", "Neck/Shoulder", { minutes: 11.4, calories: 52 }],
      ["healthkit:workout:T3", "Hips", { minutes: 30, calories: 100 }],
    ]);
    expect(o[0]!.occurred).toEqual({ kind: "interval", start: "2026-10-31T00:54:56Z", end: "2026-10-31T01:06:23Z" });
    expect(deriveObservations({ kind: "healthkit.workouts", title: "Hips" }, R)!.map((x) => x.id)).toEqual(["healthkit:workout:T3"]);
  });

  it("makes a night from the device that saw the most of it", () => {
    expect(deriveObservations({ kind: "healthkit.sleep" }, R)).toEqual([{
      id: "healthkit:night:2026-11-02",
      occurred: { kind: "interval", start: "2026-11-02T03:00:00Z", end: "2026-11-02T10:00:00Z" },
      effect: "satisfies",
      metrics: { hours: 6.5, deep: 1.5, core: 5, awake: 0.5 },
      detail: "Watch",
    }]);
  });

  it("closes a ring at its goal; an open ring is info", () => {
    expect(deriveObservations({ kind: "healthkit.ring", ring: "move" }, R)).toEqual([
      { id: "healthkit:move:2026-11-02", occurred: { kind: "day", date: "2026-11-02" }, effect: "satisfies", metrics: { calories: 512, goal: 500 } }]);
    expect(deriveObservations({ kind: "healthkit.ring", ring: "exercise" }, R)![0]).toMatchObject({ effect: "info", metrics: { minutes: 31, goal: 45 } });
  });

  it("weighs in pounds with that minute's body fat, not carried-forward weights", () => {
    const d = deriveSignal({ kind: "healthkit.sample", type: "bodyMass" }, R)!;
    expect(d.observations.map((o) => [o.id, o.metrics])).toEqual([["healthkit:bodyMass:b1", { lb: 174.2, body_fat: 22.6 }]]);
    expect(d.current).toEqual({ latest_lb: 174.2 });
    expect(d.freshAt).toBe(R.read_at);
  });

  it("leaves kinds it can't apply to the service", () => {
    expect(deriveObservations({ kind: "fitbit.steps" } as never, R)).toBeUndefined();
  });
});

describe("DeviceHealth", () => {
  it("answers only the wanted signals with a HealthKit recipe", async () => {
    let reads = 0;
    const p = new DeviceHealth({ recent: async () => (reads++, R) });
    p.want([{ id: "pt", recipe: { kind: "healthkit.workouts", bundleId: "com.trainerize.Trainerize" } }, { id: "duo" }]);
    await p.refresh();
    expect([...p.snapshot.data.keys()]).toEqual(["pt"]);
    expect(reads).toBeGreaterThan(0);
  });

  it("keeps quiet when HealthKit can't be read", async () => {
    const p = new DeviceHealth({ recent: async () => Promise.reject(new Error("not authorized")) });
    p.want([{ id: "s", recipe: { kind: "healthkit.sleep" } }]);
    await p.refresh();
    expect(p.snapshot.data.size).toBe(0);
    expect(p.snapshot.error).toBe("not authorized");
  });
});
