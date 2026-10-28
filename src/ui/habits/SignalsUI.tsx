// Pieces of the habit views for linked signals: the day detail, the "Linked
// data" field of the habit editor, and reading display values. Nothing here
// knows which service a signal is; labels and units come from the catalog.
import { useState } from "preact/hooks";
import {
  dayTotal,
  displayOf,
  isDone,
  isExcused,
  isUnknown,
  manualDone,
  meets,
  signalsOf,
  thresholdsOf,
  type DoneIndex,
  type Note,
} from "../../model/reduce";
import { ago, formatMetric, type Effect, type SignalInfo, type SignalMetric } from "../../model/signals";
import type { Event, Habit, HabitDisplay, MetricRef, Threshold } from "../../model/types";
import type { Signals } from "../../signals/useSignals";
import { Modal } from "../Modal";

const EFFECT_LABEL: Record<Effect, string> = { satisfies: "Done", excuses: "Excused", info: "Recorded" };

export const effectLabel = (info: SignalInfo | undefined, e: Effect) => info?.labels?.[e] ?? EFFECT_LABEL[e];

/** What an excused day is called for this habit (the first linked signal that names it). */
export function excusedLabel(signals: Signals, habit: Habit): string {
  for (const id of signalsOf(habit)) {
    const l = signals.info(id)?.labels?.excuses;
    if (l) return l;
  }
  return EFFECT_LABEL.excuses;
}

const metricOf = (info: SignalInfo | undefined, key: string): SignalMetric | undefined =>
  info?.metrics.find((m) => m.key === key);

/** A reported value right now, with its label and unit; undefined if the signal hasn't sent it. */
export function currentValue(signals: Signals, ref: MetricRef) {
  const value = signals.state.data.get(ref.signal)?.current[ref.metric];
  if (value === undefined) return undefined;
  const info = signals.info(ref.signal);
  const metric = metricOf(info, ref.metric);
  return {
    value,
    label: metric?.label ?? ref.metric,
    unit: metric?.unit,
    text: formatMetric(value, metric),
    source: info?.label ?? ref.signal,
  };
}

/** Whether a day has anything from the habit's linked signals. */
export const hasObservations = (signals: Signals, habit: Habit, date: string) =>
  signalsOf(habit).some((s) => signals.index.get(s)?.byDate.has(date));

const signalName = (signals: Signals, id: string) => {
  const info = signals.info(id);
  return info ? `${info.label} · ${info.account}` : id;
};

export function DayDetail(props: {
  habit: Habit;
  date: string;
  dateLabel: string;
  idx: DoneIndex;
  signals: Signals;
  notes: Note[];
  onToggle: () => void;
  onAddNote: (reason: string, text: string) => void;
  onDeleteNote: (e: Event) => void;
  onClose: () => void;
}) {
  const { habit, date, idx, signals } = props;
  const [reason, setReason] = useState("");
  const [text, setText] = useState("");
  const manual = manualDone(idx, habit, date);
  const thresholds = thresholdsOf(habit);
  const status = isDone(idx, habit, date)
    ? "Done"
    : isExcused(idx, habit, date)
      ? excusedLabel(signals, habit)
      : isUnknown(idx, habit, date)
        ? "No data"
        : "Not done";
  return (
    <Modal title={habit.name} onClose={props.onClose}>
      <div class="day-detail">
        <p class="day-status">
          {props.dateLabel} · <strong>{status}</strong>
        </p>
        <ul class="sources">
          <li>
            <div class="source-head">
              <span>Checked in by hand</span>
              <button onClick={props.onToggle}>{manual ? "Undo check-in" : "Check in"}</button>
            </div>
            {!manual && <small class="muted">No check-in this day.</small>}
          </li>
          {signalsOf(habit).map((id) => {
            const info = signals.info(id);
            const data = signals.state.data.get(id);
            const obs = signals.index.get(id)?.byDate.get(date) ?? [];
            return (
              <li key={id}>
                <div class="source-head">
                  <span>{signalName(signals, id)}</span>
                  {data?.freshAt && <small class="muted">updated {ago(data.freshAt)}</small>}
                </div>
                {obs.length === 0 && (
                  <small class="muted">
                    {coverage(signals, id, date)}
                  </small>
                )}
                {obs.map((o) => {
                  const metrics = Object.entries(o.metrics)
                    .map(([k, v]) => {
                      const m = metricOf(info, k);
                      return `${m?.label ?? k} ${formatMetric(v, m)}`;
                    })
                    .join(" · ");
                  return (
                    <div key={o.id} class={`obs ${o.effect}`}>
                      <strong>{effectLabel(info, o.effect)}</strong>
                      {o.detail && <span> · {o.detail}</span>}
                      {metrics && <small class="muted"> · {metrics}</small>}
                    </div>
                  );
                })}
                {obs.length > 0 && thresholds.has(id) && <ThresholdResult info={info} t={thresholds.get(id)!} total={dayTotal(obs, thresholds.get(id)!.metric)} />}
              </li>
            );
          })}
        </ul>
        <section class="notes">
          <h3>Notes</h3>
          {props.notes.map((n) => (
            <div key={n.event.id} class="note">
              <span>
                <strong>{n.reason || "Note"}</strong>
                {n.text && <> · {n.text}</>}
              </span>
              <button class="ghost" aria-label="Delete note" onClick={() => props.onDeleteNote(n.event)}>×</button>
            </div>
          ))}
          <form
            class="note-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!reason.trim() && !text.trim()) return;
              props.onAddNote(reason.trim(), text.trim());
              setReason("");
              setText("");
            }}
          >
            <input list="note-reasons" placeholder="Reason, e.g. travel" value={reason} onInput={(e) => setReason(e.currentTarget.value)} />
            <datalist id="note-reasons">
              {REASONS.map((r) => <option key={r} value={r} />)}
            </datalist>
            <input placeholder="Details (optional)" value={text} onInput={(e) => setText(e.currentTarget.value)} />
            <button disabled={!reason.trim() && !text.trim()}>Add note</button>
          </form>
          <small class="muted">A note explains the day; it doesn’t change whether it’s done.</small>
        </section>
      </div>
    </Modal>
  );
}

