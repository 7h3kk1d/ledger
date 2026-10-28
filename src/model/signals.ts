// Signals: streams of observations from other services (the collectors repo's
// spec/signals.md). Ledger never learns which service a signal is: ids are
// opaque, and an observation only says when something happened and whether it
// satisfies or excuses. What that means for a habit (due, late, streaks) is
// decided here, by the habit's own expectation, as for manual check-ins.
//
// Observations are never written to the Automerge doc; only a habit's links to
// signals are (Habit.signals), because those are set by hand.
import { localDate } from "./reduce";

export type Effect = "satisfies" | "excuses" | "info";

export type ObservationTime =
  | { kind: "instant"; at: string }
  | { kind: "interval"; start: string; end: string }
  | { kind: "day"; date: string };

export interface Observation {
  id: string;
  occurred: ObservationTime;
  effect: Effect;
  metrics: Record<string, number>;
  detail?: string;
}

export interface SignalMetric {
  key: string;
  label: string;
  unit?: string;
  /** A value per observation, or one value right now (a streak, a rating). */
  on: "observation" | "current";
  role?: "streak" | "score";
}

/** A catalog entry. */
export interface SignalInfo {
  id: string;
  source: string;
  account: string;
  label: string;
  grain: "instant" | "interval" | "day";
  labels?: Partial<Record<Effect, string>>;
  metrics: SignalMetric[];
  count?: number;
  first?: string;
  last?: string;
  live: boolean;
}

/** What this device holds for one signal. */
export interface SignalData {
  observations: Observation[];
  current: Record<string, number>;
  freshAt?: string;
  /** The first day the signal can say anything about (see SignalDays.from). */
  coveredFrom?: string;
}

/** One signal's part of an observations response. */
export interface SignalAnswer {
  complete: boolean;
  current: Record<string, number>;
  observations: Observation[];
  fresh_at?: string;
  covered_from?: string;
}

/**
 * Fold a response into what was held: a complete answer replaces it; an
 * incremental one (live observations only) is merged in by id.
 */
export function mergeAnswer(held: SignalData | undefined, answer: SignalAnswer): SignalData {
  const byId = new Map<string, Observation>();
  if (!answer.complete) for (const o of held?.observations ?? []) byId.set(o.id, o);
  for (const o of answer.observations) byId.set(o.id, o);
  return {
    observations: [...byId.values()],
    current: answer.complete ? { ...answer.current } : { ...held?.current, ...answer.current },
    freshAt: answer.fresh_at ?? held?.freshAt,
    coveredFrom: earliest(answer.covered_from, answer.complete ? undefined : held?.coveredFrom),
  };
}

const earliest = (a?: string, b?: string) => (a && b ? (a < b ? a : b) : (a ?? b));

/**
 * The local day an observation counts on. An interval counts on the day it
 * ends (a night's sleep belongs to the morning after); a whole day is the
 * source's own date.
 */
export function observationDate(o: Observation): string {
  switch (o.occurred.kind) {
    case "day":
      return o.occurred.date;
    case "instant":
      return localDate(new Date(o.occurred.at));
    case "interval":
      return localDate(new Date(o.occurred.end));
  }
}

/** A signal's observations by local day. */
export interface SignalDays {
  satisfied: Set<string>;
  excused: Set<string>;
  byDate: Map<string, Observation[]>;
  /**
   * The days the signal covers, from its first day of data to its last fetch.
   * A day in this range with nothing satisfying it was missed; outside it
   * there's no data either way.
   */
  from?: string;
  to?: string;
}

export type SignalIndex = Map<string, SignalDays>;

export function signalIndex(data: ReadonlyMap<string, SignalData>): SignalIndex {
  const idx: SignalIndex = new Map();
  for (const [id, d] of data) {
    const days: SignalDays = {
      satisfied: new Set(),
      excused: new Set(),
      byDate: new Map(),
      from: d.coveredFrom,
      to: d.freshAt ? localDate(new Date(d.freshAt)) : undefined,
    };
    for (const o of d.observations) {
      const date = observationDate(o);
      if (o.effect === "satisfies") days.satisfied.add(date);
      else if (o.effect === "excuses") days.excused.add(date);
      const list = days.byDate.get(date);
      if (list) list.push(o);
      else days.byDate.set(date, [o]);
    }
    idx.set(id, days);
  }
  return idx;
}

/** "41 min", "1,200 XP", "3": a metric value with its unit. */
export function formatMetric(value: number, metric?: Pick<SignalMetric, "unit">): string {
  const n = Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return metric?.unit ? `${n} ${metric.unit}` : n;
}

/** "3 min ago", "2 h ago", "4 d ago". */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 90) return "just now";
  if (s < 90 * 60) return `${Math.round(s / 60)} min ago`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
