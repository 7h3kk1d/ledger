// Outside data in the Events view: observations of signals (from the service,
// or provisional from this phone), shown read-only beside the doc's events.
// Which signals: those habits link, unless hidden here, plus ones chosen here;
// the choice is this device's (a view preference, never in the doc).
import { formatMetric, observationDate, type Observation, type SignalData, type SignalInfo } from "../../model/signals";

export interface OutsidePref {
  /** Signals shown that no habit links. */
  extra: string[];
  /** Linked signals not shown. */
  hidden: string[];
}

export const isOutsidePref = (v: unknown): v is OutsidePref => {
  const p = v as OutsidePref;
  return !!p && Array.isArray(p.extra) && Array.isArray(p.hidden) && [...p.extra, ...p.hidden].every((x) => typeof x === "string");
};

/** The signals to show: linked ones not hidden, then the chosen extras. */
export function shownSignals(linked: readonly string[], pref: OutsidePref | undefined): string[] {
  const hidden = new Set(pref?.hidden);
  return [...new Set([...linked.filter((id) => !hidden.has(id)), ...(pref?.extra ?? [])])];
}

/** `pref` with `id` shown or not. */
export function toggleShown(linked: readonly string[], pref: OutsidePref | undefined, id: string, on: boolean): OutsidePref {
  const p = { extra: [...(pref?.extra ?? [])], hidden: [...(pref?.hidden ?? [])] };
  const without = (xs: string[]) => xs.filter((x) => x !== id);
  if (linked.includes(id)) return { extra: without(p.extra), hidden: on ? without(p.hidden) : [...without(p.hidden), id] };
  return { extra: on ? [...without(p.extra), id] : without(p.extra), hidden: without(p.hidden) };
}

export interface OutsideRow {
  signal: string;
  label: string;
  o: Observation;
  /** The local day it counts on (an interval: the day it ends). */
  date: string;
  /** For ordering with events: their sort key's form. */
  sortKey: string;
  /** Detail and metrics, for people. */
  text: string;
}

const iso = (s: string) => new Date(s).toISOString();

/** Rows for `ids`' observations, newest first. */
export function outsideRows(
  data: ReadonlyMap<string, SignalData>,
  info: (id: string) => SignalInfo | undefined,
  ids: readonly string[],
): OutsideRow[] {
  const rows: OutsideRow[] = [];
  for (const id of ids) {
    const meta = info(id);
    for (const o of data.get(id)?.observations ?? []) {
      const metrics = Object.entries(o.metrics).map(([k, v]) => {
        const m = meta?.metrics.find((x) => x.key === k);
        return `${m?.label ?? k} ${formatMetric(v, m)}`;
      });
      rows.push({
        signal: id,
        label: meta?.label ?? id,
        o,
        date: observationDate(o),
        sortKey:
          o.occurred.kind === "day" ? `${o.occurred.date}T00:00` : iso(o.occurred.kind === "instant" ? o.occurred.at : o.occurred.start),
        text: [o.detail, ...metrics].filter(Boolean).join(" · "),
      });
    }
  }
  return rows.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
}

/** "6:10 PM", "11:05 PM – 6:40 AM", "all day". */
export function outsideTime(o: Observation): string {
  const t = (s: string) => new Date(s).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  switch (o.occurred.kind) {
    case "day":
      return "all day";
    case "instant":
      return t(o.occurred.at);
    case "interval":
      return `${t(o.occurred.start)} – ${t(o.occurred.end)}`;
  }
}