const REASONS = ["Travel", "Sick", "Rest day", "Busy", "Other"];

const OP_SIGN: Record<Threshold["op"], string> = { atLeast: "≥", atMost: "≤" };

/** "Needs Asleep ≥ 7 h: 6.5 h, not met". */
function ThresholdResult(props: { info: SignalInfo | undefined; t: Threshold; total: number | undefined }) {
  const { info, t, total } = props;
  const m = metricOf(info, t.metric);
  const ok = meets(t, total);
  return (
    <small class={`threshold ${ok ? "met" : "unmet"}`}>
      Needs {m?.label ?? t.metric} {OP_SIGN[t.op]} {formatMetric(t.value, m)}:{" "}
      {total === undefined ? "not reported" : formatMetric(Math.round(total * 100) / 100, m)}, {ok ? "met" : "not met"}
    </small>
  );
}

/** Why a signal has nothing on a day: nothing happened, or it has no data for it. */
function coverage(signals: Signals, id: string, date: string): string {
  const d = signals.index.get(id);
  if (!d?.from || !d.to) return "No data from this source yet.";
  if (date < d.from) return `No data this day: its data starts ${d.from}.`;
  if (date > d.to) return `No data this day yet: last fetched ${d.to}.`;
  return "Nothing recorded this day.";
}

/**
 * When a linked signal counts a day: as it reports (its "satisfies"), or when
 * the day's total of one of its metrics is at least / at most a value.
 */
function CountsWhen(props: { signals: Signals; id: string; value: Threshold | undefined; onChange: (t: Threshold | undefined) => void }) {
  const { signals, id, value: t } = props;
  const info = signals.info(id);
  const metrics = (info?.metrics ?? []).filter((m) => m.on === "observation");
  if (t && !metrics.some((m) => m.key === t.metric)) metrics.push({ key: t.metric, label: t.metric, on: "observation" });
  if (metrics.length === 0) return null;
  const unit = t && metricOf(info, t.metric)?.unit;
  return (
    <div class="counts-when">
      <span>Counts when</span>
      <select
        aria-label="Counts when"
        value={t?.metric ?? ""}
        onChange={(e) => {
          const metric = e.currentTarget.value;
          if (!metric) return props.onChange(undefined);
          const value = t?.metric === metric ? t.value : suggestedValue(signals, id, metric);
          props.onChange({ signal: id, metric, op: t?.op ?? "atLeast", value });
        }}
      >
        <option value="">{info?.labels?.satisfies ?? "Recorded"}, as reported</option>
        {metrics.map((m) => (
          <option key={m.key} value={m.key}>{m.label}{m.unit ? ` (${m.unit})` : ""}</option>
        ))}
      </select>
      {t && (
        <span class="threshold-value">
          <select aria-label="Comparison" value={t.op} onChange={(e) => props.onChange({ ...t, op: e.currentTarget.value as Threshold["op"] })}>
            <option value="atLeast">at least</option>
            <option value="atMost">at most</option>
          </select>
          <input
            type="number"
            step="any"
            inputMode="decimal"
            aria-label="Value"
            value={t.value}
            onInput={(e) => {
              const v = e.currentTarget.valueAsNumber;
              if (Number.isFinite(v)) props.onChange({ ...t, value: v });
            }}
          />
          {unit && <span>{unit}</span>}
        </span>
      )}
    </div>
  );
}

