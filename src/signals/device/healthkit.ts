// HealthKit records -> a signal's observations, by a habit's device recipe. The
// same rules, and the same ids, as collectors' sources/apple-health/signals.sql
// (spec/signals.md, Device recipes), so the service's answer replaces these
// rather than adding to them. Pure: the native side only reads the records.
import { localDate } from "../../model/reduce";
import type { Observation, SignalData } from "../../model/signals";
import type { DeviceRecipe } from "../../model/types";

interface Source {
  name?: string;
  bundle_id?: string;
}

/** The plugin's `recent` answer (ios/App/Health/HealthRecent.swift): batch shapes. */
export interface HealthRecords {
  read_at: string;
  /** The first day the records cover in full. */
  from: string;
  workouts: {
    uuid: string;
    start: string;
    end: string;
    duration_s: number;
    activity: string;
    source: Source;
    metadata?: Record<string, unknown>;
    energy_kcal?: number;
  }[];
  sleep: { uuid: string; start: string; end: string; stage: string; source: Source }[];
  samples: { uuid: string; type: string; start: string; end: string; value: number; unit: string; source: Source }[];
  activity: {
    day: string;
    move_kcal?: number;
    move_goal_kcal?: number;
    exercise_min?: number;
    exercise_goal_min?: number;
    stand_h?: number;
    stand_goal_h?: number;
  }[];
}

const HOUR = 3_600_000;
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;
/** Like SQL's json_object without nulls: metrics that have a value. */
const metrics = (m: Record<string, number | undefined>) =>
  Object.fromEntries(Object.entries(m).filter((e): e is [string, number] => e[1] !== undefined && Number.isFinite(e[1])));
/** UTC with whole seconds, the store's form. */
const utc = (iso: string) => new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");

function workouts(r: HealthRecords, recipe: Extract<DeviceRecipe, { kind: "healthkit.workouts" }>): Observation[] {
  return r.workouts
    .filter((w) => !recipe.bundleId || w.source.bundle_id === recipe.bundleId)
    .filter((w) => !recipe.activity || w.activity === recipe.activity)
    .map((w) => ({ w, title: typeof w.metadata?.HKWorkoutBrandName === "string" ? w.metadata.HKWorkoutBrandName : undefined }))
    .filter(({ title }) => !recipe.title || title === recipe.title)
    .map(({ w, title }) => ({
      id: `healthkit:workout:${w.uuid.toUpperCase()}`,
      occurred: { kind: "interval", start: utc(w.start), end: utc(w.end) },
      effect: "satisfies",
      metrics: metrics({
        minutes: round(w.duration_s / 60, 1),
        calories: w.energy_kcal === undefined ? undefined : round(w.energy_kcal, 0),
      }),
      detail: title ?? w.activity,
    }));
}

interface Night {
  night: string;
  device: string;
  start: string;
  end: string;
  asleep: number;
  stages: Record<string, number>;
}

/**
 * A night is the sleep that ended between 18:00 the day before and 18:00, from
 * the device that recorded the most of it asleep; from bed to getting up.
 */
function nights(r: HealthRecords): Observation[] {
  const groups = new Map<string, Night>();
  for (const s of r.sleep) {
    const h = (Date.parse(s.end) - Date.parse(s.start)) / HOUR;
    if (!(h > 0)) continue;
    const night = localDate(new Date(Date.parse(s.end) + 6 * HOUR));
    const device = s.source.name ?? "";
    const key = `${night}\n${device}`;
    const g = groups.get(key) ?? { night, device, start: utc(s.start), end: utc(s.end), asleep: 0, stages: {} };
    if (utc(s.start) < g.start) g.start = utc(s.start);
    if (utc(s.end) > g.end) g.end = utc(s.end);
    if (s.stage.startsWith("asleep")) g.asleep += h;
    g.stages[s.stage] = (g.stages[s.stage] ?? 0) + h;
    groups.set(key, g);
  }
  const best = new Map<string, Night>();
  for (const g of groups.values()) {
    if (!(g.asleep > 0 || g.stages.inBed)) continue;
    const b = best.get(g.night);
    const better =
      !b ||
      round(g.asleep, 2) > round(b.asleep, 2) ||
      (round(g.asleep, 2) === round(b.asleep, 2) && round(g.stages.inBed ?? 0, 2) > round(b.stages.inBed ?? 0, 2));
    if (better) best.set(g.night, g);
  }
  const r2 = (v?: number) => (v === undefined ? undefined : round(v, 2));
  return [...best.values()].map((n) => ({
    id: `healthkit:night:${n.night}`,
    occurred: { kind: "interval", start: n.start, end: n.end },
    effect: "satisfies",
    metrics: metrics({
      hours: r2(n.asleep),
      in_bed: r2(n.stages.inBed),
      deep: r2(n.stages.asleepDeep),
      core: r2(n.stages.asleepCore),
      rem: r2(n.stages.asleepREM),
      awake: r2(n.stages.awake),
    }),
    detail: n.device || undefined,
  }));
}