/** A starting value for a new threshold: the metric's latest day total, rounded. */
function suggestedValue(signals: Signals, id: string, metric: string): number {
  const days = signals.index.get(id)?.byDate;
  if (!days) return 1;
  for (const date of [...days.keys()].sort().reverse()) {
    const total = dayTotal(days.get(date), metric);
    if (total !== undefined && total > 0) return total >= 10 ? Math.round(total) : Math.round(total * 2) / 2;
  }
  return 1;
}

const refKey = (r: MetricRef) => `${r.signal}\n${r.metric}`;
const sameRef = (a: MetricRef, b: MetricRef) => a.signal === b.signal && a.metric === b.metric;

/**
 * The habit editor's "Linked data": which signals count for the habit, and what
 * to show from them. Hidden when there's no signals service and nothing linked.
 */
export function LinkedDataField(props: {
  signals: Signals;
  value: string[];
  display: HabitDisplay;
  thresholds: Threshold[];
  onChange: (signals: string[], display: HabitDisplay, thresholds: Threshold[]) => void;
}) {
  const { signals, value, display, thresholds } = props;
  const [query, setQuery] = useState("");
  if (!signals.state.enabled && value.length === 0) return null;

  // keep display settings and thresholds pointing only at linked signals
  const change = (ids: string[], d: HabitDisplay, ts: Threshold[] = thresholds) => {
    const h = { id: "", name: "", eventTypeIds: [], expectation: { kind: "daily" as const }, signals: ids, display: d, thresholds: ts };
    props.onChange(ids, displayOf(h), [...thresholdsOf(h).values()]);
  };
  const setThreshold = (id: string, t: Threshold | undefined) =>
    change(value, display, [...thresholds.filter((x) => x.signal !== id), ...(t ? [t] : [])]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = words.length
    ? signals.state.catalog
        .filter((s) => !value.includes(s.id))
        .filter((s) => words.every((w) => `${s.label} ${s.account} ${s.id}`.toLowerCase().includes(w)))
        .slice(0, 8)
    : [];

  const currents: MetricRef[] = value.flatMap((id) =>
    (signals.info(id)?.metrics ?? [])
      .filter((m) => m.on === "current")
      .sort((a, b) => Number(b.role === "streak") - Number(a.role === "streak"))
      .map((m) => ({ signal: id, metric: m.key })),
  );
  const refLabel = (r: MetricRef) =>
    `${metricOf(signals.info(r.signal), r.metric)?.label ?? r.metric} (${signals.info(r.signal)?.label ?? r.signal})`;

  return (
    <fieldset class="linked-data">
      <legend>Linked data</legend>
      {value.length === 0 && <small class="hint">Count data from other services toward this habit, alongside check-ins.</small>}
      <ul>
        {value.map((id) => (
          <li key={id} class="linked">
            <div class="linked-head">
              <span>{signalName(signals, id)}</span>
              <button type="button" class="ghost" aria-label={`Unlink ${signalName(signals, id)}`} onClick={() => change(value.filter((x) => x !== id), display)}>
                ×
              </button>
            </div>
            <CountsWhen signals={signals} id={id} value={thresholds.find((t) => t.signal === id)} onChange={(t) => setThreshold(id, t)} />
          </li>
        ))}
      </ul>
      {signals.state.enabled && (
        <>
          <input
            type="search"
            placeholder={signals.state.catalog.length ? "Find data to link, e.g. workout" : "Loading the list…"}
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          {matches.length > 0 && (
            <ul class="matches">
              {matches.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => (change([...value, s.id], display), setQuery(""))}>
                    <span>{s.label}</span>
                    <small class="muted">
                      {s.account}
                      {s.count !== undefined && ` · ${s.count.toLocaleString()}`}
                      {s.last && ` · last ${s.last}`}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {currents.length > 0 && (
        <>
          <label>
            Streak shows
            <select
              value={display.streak ? refKey(display.streak) : ""}
              onChange={(e) => {
                const r = currents.find((c) => refKey(c) === e.currentTarget.value);
                change(value, { ...display, streak: r });
              }}
            >
              <option value="">Ledger’s count</option>
              {currents.map((r) => (
                <option key={refKey(r)} value={refKey(r)}>{refLabel(r)}</option>
              ))}
            </select>
          </label>
          <div class="show-metrics">
            <small class="muted">Show with the name</small>
            {currents.map((r) => {
              const on = display.metrics?.some((m) => sameRef(m, r)) ?? false;
              return (
                <label key={refKey(r)} class="check">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      change(value, {
                        ...display,
                        metrics: on ? display.metrics?.filter((m) => !sameRef(m, r)) : [...(display.metrics ?? []), r],
                      })
                    }
                  />
                  {refLabel(r)}
                </label>
              );
            })}
          </div>
        </>
      )}
    </fieldset>
  );
}