const RING = {
  move: { total: "move_kcal", goal: "move_goal_kcal", metric: "calories", places: 0 },
  exercise: { total: "exercise_min", goal: "exercise_goal_min", metric: "minutes", places: 1 },
  stand: { total: "stand_h", goal: "stand_goal_h", metric: "hours", places: 1 },
} as const;

/** A day's ring: closing it satisfies; an open ring is info. */
function ring(r: HealthRecords, which: keyof typeof RING): Observation[] {
  const k = RING[which];
  return r.activity.flatMap((a) => {
    const total = a[k.total];
    if (total === undefined) return [];
    const goal = a[k.goal];
    return [{
      id: `healthkit:${which}:${a.day}`,
      occurred: { kind: "day", date: a.day },
      effect: goal !== undefined && goal > 0 && total >= goal ? "satisfies" : "info",
      metrics: metrics({ [k.metric]: round(total, k.places), goal: goal && goal > 0 ? round(goal, 0) : undefined }),
    }];
  });
}

const LB_PER_KG = 2.20462;

/** Each sample of the type; a weigh-in in pounds with the body fat taken in the same minute. */
function samples(r: HealthRecords, type: string): Observation[] {
  const fat = new Map<string, number>();
  for (const s of r.samples)
    if (s.type === "bodyFatPercentage") fat.set(utc(s.start).slice(0, 16), Math.max(fat.get(utc(s.start).slice(0, 16)) ?? 0, s.value * 100));
  return r.samples
    .filter((s) => s.type === type && !(type === "bodyMass" && s.source.name === "FITIV Sync"))
    .map((s) => ({
      id: `healthkit:${type}:${s.uuid}`,
      occurred: { kind: "instant", at: utc(s.start) },
      effect: "satisfies",
      metrics:
        type === "bodyMass"
          ? metrics({
              lb: round(s.value * (s.unit === "kg" ? LB_PER_KG : 1), 1),
              body_fat: fat.has(utc(s.start).slice(0, 16)) ? round(fat.get(utc(s.start).slice(0, 16))!, 1) : undefined,
            })
          : metrics({ value: s.value }),
      detail: s.source.name,
    }));
}

/** What the service's `current` holds for these streams, from the newest observation. */
function current(recipe: DeviceRecipe, obs: Observation[]): Record<string, number> {
  const newest = [...obs].sort((a, b) => (time(b) < time(a) ? -1 : 1))[0];
  if (!newest) return {};
  switch (recipe.kind) {
    case "healthkit.sleep":
      return metrics({ last_night: newest.metrics.hours });
    case "healthkit.ring": {
      const key = RING[recipe.ring].metric;
      return metrics({ latest: newest.metrics[key], latest_goal: newest.metrics.goal });
    }
    case "healthkit.sample":
      return recipe.type === "bodyMass" ? metrics({ latest_lb: newest.metrics.lb }) : {};
    default:
      return {};
  }
}

function time(o: Observation): string {
  return o.occurred.kind === "instant" ? o.occurred.at : o.occurred.kind === "interval" ? o.occurred.end : o.occurred.date;
}

/** A recipe's observations from the records; undefined for a kind this device can't apply. */
export function deriveObservations(recipe: DeviceRecipe, r: HealthRecords): Observation[] | undefined {
  switch (recipe.kind) {
    case "healthkit.workouts":
      return workouts(r, recipe);
    case "healthkit.sleep":
      return nights(r);
    case "healthkit.ring":
      return RING[recipe.ring] ? ring(r, recipe.ring) : undefined;
    case "healthkit.sample":
      return samples(r, recipe.type);
    default:
      return undefined;
  }
}

/** A signal's data on this device: what it derived, fresh as of the read, from the window's start. */
export function deriveSignal(recipe: DeviceRecipe, r: HealthRecords): SignalData | undefined {
  const observations = deriveObservations(recipe, r);
  if (!observations) return undefined;
  return { observations, current: current(recipe, observations), freshAt: r.read_at, coveredFrom: localDate(new Date(r.from)) };
}
